import type {EvolveProject,EvolutionJob,EvolutionWorkflowStatusResponse} from "@evolution/contracts";
import {serverMainFlowRecoveryActive} from "./server-main-flow-wait";

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

/** Existing recovery admission only; composition must additionally verify its full SHA binding. */
export function serverRecoveringControlRetrySource(project:EvolveProject,priorControlJobId:string){
  const receipt=project.campaign.serverRecoveryWait;
  if(!receipt || receipt.status!=="recovering" || receipt.resumedByControlJobId!==priorControlJobId
    || project.campaign.stopReason || project.campaign.completedAt
    || !["idle","running"].includes(project.campaign.status))return undefined;
  const admissionView=project.campaign.status==="idle"?project:{...project,campaign:{...project.campaign,status:"idle" as const}};
  return serverMainFlowRecoveryActive(admissionView)?receipt:undefined;
}
export function serverFailedControlRetryEligibility(
  project:EvolveProject,status:EvolutionWorkflowStatusResponse,target:ServerFailedControlRetryTarget,
){
  const job=status.job,owner=project.campaign.serverControlOwner,baseline=project.baselineRun,validation=project.validationRun,acceptance=project.artifactAcceptance;
  // A bound first Run can fail before the normal Campaign start is persisted. This is
  // not permission to resume an arbitrary idle record or reuse any measured outcome.
  const unstartedOwnedIdle=Boolean(job && project.campaign.status==="idle" && project.campaign.currentRound===0
    && !project.campaign.startedAt && !project.campaign.stopReason
    && owner?.phase==="bound" && owner.controlJobId===target.jobId && owner.runId===target.runId
    && owner.operationKey===job.idempotencyKey
    && baseline.status==="idle" && !baseline.startedAt && !baseline.measurementFingerprint && !baseline.runs.length && !baseline.result
    && !project.candidates.length && !project.searchChampion && !project.evolutionArchive.length
    && project.experimentRun.status==="idle" && !project.experimentRun.winnerId && !project.experimentRun.candidateResults.length
    && validation.status==="idle" && !validation.candidateId && !validation.runs.length && !validation.baselineRuns.length
    && !validation.evaluation && !validation.baselineEvaluation
    && acceptance.status==="idle" && !acceptance.attempts && !acceptance.candidateId && !acceptance.frozenArtifacts?.length && !acceptance.acceptedAt
    && !project.attentionRequests?.some(item=>item.blocking && item.status==="pending"));
  const recoveringOwnedIdle=Boolean(job && project.campaign.status==="idle" && owner?.phase==="bound"
    && owner.controlJobId===target.jobId && owner.runId===target.runId && owner.operationKey===job.idempotencyKey
    && serverRecoveringControlRetrySource(project,target.jobId));
  return Boolean(target.missionId===project.id&&(["running","paused"].includes(project.campaign.status)||unstartedOwnedIdle||recoveringOwnedIdle)
    &&job&&job.id===target.jobId&&job.missionId===project.id&&job.type==="campaign"&&job.generation===1
    &&job.idempotencyKey.startsWith(`workflow-control:${project.id}:`)
    &&serverControlJobRunId(job,project)===target.runId&&status.workflow?.exists===true
    &&["failed","cancelled"].includes(status.workflow.status??""));
}

/** The operation survives reloads and lost acknowledgements without modifying the Mission. */
export function serverFailedControlRetryWire(missionId:string,sourceUpdatedAt:string,priorJobId:string,priorRunId:string){
  return JSON.stringify(["server-failed-control-retry-v1",missionId,sourceUpdatedAt,priorJobId,priorRunId]);
}
