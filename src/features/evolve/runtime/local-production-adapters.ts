import { deleteLocalArtifactBlob, getLocalArtifactBlob, putLocalArtifactBlob } from "./local-artifact-blob-store";
import { appendLocalEvolutionEvent, listLocalEvolutionEvents } from "./event-contract";
import { listEvidenceJobs } from "./evidence-job-store";
import { evidenceJobAsEvolutionJob, EvolutionJobSchema, parseJobAsEvolutionJob, runTaskAsEvolutionJob, type EvolutionJob } from "./job-contract";
import { deleteLocalProject, getLocalProject, initializeLocalProjects, listLocalProjects, saveLocalProject } from "./local-store";
import { listParseJobs } from "./parse-job-store";
import { flushProjectDatabase } from "./project-database";
import type { ProductionRuntimePorts } from "./production-ports";
import { listRunTasks } from "./run-manager";

const GENERIC_JOB_KEY="evolve-studio:unified-jobs:v1";
function readGeneric():EvolutionJob[]{
  if(typeof window==="undefined")return[];
  try{return EvolutionJobSchema.array().parse(JSON.parse(window.localStorage.getItem(GENERIC_JOB_KEY)??"[]"));}catch{return[];}
}
function writeGeneric(items:EvolutionJob[]){if(typeof window!=="undefined")window.localStorage.setItem(GENERIC_JOB_KEY,JSON.stringify(items));}
function latestById(groups:EvolutionJob[][]){
  const byId=new Map<string,EvolutionJob>();
  for(const job of groups.flat()){
    const current=byId.get(job.id);
    if(!current||job.updatedAt>current.updatedAt)byId.set(job.id,job);
  }
  return [...byId.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}

export function cacheRemoteEvolutionJob(jobInput:EvolutionJob){
  const job=EvolutionJobSchema.parse(jobInput);
  const items=readGeneric();
  writeGeneric([job,...items.filter((item)=>item.id!==job.id)].slice(0,1000));
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-unified-job-changed",{detail:{jobId:job.id,status:job.status}}));
  return job;
}

export function removeCachedEvolutionJob(id:string){
  writeGeneric(readGeneric().filter((item)=>item.id!==id));
  if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-unified-job-changed",{detail:{jobId:id,deleted:true}}));
}

export const localProductionPorts:ProductionRuntimePorts={
  missions:{
    initialize:initializeLocalProjects,
    list:async()=>listLocalProjects(),
    get:async(id)=>getLocalProject(id),
    save:async(project)=>{saveLocalProject(project);await flushProjectDatabase();},
    delete:async(id)=>{deleteLocalProject(id);await flushProjectDatabase();},
    flush:flushProjectDatabase,
  },
  artifacts:{put:async(id,blob)=>{await putLocalArtifactBlob(id,blob);},get:getLocalArtifactBlob,delete:deleteLocalArtifactBlob},
  events:{
    append:async(event)=>{appendLocalEvolutionEvent(event);},
    list:async(missionId,limit=200)=>listLocalEvolutionEvents(missionId).slice(0,limit),
  },
  jobs:{
    async list(missionId){
      const generic=readGeneric().filter((job)=>!missionId||job.missionId===missionId);
      const parse=missionId?[]:(await listParseJobs()).map(parseJobAsEvolutionJob);
      const evidence=missionId
        ? (await listEvidenceJobs(missionId)).map(evidenceJobAsEvolutionJob)
        : (await Promise.all(listLocalProjects().map((project)=>listEvidenceJobs(project.id)))).flat().map(evidenceJobAsEvolutionJob);
      const run=listRunTasks().filter((job)=>!missionId||job.projectId===missionId).map(runTaskAsEvolutionJob);
      return latestById([generic,parse,evidence,run]);
    },
    async get(id){return (await this.list()).find((job)=>job.id===id);},
    async put(job){cacheRemoteEvolutionJob(job);},
    async cancel(id){const items=readGeneric();const at=new Date().toISOString();writeGeneric(items.map((job)=>job.id===id?{...job,status:"cancelled" as const,finishedAt:at,updatedAt:at}:job));},
  },
};
