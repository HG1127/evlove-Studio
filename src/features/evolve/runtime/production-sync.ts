import { subscribeSupabaseProductionRealtime } from "@evolution/adapters";
import { cacheLocalEvolutionEvent } from "./event-contract";
import { getLocalProject, listLocalProjects, saveLocalProject, deleteLocalProject } from "./local-store";
import { cacheRemoteEvolutionJob, localProductionPorts, removeCachedEvolutionJob } from "./local-production-adapters";
import { getProductionRuntime, getSupabaseRuntimeConfig, productionRuntimeMode } from "./production-runtime";

let initialized=false;
let applyingRemote=false;
let missionTimer:number|undefined;
let jobTimer:number|undefined;
let knownRemoteIds=new Set<string>();
let realtimeStatus="disabled";
let stopRealtime:(()=>Promise<void>)|undefined;

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

function setRealtimeStatus(status:string){
  realtimeStatus=status;
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-production-realtime-status",{detail:{status}}));
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

function startSupabaseRealtime(){
  const config=getSupabaseRuntimeConfig();
  if(!config||productionRuntimeMode()!=="supabase")return;
  setRealtimeStatus("connecting");
  const subscription=subscribeSupabaseProductionRealtime(config,{
    onMissionUpsert:(project)=>{
      withRemoteProjection(()=>{
        const current=getLocalProject(project.id);
        if(!current||project.updatedAt>=current.updatedAt)saveLocalProject(project);
        knownRemoteIds.add(project.id);
      });
    },
    onMissionDelete:(id)=>{
      withRemoteProjection(()=>{deleteLocalProject(id);knownRemoteIds.delete(id);});
    },
    onJobUpsert:(job)=>withRemoteProjection(()=>{cacheRemoteEvolutionJob(job);}),
    onJobDelete:(id)=>withRemoteProjection(()=>{removeCachedEvolutionJob(id);}),
    onEventInsert:(event)=>withRemoteProjection(()=>{cacheLocalEvolutionEvent(event);}),
    onArtifactChange:(artifactId,event)=>{
      if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-artifact-metadata-changed",{detail:{artifactId,event}}));
    },
    onStatus:setRealtimeStatus,
    onError:(error)=>{
      console.error("Supabase Realtime error",error);
      setRealtimeStatus("error");
    },
  });
  stopRealtime=subscription.unsubscribe;
}

export async function initializeProductionSync(){
  if(initialized||productionRuntimeMode()==="local")return;
  initialized=true;
  const ports=getProductionRuntime();
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
  window.addEventListener("evolve-projects-changed",scheduleMissionPush);
  window.addEventListener("evolve-parse-job-changed",scheduleJobPush);
  window.addEventListener("evolve-evidence-job-changed",scheduleJobPush);
  window.addEventListener("evolve-run-tasks-changed",scheduleJobPush);
  startSupabaseRealtime();
}

export async function stopProductionSync(){
  window.removeEventListener("evolve-projects-changed",scheduleMissionPush);
  window.removeEventListener("evolve-parse-job-changed",scheduleJobPush);
  window.removeEventListener("evolve-evidence-job-changed",scheduleJobPush);
  window.removeEventListener("evolve-run-tasks-changed",scheduleJobPush);
  if(stopRealtime)await stopRealtime();
  stopRealtime=undefined;
  initialized=false;
  setRealtimeStatus("disabled");
}

export function productionSyncStatus(){
  return {mode:productionRuntimeMode(),initialized,remoteMissionCount:knownRemoteIds.size,realtimeStatus};
}
