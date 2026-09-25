import {createEvolutionEvent,EvolutionJobSchema,type EvolutionJobStatus,type ProductionRuntimePorts} from "@evolution/contracts";
import {transitionServerJobWithEvent} from "./production-runtime";
import {workflowRunIdForJob} from "./workflow-run-control";

const terminalStatuses=new Set<EvolutionJobStatus>(["completed","partial","failed","cancelled"]);
const allowedTransitions:Record<EvolutionJobStatus,readonly EvolutionJobStatus[]>={
  queued:["running","failed","cancelled"],
  running:["waiting","completed","partial","failed","cancelled"],
  waiting:["running","failed","cancelled"],
  completed:[],partial:[],failed:[],cancelled:[],
};

export function isAllowedJobTransition(from:EvolutionJobStatus,to:EvolutionJobStatus){
  return from===to||allowedTransitions[from].includes(to);
}

export async function transitionJob(
  runtime:ProductionRuntimePorts,
  jobId:string,
  nextStatus:EvolutionJobStatus,
  detail?:string,
  expected?:{generation:number;updatedAt:string;runId?:string},
){
  const current=await runtime.jobs.get(jobId);
  if(!current)throw new Error(`Job not found: ${jobId}`);
  if(expected&&(current.generation!==expected.generation
    ||current.updatedAt!==expected.updatedAt
    ||workflowRunIdForJob(current)!==expected.runId)){
    throw new Error("Job changed since reconciliation inspection");
  }
  if(!isAllowedJobTransition(current.status,nextStatus)){
    throw new Error(`Invalid Job transition: ${current.status} -> ${nextStatus}`);
  }
  if(current.status===nextStatus)return current;

  const timestamp=new Date().toISOString();
  const next=EvolutionJobSchema.parse({
    ...current,status:nextStatus,
    heartbeatAt:nextStatus==="running"?timestamp:current.heartbeatAt,
    startedAt:nextStatus==="running"?(current.startedAt??timestamp):current.startedAt,
    finishedAt:terminalStatuses.has(nextStatus)?timestamp:undefined,
    updatedAt:timestamp,
  });
  const event=createEvolutionEvent({
    id:`job-transition:${jobId}:${current.generation}:${current.updatedAt}:${nextStatus}`,
    missionId:current.missionId,jobId,
    type:nextStatus==="running"?"JobStarted":nextStatus==="completed"?"JobCompleted":nextStatus==="failed"?"JobFailed":"JobUpdated",
    source:"backend-job-lifecycle",
    payload:{from:current.status,to:nextStatus,detail,generation:current.generation,priorUpdatedAt:current.updatedAt},
  });
  return transitionServerJobWithEvent(next,event);
}

export async function heartbeatJob(runtime:ProductionRuntimePorts,jobId:string){
  const current=await runtime.jobs.get(jobId);
  if(!current)throw new Error(`Job not found: ${jobId}`);
  if(terminalStatuses.has(current.status))return current;
  const timestamp=new Date().toISOString();
  const next=EvolutionJobSchema.parse({...current,heartbeatAt:timestamp,updatedAt:timestamp});
  await runtime.jobs.put(next);
  return next;
}
