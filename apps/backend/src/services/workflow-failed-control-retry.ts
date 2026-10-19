import {createHash} from "node:crypto";
import type {EvolveProject,EvolutionJob,EvolutionWorkflowRunInput,EvolutionWorkflowStartRequest,ProductionRuntimePorts} from "@evolution/contracts";
import {serverFailedControlRetryEligibility,serverFailedControlRetryTarget,serverFailedControlRetryWire,serverControlJobRunId,serverRecoveringControlRetrySource} from "@evolution/harness";
import {getServerJobByIdempotencyKey} from "./production-runtime";
import {readWorkflowRunMetadata} from "./workflow-run-metadata";
import {hasServerMainFlowRecoveryBinding,serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";

export class WorkflowControlRetryError extends Error{
  constructor(readonly statusCode:400|409|503,message:string){super(message);this.name="WorkflowControlRetryError";}
}

export async function prepareServerFailedControlRetry(
  runtime:Pick<ProductionRuntimePorts,"missions"|"jobs">,
  mission:EvolveProject,request:EvolutionWorkflowStartRequest,
  readPrior:(key:string)=>Promise<EvolutionJob|undefined>=getServerJobByIdempotencyKey,
  readRun:typeof readWorkflowRunMetadata=readWorkflowRunMetadata,
):Promise<{reused:EvolutionJob}|{binding:NonNullable<EvolutionWorkflowRunInput["failedControlRetry"]>;metadata:NonNullable<EvolutionJob["metadata"]>}>{
  const {expectedMissionUpdatedAt:sourceUpdatedAt,retryOfControlJobId:jobId,retryOfRunId:runId,idempotencyKey}=request;
  if(request.intent!=="retry-failed-control"||!sourceUpdatedAt||!jobId||!runId||!idempotencyKey||request.scheduledFor){
    throw new WorkflowControlRetryError(400,"后台重试需要明确的旧 Job/Run、Mission 版本和稳定请求键");
  }
  const key="server-failed-control-retry:"+createHash("sha256")
    .update(serverFailedControlRetryWire(mission.id,sourceUpdatedAt,jobId,runId)).digest("hex");
  if(key!==idempotencyKey)throw new WorkflowControlRetryError(400,"后台重试请求键与保存的执行身份不一致");
  const operationKey=`workflow-control:${mission.id}:${key}`;
  const existing=await readPrior(operationKey);
  if(existing){
    if(existing.missionId!==mission.id||existing.type!=="campaign"||existing.generation!==1||existing.idempotencyKey!==operationKey
      ||existing.metadata?.workflowIntent!=="retry-failed-control"||existing.metadata?.sourceUpdatedAt!==sourceUpdatedAt
      ||existing.metadata?.retryOfControlJobId!==jobId||existing.metadata?.retryOfRunId!==runId){
      throw new WorkflowControlRetryError(409,"已有后台重试的生成身份与当前请求不一致");
    }
    const metadataRun=typeof existing.metadata?.runId==="string"?existing.metadata.runId.trim():undefined;
    if(metadataRun&&existing.outputRef?.trim()&&metadataRun!==existing.outputRef.trim()){
      throw new WorkflowControlRetryError(409,"已有后台重试的 Run 绑定相互冲突");
    }
    if(serverControlJobRunId(existing,mission))return {reused:existing};
    const owner=mission.campaign.serverControlOwner;
    if(!owner||owner.phase!=="reserved"||owner.controlJobId!==existing.id||owner.operationKey!==operationKey){
      throw new WorkflowControlRetryError(409,"后台启动结果尚未确认，请保留原请求并查看运行记录");
    }
    // A persisted reserved phase proves no caller acquired permission to send start.
    return {binding:{sourceUpdatedAt:owner.sourceUpdatedAt,inputFingerprint:owner.inputFingerprint,
      retryOfControlJobId:jobId,retryOfRunId:runId},metadata:existing.metadata};
  }
  const reservation=mission.campaign.serverControlOwner;
  if(reservation?.operationKey===operationKey&&reservation.phase==="reserved"
    &&reservation.sourceUpdatedAt===sourceUpdatedAt&&reservation.retryOfControlJobId===jobId&&reservation.retryOfRunId===runId
    &&serverMainFlowRecoveryDigest(mission)===reservation.inputFingerprint){
    return {binding:{sourceUpdatedAt,inputFingerprint:reservation.inputFingerprint,retryOfControlJobId:jobId,retryOfRunId:runId},
      metadata:{workflowIntent:"retry-failed-control",sourceUpdatedAt,inputFingerprint:reservation.inputFingerprint,retryOfControlJobId:jobId,retryOfRunId:runId}};
  }
  if(reservation&&(reservation.controlJobId!==jobId||reservation.phase!=="bound"||reservation.runId!==runId)){
    throw new WorkflowControlRetryError(409,"已有其他后台控制预留，请刷新运行状态");
  }
  if(mission.updatedAt!==sourceUpdatedAt)throw new WorkflowControlRetryError(409,"Mission 已变化，请刷新后核对最新后台执行");
  const inputFingerprint=serverMainFlowRecoveryDigest(mission);
  requireRecoveringControlRetryBinding(mission,jobId);
  const target=serverFailedControlRetryTarget(mission,await runtime.jobs.list(mission.id));
  if(!target||target.jobId!==jobId||target.runId!==runId){
    throw new WorkflowControlRetryError(409,"已有更新或未绑定的后台任务，请刷新运行状态后重试");
  }
  const prior=await runtime.jobs.get(jobId);
  let workflow:Awaited<ReturnType<typeof readRun>>;
  try{workflow=await readRun(runId);}
  catch{throw new WorkflowControlRetryError(503,"当前无法核验旧 Workflow 终态，请使用相同请求稍后重试");}
  if(!serverFailedControlRetryEligibility(mission,{job:prior,workflow,events:[]},target)){
    throw new WorkflowControlRetryError(409,"旧 Workflow 未明确失败或取消，不能创建后台重试");
  }
  const current=await runtime.missions.get(mission.id);
  if(!current||current.updatedAt!==sourceUpdatedAt||serverMainFlowRecoveryDigest(current)!==inputFingerprint){
    throw new WorkflowControlRetryError(409,"后台状态核验期间 Mission 已变化，请刷新后重试");
  }
  requireRecoveringControlRetryBinding(current,jobId);
  const latest=serverFailedControlRetryTarget(current,await runtime.jobs.list(mission.id));
  if(latest?.jobId!==jobId||latest.runId!==runId){
    throw new WorkflowControlRetryError(409,"核验期间出现了更新的后台任务，请刷新运行状态");
  }
  return {
    binding:{sourceUpdatedAt,inputFingerprint,retryOfControlJobId:jobId,retryOfRunId:runId},
    metadata:{workflowIntent:"retry-failed-control",sourceUpdatedAt,inputFingerprint,retryOfControlJobId:jobId,retryOfRunId:runId},
  };
}

function requireRecoveringControlRetryBinding(project:EvolveProject,priorControlJobId:string){
  if(project.campaign.serverRecoveryWait?.status!=="recovering")return;
  if(!serverRecoveringControlRetrySource(project,priorControlJobId)||!hasServerMainFlowRecoveryBinding(project))
    throw new WorkflowControlRetryError(409,"恢复断点的原控制身份、完整输入或运行条件已变化，未启动后台重试");
}

/** Transfer only an explicitly admitted failed controller's existing recovery, never a new budget/paper. */
export function transferServerFailedControlRecovery(project:EvolveProject,input:EvolutionWorkflowRunInput):EvolveProject{
  const retry=input.failedControlRetry,receipt=project.campaign.serverRecoveryWait;
  if(!retry || receipt?.status!=="recovering")return project;
  const owner=project.campaign.serverControlOwner;
  if(!owner || owner.phase!=="bound" || owner.controlJobId!==input.controlJobId || owner.operationKey!==input.controlOwnerKey
    || owner.retryOfControlJobId!==retry.retryOfControlJobId || owner.retryOfRunId!==retry.retryOfRunId
    || owner.sourceUpdatedAt!==retry.sourceUpdatedAt || owner.inputFingerprint!==retry.inputFingerprint
    || serverMainFlowRecoveryDigest(project)!==retry.inputFingerprint)
    throw new WorkflowControlRetryError(409,"恢复接管的当前预留与明确失败重试不一致");
  requireRecoveringControlRetryBinding(project,receipt.resumedByControlJobId!);
  if(receipt.resumedByControlJobId===input.controlJobId)return project;
  if(receipt.resumedByControlJobId!==retry.retryOfControlJobId)
    throw new WorkflowControlRetryError(409,"恢复断点不属于已核验失败的原控制，未接管其他执行");
  return {...project,campaign:{...project.campaign,status:"idle",serverRecoveryWait:{...receipt,resumedByControlJobId:input.controlJobId}},updatedAt:input.requestedAt};
}