import type {EvolveProject,EvolutionJob,EvolutionWorkflowStatusResponse} from "@evolution/contracts";

export type ServerFailedControlRetryTarget={missionId:string;jobId:string;runId:string;sourceUpdatedAt?:string};

export function serverControlJobRunId(job:EvolutionJob,project:EvolveProject){
  const metadata=typeof job.metadata?.runId==="string"?job.metadata.runId.trim():undefined;
  const output=job.outputRef?.trim();
  if(metadata&&output&&metadata!==output)return undefined;
  const scheduled=project.campaign.schedule.durableJobId===job.id?project.campaign.schedule.durableRunId?.trim():undefined;
  const runId=metadata||output||scheduled;
  if(scheduled&&runId&&scheduled!==runId)return undefined;
  return runId;
}

export function latestServerWorkflowControlJob(project:EvolveProject,jobs:EvolutionJob[]){
  return jobs.filter(job=>job.missionId===project.id&&job.type==="campaign"
    &&job.idempotencyKey.startsWith(`workflow-control:${project.id}:`))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
}

/** Select latest; only a proven unsent reservation may resume its original failed source. */
export function serverFailedControlRetryTarget(project:EvolveProject,jobs:EvolutionJob[]):ServerFailedControlRetryTarget|undefined{
  const latest=latestServerWorkflowControlJob(project,jobs),owner=project.campaign.serverControlOwner;
  if(owner?.phase==="reserved"&&owner.retryOfControlJobId&&owner.retryOfRunId
    &&(!latest||latest.id===owner.controlJobId||latest.id===owner.retryOfControlJobId)){
    const prior=jobs.find(job=>job.id===owner.retryOfControlJobId);
    if(prior?.generation===1&&serverControlJobRunId(prior,project)===owner.retryOfRunId){
      return {missionId:project.id,jobId:prior.id,runId:owner.retryOfRunId,sourceUpdatedAt:owner.sourceUpdatedAt};
    }
  }
  if(!latest||latest.generation!==1)return undefined;
  const runId=serverControlJobRunId(latest,project);
  return runId?{missionId:project.id,jobId:latest.id,runId}:undefined;
}

export function serverFailedControlRetryEligibility(
  project:EvolveProject,status:EvolutionWorkflowStatusResponse,target:ServerFailedControlRetryTarget,
){
  const job=status.job;
  return Boolean(target.missionId===project.id&&["running","paused"].includes(project.campaign.status)
    &&job&&job.id===target.jobId&&job.missionId===project.id&&job.type==="campaign"&&job.generation===1
    &&job.idempotencyKey.startsWith(`workflow-control:${project.id}:`)
    &&serverControlJobRunId(job,project)===target.runId&&status.workflow?.exists===true
    &&["failed","cancelled"].includes(status.workflow.status??""));
}

/** The operation survives reloads and lost acknowledgements without modifying the Mission. */
export function serverFailedControlRetryWire(missionId:string,sourceUpdatedAt:string,priorJobId:string,priorRunId:string){
  return JSON.stringify(["server-failed-control-retry-v1",missionId,sourceUpdatedAt,priorJobId,priorRunId]);
}
