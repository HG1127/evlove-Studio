import { cacheLocalEvolutionEvent } from "./event-contract";
import { getLocalProject, listLocalProjects, saveLocalProject, deleteLocalProject } from "./local-store";
import { cacheRemoteEvolutionJob, localProductionPorts } from "./local-production-adapters";
import { getProductionRuntime, productionRuntimeMode } from "./production-runtime";

let initialized=false;
let applyingRemote=false;
let missionTimer:number|undefined;
let jobTimer:number|undefined;
let httpPollTimer:number|undefined;
let httpPollRunning=false;
let knownRemoteIds=new Set<string>();
let realtimeStatus="disabled";
let lastError:string|undefined;

function withRemoteProjection(fn:()=>void){
  applyingRemote=true;
  try{fn();}finally{applyingRemote=false;}
}

async function pushLocalProjection(){
  if(productionRuntimeMode()==="local"||applyingRemote)return;
  const ports=getProductionRuntime();
  const local=listLocalProjects();
  const localIds=new Set(local.map((project)=>project.id));
  await Promise.all(local.map((project)=>ports.missions.save(project)));
  const removed=[...knownRemoteIds].filter((id)=>!localIds.has(id));
  await Promise.all(removed.map((id)=>ports.missions.delete(id)));
  knownRemoteIds=new Set(localIds);
}

export async function flushProductionMissionSync(){
  if(missionTimer){
    window.clearTimeout(missionTimer);
    missionTimer=undefined;
  }
  await pushLocalProjection();
}

async function pushLocalJobs(){
  if(productionRuntimeMode()==="local"||applyingRemote)return;
  const remote=getProductionRuntime();
  const jobs=await localProductionPorts.jobs.list();
  await Promise.all(jobs.map((job)=>remote.jobs.put(job)));
}

function scheduleMissionPush(){
  if(applyingRemote)return;
  if(missionTimer)window.clearTimeout(missionTimer);
  missionTimer=window.setTimeout(()=>{void pushLocalProjection().catch((error)=>console.error("Production mission sync failed",error));},350);
}
function scheduleJobPush(){
  if(applyingRemote)return;
  if(jobTimer)window.clearTimeout(jobTimer);
  jobTimer=window.setTimeout(()=>{void pushLocalJobs().catch((error)=>console.error("Production job sync failed",error));},300);
}

function setRealtimeStatus(status:string,error?:unknown){
  realtimeStatus=status;
  lastError=error===undefined?undefined:error instanceof Error?error.message:String(error);
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-production-realtime-status",{detail:{status,lastError}}));
}

async function hydrateRemoteProjection(){
  const ports=getProductionRuntime();
  const [jobs,events]=await Promise.all([
    ports.jobs.list(),
    ports.events.list(undefined,500),
  ]);
  withRemoteProjection(()=>{
    for(const job of jobs)cacheRemoteEvolutionJob(job);
    for(const event of [...events].reverse())cacheLocalEvolutionEvent(event);
  });
}

async function pollHttpProjection(){
  if(productionRuntimeMode()!=="http"||httpPollRunning)return;
  httpPollRunning=true;
  try{
    const ports=getProductionRuntime();
    const [missions,jobs,events]=await Promise.all([
      ports.missions.list(),
      ports.jobs.list(),
      ports.events.list(undefined,500),
    ]);
    const remoteIds=new Set(missions.map((project)=>project.id));
    const remoteById=new Map(missions.map((project)=>[project.id,project]));
    const localBefore=listLocalProjects();
    const shouldPushLocal=localBefore.some((project)=>{
      const remote=remoteById.get(project.id);
      return !remote||project.updatedAt>remote.updatedAt;
    });
    withRemoteProjection(()=>{
      for(const project of missions){
        const current=getLocalProject(project.id);
        if(!current||project.updatedAt>=current.updatedAt)saveLocalProject(project);
      }
      for(const id of knownRemoteIds)if(!remoteIds.has(id))deleteLocalProject(id);
      for(const job of jobs)cacheRemoteEvolutionJob(job);
      for(const event of [...events].reverse())cacheLocalEvolutionEvent(event);
      knownRemoteIds=remoteIds;
    });
    if(shouldPushLocal)await pushLocalProjection();
    setRealtimeStatus("http-polling");
  }catch(error){
    console.error("HTTP production projection polling failed",error);
    setRealtimeStatus("http-error",error);
  }finally{
    httpPollRunning=false;
  }
}

function startHttpPolling(){
  if(productionRuntimeMode()!=="http")return;
  if(httpPollTimer)window.clearInterval(httpPollTimer);
  httpPollTimer=window.setInterval(()=>{void pollHttpProjection();},3_000);
}

export async function initializeProductionSync(){
  if(initialized||productionRuntimeMode()==="local")return;
  initialized=true;
  setRealtimeStatus("http-connecting");
  window.addEventListener("evolve-projects-changed",scheduleMissionPush);
  window.addEventListener("evolve-parse-job-changed",scheduleJobPush);
  window.addEventListener("evolve-evidence-job-changed",scheduleJobPush);
  window.addEventListener("evolve-run-tasks-changed",scheduleJobPush);
  const ports=getProductionRuntime();
  try{
    await ports.missions.initialize();
    const remote=await ports.missions.list();
    knownRemoteIds=new Set(remote.map((project)=>project.id));
    const local=listLocalProjects();
    const merged=new Map(remote.map((project)=>[project.id,project]));
    for(const project of local){
      const current=merged.get(project.id);
      if(!current||project.updatedAt>=current.updatedAt)merged.set(project.id,project);
    }
    withRemoteProjection(()=>{
      for(const project of merged.values())saveLocalProject(project);
    });
    // Seed an empty/new backend from local state and push any locally newer revision.
    await pushLocalProjection();
    await pushLocalJobs();
    await hydrateRemoteProjection();
    setRealtimeStatus("http-polling");
  }catch(error){
    // Remote production state must never make the local control plane unusable.
    // Keep a recovery poll alive so a transient API/auth outage can heal without a page reload.
    setRealtimeStatus("http-error",error);
    startHttpPolling();
    throw error;
  }
  startHttpPolling();
}

export async function stopProductionSync(){
  window.removeEventListener("evolve-projects-changed",scheduleMissionPush);
  window.removeEventListener("evolve-parse-job-changed",scheduleJobPush);
  window.removeEventListener("evolve-evidence-job-changed",scheduleJobPush);
  window.removeEventListener("evolve-run-tasks-changed",scheduleJobPush);
  if(httpPollTimer)window.clearInterval(httpPollTimer);
  httpPollTimer=undefined;
  httpPollRunning=false;
  initialized=false;
  knownRemoteIds=new Set();
  setRealtimeStatus("disabled");
}

export function productionSyncStatus(){
  return {mode:productionRuntimeMode(),initialized,remoteMissionCount:knownRemoteIds.size,realtimeStatus,lastError};
}
