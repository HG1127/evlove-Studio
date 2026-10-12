import {createHash} from "node:crypto";
import type {EvolveProject,EvolutionJob,EvolutionWorkflowRunInput,EvolutionWorkflowStartRequest,ProductionRuntimePorts} from "@evolution/contracts";
import {serverFailedControlRetryEligibility,serverFailedControlRetryTarget,serverFailedControlRetryWire} from "@evolution/harness";
import {getServerJobByIdempotencyKey} from "./production-runtime";
import {readWorkflowRunMetadata} from "./workflow-run-metadata";
import {serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";

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
    if(existing.missionId!==mission.id||existing.type!=="campaign"||existing.idempotencyKey!==operationKey
      ||existing.metadata?.workflowIntent!=="retry-failed-control"||existing.metadata?.sourceUpdatedAt!==sourceUpdatedAt
      ||existing.metadata?.retryOfControlJobId!==jobId||existing.metadata?.retryOfRunId!==runId){
      throw new WorkflowControlRetryError(409,"已有后台重试的生成身份与当前请求不一致");
    }
    return {reused:existing};
  }
  if(mission.updatedAt!==sourceUpdatedAt)throw new WorkflowControlRetryError(409,"Mission 已变化，请刷新后核对最新后台执行");
  const inputFingerprint=serverMainFlowRecoveryDigest(mission);
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
  const latest=serverFailedControlRetryTarget(current,await runtime.jobs.list(mission.id));
  if(latest?.jobId!==jobId||latest.runId!==runId){
    throw new WorkflowControlRetryError(409,"核验期间出现了更新的后台任务，请刷新运行状态");
  }
  return {
    binding:{sourceUpdatedAt,inputFingerprint,retryOfControlJobId:jobId,retryOfRunId:runId},
    metadata:{workflowIntent:"retry-failed-control",sourceUpdatedAt,inputFingerprint,retryOfControlJobId:jobId,retryOfRunId:runId},
  };
}
