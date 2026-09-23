import {getRun} from "workflow/api";
import type {EvolveProject,EvolutionJob} from "@evolution/contracts";

type WorkflowRunStatus="pending"|"running"|"completed"|"failed"|"cancelled";
type WorkflowRunHandle={
  exists:Promise<boolean>;
  status:Promise<WorkflowRunStatus>;
  cancel():Promise<void>;
};
type WorkflowRunResolver=(runId:string)=>WorkflowRunHandle;

export type WorkflowRunCancelResult={
  runId?:string;
  bound:boolean;
  exists?:boolean;
  statusBefore?:WorkflowRunStatus;
  statusAfter?:WorkflowRunStatus;
  cancelIssued:boolean;
  reason:
    |"workflow-run-unbound"
    |"workflow-run-missing"
    |"workflow-run-cancelled"
    |"workflow-run-terminal"
    |"workflow-run-raced-terminal";
};

const TERMINAL=new Set<WorkflowRunStatus>(["completed","failed","cancelled"]);

export function workflowRunIdForJob(job:EvolutionJob,mission?:EvolveProject){
  const metadataRunId=typeof job.metadata?.runId==="string"?job.metadata.runId.trim():"";
  if(metadataRunId)return metadataRunId;
  const workflowControl=job.type==="campaign"&&job.idempotencyKey.startsWith("workflow-control:");
  if(workflowControl&&job.outputRef?.trim())return job.outputRef.trim();
  if(workflowControl
    &&mission?.campaign.schedule.durableJobId===job.id
    &&mission.campaign.schedule.durableRunId?.trim()){
    return mission.campaign.schedule.durableRunId.trim();
  }
  return undefined;
}

export async function cancelWorkflowRunById(
  runId:string,
  resolveRun:WorkflowRunResolver=(id)=>getRun(id) as WorkflowRunHandle,
):Promise<WorkflowRunCancelResult>{
  const run=resolveRun(runId);
  const exists=await run.exists;
  if(!exists)return {runId,bound:true,exists:false,cancelIssued:false,reason:"workflow-run-missing"};

  const statusBefore=await run.status;
  if(TERMINAL.has(statusBefore)){
    return {
      runId,bound:true,exists:true,statusBefore,statusAfter:statusBefore,
      cancelIssued:false,reason:"workflow-run-terminal",
    };
  }

  try{
    await run.cancel();
    return {
      runId,bound:true,exists:true,statusBefore,statusAfter:"cancelled",
      cancelIssued:true,reason:"workflow-run-cancelled",
    };
  }catch(error){
    const statusAfter=await run.status.catch(()=>undefined);
    if(statusAfter&&TERMINAL.has(statusAfter)){
      return {
        runId,bound:true,exists:true,statusBefore,statusAfter,
        cancelIssued:false,reason:"workflow-run-raced-terminal",
      };
    }
    throw error;
  }
}

export async function cancelBoundWorkflowRun(
  job:EvolutionJob,
  mission?:EvolveProject,
  resolveRun:WorkflowRunResolver=(runId)=>getRun(runId) as WorkflowRunHandle,
):Promise<WorkflowRunCancelResult>{
  const runId=workflowRunIdForJob(job,mission);
  if(!runId)return {bound:false,cancelIssued:false,reason:"workflow-run-unbound"};

  return cancelWorkflowRunById(runId,resolveRun);
}
