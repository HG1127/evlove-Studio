import {
  EvolutionJobSchema,
  createEvolutionEvent,
  type EvolveProject,
  type EvolutionJob,
} from "@evolution/contracts";
import type {ServerControlRuntime} from "./production-runtime";
import {
  cancelBoundWorkflowRun,
  type WorkflowRunCancelResult,
} from "./workflow-run-control";

type CancelRun=(job:EvolutionJob,mission?:EvolveProject)=>Promise<WorkflowRunCancelResult>;

export async function cancelServerJobWithWorkflow(
  runtime:Pick<ServerControlRuntime,"jobs"|"events">,
  job:EvolutionJob,
  mission?:EvolveProject,
  cancelRun:CancelRun=cancelBoundWorkflowRun,
){
  const workflow=await cancelRun(job,mission);
  const workflowTerminal=workflow.statusAfter??workflow.statusBefore;
  const at=new Date().toISOString();

  if(workflowTerminal==="completed"||workflowTerminal==="failed"){
    await runtime.jobs.put(EvolutionJobSchema.parse({
      ...job,
      status:workflowTerminal,
      error:workflowTerminal==="failed"
        ?job.error??"Workflow run failed before cancellation was applied"
        :undefined,
      finishedAt:job.finishedAt??at,
      updatedAt:at,
    }));
  }else{
    await runtime.jobs.cancel(job.id);
  }

  const current=await runtime.jobs.get(job.id)??job;
  if(job.missionId){
    await runtime.events.append(createEvolutionEvent({
      missionId:job.missionId,
      jobId:job.id,
      type:"JobProgress",
      source:"workflow-cancel",
      payload:{
        operation:"cancel",
        generation:job.generation,
        resultingStatus:current.status,
        workflow,
      },
    })).catch(()=>undefined);
  }
  return {job:current,workflow};
}
