import {missionBlobReferences} from "@evolution/core";
import {MissionReadStreamError,MissionRevisionConflictError} from "@evolution/adapters";
import type {EvolveProject,EvolutionJob} from "@evolution/contracts";
import { cacheLocalEvolutionEvent, listPendingLocalEvolutionEvents, markLocalEvolutionEventSynced } from "./event-contract";
import { getLocalProject, listLocalProjects, saveLocalProject, deleteLocalProject, directoryRemovedMissionIds } from "./local-store";
import { cacheRemoteEvolutionJob, localProductionPorts } from "./local-production-adapters";
import { getProductionRuntime, productionRuntimeMode } from "./production-runtime";
import { flushPendingArtifactSync, queueExistingLocalArtifactUploads } from "./artifact-blob-store";
import { flushProjectDatabase, missionSyncJournal, updateMissionSyncJournal } from "./project-database";

const HTTP_POLL_BASE_DELAY_MS=3_000;
const HTTP_POLL_MAX_DELAY_MS=30_000;
const HTTP_AUTH_RETRY_DELAY_MS=60_000;

let initialized=false;
let applyingRemote=false;
let missionTimer:number|undefined;
let jobTimer:number|undefined;
let eventTimer:number|undefined;
let httpPollTimer:number|undefined;
let httpPollRunning=false;
let httpPollFailureCount=0;
let knownRemoteIds=new Set<string>();
let missionConflicts=new Set<string>();
let realtimeStatus="disabled";
let lastError:string|undefined;
let lastErrorRetryable=false;

const TERMINAL_JOB_STATUSES=new Set<EvolutionJob["status"]>(["completed","partial","failed","cancelled"]);

function remoteJobWins(remote:EvolutionJob,local?:EvolutionJob){
  if(!local)return true;
  if(remote.generation!==local.generation)return remote.generation>local.generation;
  if(TERMINAL_JOB_STATUSES.has(remote.status))return true;
  if(TERMINAL_JOB_STATUSES.has(local.status))return false;
  if((remote.status==="running"||remote.status==="waiting")&&local.status==="queued")return true;
  if((local.status==="running"||local.status==="waiting")&&remote.status==="queued")return false;
  return remote.updatedAt>=local.updatedAt;
}

function shouldPushLocalJob(local:EvolutionJob,remote?:EvolutionJob){
  if(!remote)return true;
  if(local.generation!==remote.generation)return local.generation>remote.generation;
  if(TERMINAL_JOB_STATUSES.has(remote.status))return false;
  if(TERMINAL_JOB_STATUSES.has(local.status))return true;
  if((remote.status==="running"||remote.status==="waiting")&&local.status==="queued")return false;
  if((local.status==="running"||local.status==="waiting")&&remote.status==="queued")return true;
  return local.updatedAt>remote.updatedAt;
}

function withRemoteProjection(fn:()=>void){
  applyingRemote=true;
  try{fn();}finally{applyingRemote=false;}
}

/** Cache one complete server receipt without scheduling a write back. */
export async function cachePointMissionProjection(id:string,remote:EvolveProject|undefined){
  if(remote&&remote.id!==id)throw new Error("Mission point-read identity mismatch");
  if(directoryRemovedMissionIds().has(id))return undefined;
  const current=getLocalProject(id),journal=missionSyncJournal();
  if(remote){
    if(!current||remote.updatedAt>=current.updatedAt)withRemoteProjection(()=>saveLocalProject(remote));
    knownRemoteIds.add(id);
    updateMissionSyncJournal(value=>({...value,knownRemoteIds:[...new Set([...value.knownRemoteIds,id])]}));
  }else if(journal.knownRemoteIds.includes(id)){
    withRemoteProjection(()=>deleteLocalProject(id,{fromRemote:true}));
    knownRemoteIds.delete(id);
    updateMissionSyncJournal(value=>({...value,knownRemoteIds:value.knownRemoteIds.filter(value=>value!==id)}));
  }
  await flushProjectDatabase();
  // An HTTP 404 cannot be promoted into a verified Mission from browser cache.
  return remote?getLocalProject(id):undefined;
}

async function pushLocalProjection(options?:{
  projects?:ReturnType<typeof listLocalProjects>;
  failOnConflict?:boolean;
}){
  if(productionRuntimeMode()==="local"||applyingRemote)return;
  const ports=getProductionRuntime();
  const projects=options?.projects??listLocalProjects();
  let firstConflict:MissionRevisionConflictError|undefined;

  for(const project of projects){
    const journal=missionSyncJournal();
    if(project.id==="demo"||journal.pendingDeleteIds.includes(project.id))continue;
    // A local cache entry never authorizes a new server Mission. Existing
    // Missions need a fresh server identity; new Missions need an explicit outbox intent.
    if(!knownRemoteIds.has(project.id)&&!journal.pendingCreateIds.includes(project.id))continue;
    try{
      await ports.missions.save(project);
      knownRemoteIds.add(project.id);
      updateMissionSyncJournal((current)=>({
        knownRemoteIds:[...new Set([...current.knownRemoteIds,project.id])],
        pendingCreateIds:current.pendingCreateIds.filter(id=>id!==project.id),
        pendingDeleteIds:getLocalProject(project.id)?current.pendingDeleteIds
          :[...new Set([...current.pendingDeleteIds,project.id])],
      }));
      await flushProjectDatabase();
      if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-mission-registration-changed",{detail:{missionId:project.id}}));
    }catch(error){
      if(error instanceof MissionRevisionConflictError){
        missionConflicts.add(error.missionId);
        firstConflict??=error;
        continue;
      }
      throw error;
    }
  }

  for(const id of missionSyncJournal().pendingDeleteIds){
    try{
      await ports.missions.delete(id);
      knownRemoteIds.delete(id);
      updateMissionSyncJournal((current)=>({
        knownRemoteIds:current.knownRemoteIds.filter((known)=>known!==id),
        pendingCreateIds:current.pendingCreateIds.filter((pending)=>pending!==id),
        pendingDeleteIds:current.pendingDeleteIds.filter((pending)=>pending!==id),
      }));
      await flushProjectDatabase();
    }catch(error){
      if(error instanceof MissionRevisionConflictError){
        missionConflicts.add(error.missionId);
        firstConflict??=error;
        // A newer remote revision wins; the next poll restores that Mission.
        updateMissionSyncJournal((current)=>({
          ...current,pendingDeleteIds:current.pendingDeleteIds.filter((pending)=>pending!==id),
        }));
        await flushProjectDatabase();
        continue;
      }
      throw error;
    }
  }

  if(firstConflict){
    setRealtimeStatus("http-conflict",firstConflict);
    if(!httpPollRunning)scheduleHttpPoll(0);
    if(options?.failOnConflict)throw firstConflict;
  }
  return firstConflict;
}

export async function flushProductionMissionSync(){
  if(productionRuntimeMode()==="http"&&realtimeStatus!=="http-polling")
    throw new Error("Mission 服务端身份尚未完成同步核验，禁止直接提交；本地草稿已保留。");
  if(missionTimer){
    window.clearTimeout(missionTimer);
    missionTimer=undefined;
  }
  await pushLocalProjection({failOnConflict:true});
}

/** Only a server-confirmed, non-deleted Mission authorizes legacy Artifact replay. */
function authorizedArtifactIds(){
  const deleted=new Set(missionSyncJournal().pendingDeleteIds);
  return new Set(listLocalProjects()
    .filter(project=>knownRemoteIds.has(project.id)&&!deleted.has(project.id)&&!missionConflicts.has(project.id))
    .flatMap(missionBlobReferences));
}

async function pushLocalJobs(remoteJobsInput?:Awaited<ReturnType<typeof localProductionPorts.jobs.list>>,localJobsInput?:Awaited<ReturnType<typeof localProductionPorts.jobs.list>>){
  if(productionRuntimeMode()==="local"||applyingRemote)return;
  const remote=getProductionRuntime();
  const localJobs=localJobsInput??await localProductionPorts.jobs.list();
  const remoteJobs=remoteJobsInput??await remote.jobs.list();
  const remoteById=new Map(remoteJobs.map((job)=>[job.id,job]));
  const deleted=new Set(missionSyncJournal().pendingDeleteIds);
  // Orphaned browser Jobs must remain local: a Job write never creates/repairs
  // a missing parent Mission. A successfully registered offline Mission enters
  // knownRemoteIds before this outbox is replayed.
  const newer=localJobs.filter(job=>typeof job.missionId==="string"&&job.missionId.length>0
    &&knownRemoteIds.has(job.missionId)&&!deleted.has(job.missionId)
    &&(!remoteById.has(job.id)||remoteById.get(job.id)?.missionId===job.missionId)
    &&shouldPushLocalJob(job,remoteById.get(job.id)));
  await Promise.all(newer.map(job=>remote.jobs.put(job)));
}

async function pushLocalEvents(){
  if(productionRuntimeMode()==="local"||applyingRemote)return;
  const remote=getProductionRuntime();
  const deleted=new Set(missionSyncJournal().pendingDeleteIds);
  for(const event of listPendingLocalEvolutionEvents()){
    // Events with an unverified/missing Mission (or an unbound Job) remain
    // pending locally. Jobless global audit events are allowed by the schema.
    if(event.missionId){
      if(!knownRemoteIds.has(event.missionId)||deleted.has(event.missionId))continue;
    }else if(event.jobId)continue;
    await remote.events.append(event);
    markLocalEvolutionEventSynced(event.id);
  }
}

function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}
function authFailure(error:unknown){return /\bHTTP\s+(401|403)\b/.test(errorMessage(error));}
function retryDelay(error:unknown){
  if(authFailure(error))return HTTP_AUTH_RETRY_DELAY_MS;
  return Math.min(HTTP_POLL_MAX_DELAY_MS,HTTP_POLL_BASE_DELAY_MS*(2**Math.max(0,httpPollFailureCount-1)));
}
function scheduleHttpPoll(delayMs=HTTP_POLL_BASE_DELAY_MS){
  if(productionRuntimeMode()!=="http"||!initialized)return;
  if(httpPollTimer)window.clearTimeout(httpPollTimer);
  httpPollTimer=window.setTimeout(()=>{
    httpPollTimer=undefined;
    void pollHttpProjection();
  },delayMs);
}
function enterHttpError(error:unknown,label:string){
  console.error(label,error);
  httpPollFailureCount+=1;
  setRealtimeStatus("http-error",error);
  scheduleHttpPoll(retryDelay(error));
}
function onArtifactSyncStatus(event:Event){
  const detail=(event as CustomEvent<{status?:string;error?:string}>).detail;
  if(detail?.status!=="pending"||productionRuntimeMode()!=="http"||!initialized)return;
  enterHttpError(new Error(detail.error||"Production artifact sync pending"),"Production artifact sync deferred");
}
function scheduleMissionPush(){
  if(applyingRemote||realtimeStatus!=="http-polling")return;
  if(missionTimer)window.clearTimeout(missionTimer);
  missionTimer=window.setTimeout(()=>{
    missionTimer=undefined;
    if(realtimeStatus!=="http-polling")return;
    void pushLocalProjection().catch((error)=>enterHttpError(error,"Production mission sync failed"));
  },350);
}
function scheduleJobPush(){
  if(applyingRemote||realtimeStatus!=="http-polling")return;
  if(jobTimer)window.clearTimeout(jobTimer);
  jobTimer=window.setTimeout(()=>{
    jobTimer=undefined;
    if(realtimeStatus!=="http-polling")return;
    void pushLocalJobs().catch((error)=>enterHttpError(error,"Production job sync failed"));
  },300);
}
function scheduleEventPush(){
  if(applyingRemote||realtimeStatus!=="http-polling")return;
  if(eventTimer)window.clearTimeout(eventTimer);
  eventTimer=window.setTimeout(()=>{
    eventTimer=undefined;
    if(realtimeStatus!=="http-polling")return;
    void pushLocalEvents().catch((error)=>enterHttpError(error,"Production event sync failed"));
  },180);
}

function setRealtimeStatus(status:string,error?:unknown){
  realtimeStatus=status;
  lastErrorRetryable=error instanceof MissionReadStreamError&&error.retryable;
  lastError=error===undefined?undefined:error instanceof Error?error.message:String(error);
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-production-realtime-status",{detail:{status,lastError,lastErrorRetryable}}));
}

async function applyRemoteJobsAndEvents(jobs:Awaited<ReturnType<typeof localProductionPorts.jobs.list>>,events:Awaited<ReturnType<typeof localProductionPorts.events.list>>){
  const localJobs=await localProductionPorts.jobs.list();
  const localById=new Map(localJobs.map((job)=>[job.id,job]));
  withRemoteProjection(()=>{
    for(const job of jobs){
      const current=localById.get(job.id);
      if(remoteJobWins(job,current))cacheRemoteEvolutionJob(job);
    }
    for(const event of [...events].reverse())cacheLocalEvolutionEvent(event);
  });
  return localJobs;
}

async function hydrateRemoteProjection(){
  const ports=getProductionRuntime();
  const [jobs,events]=await Promise.all([
    ports.jobs.list(),
    ports.events.list(undefined,500),
  ]);
  const localJobs=await applyRemoteJobsAndEvents(jobs,events);
  return {jobs,events,localJobs};
}

async function pollHttpProjection(){
  if(productionRuntimeMode()!=="http"||httpPollRunning||!initialized)return;
  httpPollRunning=true;
  const recovering=httpPollFailureCount>0||realtimeStatus==="http-error";
  let nextDelay=HTTP_POLL_BASE_DELAY_MS;
  try{
    const ports=getProductionRuntime();
    const [missions,jobs,events]=await Promise.all([
      ports.missions.list(),
      ports.jobs.list(),
      ports.events.list(undefined,500),
    ]);
    const remoteIds=new Set(missions.map((project)=>project.id));
    const remoteById=new Map(missions.map((project)=>[project.id,project]));
    const localJobsBefore=await localProductionPorts.jobs.list();
    const journal=missionSyncJournal();
    const previouslyKnown=new Set(journal.knownRemoteIds);
    const pendingDeletes=new Set(journal.pendingDeleteIds);
    const localBefore=listLocalProjects();
    const conflictedBefore=new Set(missionConflicts);
    const createIntent=new Set(journal.pendingCreateIds);
    const localToPush=localBefore.filter(project=>{
      if(project.id==="demo"||conflictedBefore.has(project.id)||pendingDeletes.has(project.id))return false;
      const remote=remoteById.get(project.id);
      return remote?project.updatedAt>remote.updatedAt:createIntent.has(project.id)&&!previouslyKnown.has(project.id);
    });
    withRemoteProjection(()=>{
      for(const project of missions){
        if(pendingDeletes.has(project.id))continue;
        const current=getLocalProject(project.id);
        if(conflictedBefore.has(project.id)||!current||project.updatedAt>=current.updatedAt)saveLocalProject(project);
      }
      for(const id of previouslyKnown)if(!remoteIds.has(id))deleteLocalProject(id,{fromRemote:true});
      for(const id of conflictedBefore)if(!remoteIds.has(id))deleteLocalProject(id,{fromRemote:true});
      const localJobsById=new Map(localJobsBefore.map((job)=>[job.id,job]));
      for(const job of jobs){
        const current=localJobsById.get(job.id);
        if(remoteJobWins(job,current))cacheRemoteEvolutionJob(job);
      }
      for(const event of [...events].reverse())cacheLocalEvolutionEvent(event);
      knownRemoteIds=remoteIds;
    });
    updateMissionSyncJournal(current=>({...current,
      knownRemoteIds:[...remoteIds],
      pendingCreateIds:current.pendingCreateIds.filter(id=>!remoteIds.has(id)&&!pendingDeletes.has(id)&&localBefore.some(p=>p.id===id)),
      pendingDeleteIds:current.pendingDeleteIds.filter(id=>remoteIds.has(id)),
    }));
    await flushProjectDatabase();
    for(const id of conflictedBefore)missionConflicts.delete(id);
    if(localToPush.length||missionSyncJournal().pendingDeleteIds.length){
      await pushLocalProjection({projects:localToPush});
    }
    if(recovering)await pushLocalJobs(jobs,localJobsBefore);
    await pushLocalEvents();
    await flushPendingArtifactSync(authorizedArtifactIds());
    httpPollFailureCount=0;
    if(missionConflicts.size){
      nextDelay=0;
    }else{
      setRealtimeStatus("http-polling");
    }
  }catch(error){
    console.error("HTTP production projection polling failed",error);
    httpPollFailureCount+=1;
    nextDelay=retryDelay(error);
    setRealtimeStatus("http-error",error);
  }finally{
    httpPollRunning=false;
    scheduleHttpPoll(nextDelay);
  }
}

export async function initializeProductionSync(){
  if(initialized||productionRuntimeMode()==="local")return;
  initialized=true;
  setRealtimeStatus("http-connecting");
  window.addEventListener("evolve-projects-changed",scheduleMissionPush);
  window.addEventListener("evolve-parse-job-changed",scheduleJobPush);
  window.addEventListener("evolve-evidence-job-changed",scheduleJobPush);
  window.addEventListener("evolve-run-tasks-changed",scheduleJobPush);
  window.addEventListener("evolve-events-changed",scheduleEventPush);
  window.addEventListener("evolve-artifact-sync-status",onArtifactSyncStatus);
  const ports=getProductionRuntime();
  try{
    await ports.missions.initialize();
    const remote=await ports.missions.list();
    const remoteIds=new Set(remote.map((project)=>project.id));
    const journal=missionSyncJournal();
    const previouslyKnown=new Set(journal.knownRemoteIds);
    const pendingDeletes=new Set(journal.pendingDeleteIds);
    const local=listLocalProjects();
    const remoteById=new Map(remote.map((project)=>[project.id,project]));
    const createIntent=new Set(journal.pendingCreateIds);
    const localToPush=local.filter(project=>{
      if(project.id==="demo"||pendingDeletes.has(project.id))return false;
      const current=remoteById.get(project.id);
      return current?project.updatedAt>current.updatedAt:createIntent.has(project.id)&&!previouslyKnown.has(project.id);
    });
    const merged=new Map(remoteById);
    for(const id of pendingDeletes)merged.delete(id);
    for(const project of localToPush)merged.set(project.id,project);
    withRemoteProjection(()=>{
      for(const id of previouslyKnown)if(!remoteIds.has(id))deleteLocalProject(id,{fromRemote:true});
      for(const project of merged.values())saveLocalProject(project);
      knownRemoteIds=remoteIds;
    });
    updateMissionSyncJournal(current=>({...current,
      knownRemoteIds:[...remoteIds],
      pendingCreateIds:current.pendingCreateIds.filter(id=>!remoteIds.has(id)&&!pendingDeletes.has(id)&&local.some(p=>p.id===id)),
      pendingDeleteIds:current.pendingDeleteIds.filter(id=>remoteIds.has(id)),
    }));
    await flushProjectDatabase();
    // Local-mode writes predating the HTTP outbox still need their original bytes uploaded.
    // Only the merged, non-deleted Missions' references are eligible for migration.
    await queueExistingLocalArtifactUploads([...merged.values()].flatMap(missionBlobReferences));
    // Seed new local Missions and replay durable deletes after a restart or outage.
    if(localToPush.length||missionSyncJournal().pendingDeleteIds.length){
      await pushLocalProjection({projects:localToPush});
    }
    const projection=await hydrateRemoteProjection();
    await pushLocalJobs(projection.jobs,projection.localJobs);
    await pushLocalEvents();
    await flushPendingArtifactSync(authorizedArtifactIds());
    httpPollFailureCount=0;
    if(missionConflicts.size){
      scheduleHttpPoll(0);
    }else{
      setRealtimeStatus("http-polling");
      scheduleHttpPoll();
    }
  }catch(error){
    // Remote production state must never make the local control plane unusable.
    // Authentication failures use a long retry delay; transient failures back off exponentially.
    httpPollFailureCount=1;
    setRealtimeStatus("http-error",error);
    scheduleHttpPoll(retryDelay(error));
    throw error;
  }
}

export async function stopProductionSync(){
  window.removeEventListener("evolve-projects-changed",scheduleMissionPush);
  window.removeEventListener("evolve-parse-job-changed",scheduleJobPush);
  window.removeEventListener("evolve-evidence-job-changed",scheduleJobPush);
  window.removeEventListener("evolve-run-tasks-changed",scheduleJobPush);
  window.removeEventListener("evolve-events-changed",scheduleEventPush);
  window.removeEventListener("evolve-artifact-sync-status",onArtifactSyncStatus);
  if(missionTimer)window.clearTimeout(missionTimer);
  if(jobTimer)window.clearTimeout(jobTimer);
  if(eventTimer)window.clearTimeout(eventTimer);
  if(httpPollTimer)window.clearTimeout(httpPollTimer);
  missionTimer=undefined;
  jobTimer=undefined;
  eventTimer=undefined;
  httpPollTimer=undefined;
  httpPollRunning=false;
  httpPollFailureCount=0;
  initialized=false;
  knownRemoteIds=new Set();
  missionConflicts=new Set();
  setRealtimeStatus("disabled");
}

export function productionSyncStatus(){
  return {mode:productionRuntimeMode(),initialized,remoteMissionCount:knownRemoteIds.size,realtimeStatus,lastError,lastErrorRetryable,failureCount:httpPollFailureCount,missionConflictCount:missionConflicts.size};
}
