import {randomUUID} from "node:crypto";
import {ServerWorkflowControlOwnerSchema,type EvolveProject,type ProductionRuntimePorts,type ServerWorkflowControlOwner} from "@evolution/contracts";
import {latestServerWorkflowControlJob,serverControlJobRunId} from "@evolution/harness";
import {getServerMissionEnvelope,compareAndSwapServerMissionEnvelope,MissionRevisionConflictError} from "./production-runtime";
import {readWorkflowRunMetadata} from "./workflow-run-metadata";
import {serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";

export class WorkflowControlOwnerError extends Error{
  constructor(readonly statusCode:409|503,message:string,readonly code="WORKFLOW_CONTROL_CONFLICT"){
    super(message);this.name="WorkflowControlOwnerError";
  }
}

function sameOwner(a:ServerWorkflowControlOwner,b:ServerWorkflowControlOwner){
  return a.controlJobId===b.controlJobId&&a.operationKey===b.operationKey
    &&a.sourceUpdatedAt===b.sourceUpdatedAt&&a.inputFingerprint===b.inputFingerprint
    &&a.requestedAt===b.requestedAt&&a.retryOfControlJobId===b.retryOfControlJobId&&a.retryOfRunId===b.retryOfRunId;
}

/** The envelope revision read for this decision is the only revision eligible for the CAS. */
export async function reserveServerWorkflowControl(
  mission:EvolveProject,operationKey:string,requestedAt:string,
  retry?:{sourceUpdatedAt:string;inputFingerprint:string;retryOfControlJobId:string;retryOfRunId:string},
  read=getServerMissionEnvelope,save=compareAndSwapServerMissionEnvelope,
):Promise<ServerWorkflowControlOwner>{
  if(!operationKey.startsWith(`workflow-control:${mission.id}:`))throw new WorkflowControlOwnerError(409,"控制请求不属于当前 Mission");
  const envelope=await read(mission.id);
  if(!envelope)throw new WorkflowControlOwnerError(409,"Mission 已不存在，未预留后台执行");
  const current=envelope.payload,existing=current.campaign.serverControlOwner;
  const sourceUpdatedAt=retry?.sourceUpdatedAt??(existing?.operationKey===operationKey?existing.sourceUpdatedAt:mission.updatedAt);
  const inputFingerprint=retry?.inputFingerprint??serverMainFlowRecoveryDigest(mission);
  if(existing?.operationKey===operationKey){
    if(existing.sourceUpdatedAt!==sourceUpdatedAt||existing.inputFingerprint!==inputFingerprint
      ||existing.retryOfControlJobId!==retry?.retryOfControlJobId||existing.retryOfRunId!==retry?.retryOfRunId){
      throw new WorkflowControlOwnerError(409,"已有后台预留与相同请求的输入身份不一致");
    }
    if(existing.phase!=="bound"&&serverMainFlowRecoveryDigest(current)!==existing.inputFingerprint){
      throw new WorkflowControlOwnerError(409,"预留后输入已变化，未发送后台启动");
    }
    return existing;
  }
  if(current.updatedAt!==mission.updatedAt||serverMainFlowRecoveryDigest(current)!==serverMainFlowRecoveryDigest(mission)
    ||JSON.stringify(current.campaign.serverControlOwner)!==JSON.stringify(mission.campaign.serverControlOwner)){
    throw new WorkflowControlOwnerError(409,"核验后 Mission 或控制预留已变化，请刷新运行状态");
  }
  const owner=ServerWorkflowControlOwnerSchema.parse({
    schemaVersion:"server-workflow-control-owner-v1",controlJobId:`workflow-control-${randomUUID()}`,
    operationKey,sourceUpdatedAt,inputFingerprint,requestedAt,phase:"reserved",...retry,
  });
  const payload={...current,campaign:{...current.campaign,serverControlOwner:owner},updatedAt:requestedAt};
  try{await save({...envelope,payload,updatedAt:requestedAt});return owner;}
  catch(error){
    if(!(error instanceof MissionRevisionConflictError))throw error;
    const won=(await read(mission.id))?.payload.campaign.serverControlOwner;
    if(won&&sameOwner(won,owner))return won;
    // Different requests cannot adopt a newer revision after their old-state checks.
    throw new WorkflowControlOwnerError(409,"其他请求已取得当前后台预留，请刷新后核对");
  }
}

/** Exactly one CAS winner may send start. Dispatching without a binding remains unknown. */
export async function beginServerWorkflowDispatchForMission(missionId:string,owner:ServerWorkflowControlOwner,read=getServerMissionEnvelope,save=compareAndSwapServerMissionEnvelope){
  const envelope=await read(missionId),current=envelope?.payload.campaign.serverControlOwner;
  if(!envelope||!current||!sameOwner(current,owner))throw new WorkflowControlOwnerError(409,"后台预留已被其他执行替换");
  if(current.phase!=="reserved")throw new WorkflowControlOwnerError(409,"启动结果尚未确认，请保留原请求并查看运行记录","WORKFLOW_START_RESULT_UNKNOWN");
  if(serverMainFlowRecoveryDigest(envelope.payload)!==owner.inputFingerprint)throw new WorkflowControlOwnerError(409,"预留后输入已变化，未发送后台启动");
  try{await save({...envelope,payload:{...envelope.payload,campaign:{...envelope.payload.campaign,serverControlOwner:{...current,phase:"dispatching"}}}});}
  catch(error){if(error instanceof MissionRevisionConflictError)throw new WorkflowControlOwnerError(409,"已有启动请求取得发送权，请使用原请求查看结果","WORKFLOW_START_RESULT_UNKNOWN");throw error;}
}

export async function bindServerWorkflowOwner(missionId:string,owner:ServerWorkflowControlOwner,runId:string,read=getServerMissionEnvelope,save=compareAndSwapServerMissionEnvelope){
  for(let attempt=0;attempt<2;attempt++){
    const envelope=await read(missionId),current=envelope?.payload.campaign.serverControlOwner;
    if(!envelope||!current||!sameOwner(current,owner))throw new WorkflowControlOwnerError(409,"后台预留已变化，不能绑定此 Run");
    if(current.runId&&current.runId!==runId)throw new WorkflowControlOwnerError(409,"后台预留已绑定另一 Run");
    const schedule=envelope.payload.campaign.schedule;
    const bindSchedule=schedule.durableJobId===owner.controlJobId&&schedule.durableScheduledFor===schedule.nextRunAt;
    if(current.runId&&(!bindSchedule||schedule.durableRunId===runId))return;
    if(current.phase!=="dispatching"&&current.phase!=="bound")throw new WorkflowControlOwnerError(409,"此后台预留尚未发送启动");
    try{await save({...envelope,payload:{...envelope.payload,campaign:{...envelope.payload.campaign,
      ...(bindSchedule?{schedule:{...schedule,durableRunId:runId}}:{}),serverControlOwner:{...current,phase:"bound",runId}}}});return;}
    catch(error){if(!(error instanceof MissionRevisionConflictError)||attempt===1)throw error;}
  }
}

/** Ordinary new keys cannot disguise retries or supersede a still active/unknown controller. */
export async function requireServerNewControlAllowed(runtime:Pick<ProductionRuntimePorts,"jobs">,mission:EvolveProject,operationKey:string,scheduled=false){
  const jobs=await runtime.jobs.list(mission.id);
  if(jobs.some(job=>job.idempotencyKey===operationKey))return;
  const owner=mission.campaign.serverControlOwner;
  if(owner?.operationKey===operationKey&&owner.phase==="reserved")return;
  if(owner&&owner.phase!=="bound")throw new WorkflowControlOwnerError(409,"后台启动尚未确认，请使用原请求查看结果","WORKFLOW_START_RESULT_UNKNOWN");
  const latest=latestServerWorkflowControlJob(mission,jobs);
  if(owner&&(!latest||latest.id!==owner.controlJobId||serverControlJobRunId(latest,mission)!==owner.runId))throw new WorkflowControlOwnerError(409,"后台预留与最新 Job/Run 绑定不一致");
  if(!latest)return;
  const runId=serverControlJobRunId(latest,mission);
  if(latest.generation!==1||!runId)throw new WorkflowControlOwnerError(409,"最新后台启动尚未绑定，请保留原请求并查看运行记录","WORKFLOW_START_RESULT_UNKNOWN");
  let state:Awaited<ReturnType<typeof readWorkflowRunMetadata>>;
  try{state=await readWorkflowRunMetadata(runId);}catch{throw new WorkflowControlOwnerError(503,"当前无法核验最新后台状态，请稍后重试");}
  if(!state.exists)throw new WorkflowControlOwnerError(409,"最新后台 Run 不存在，未创建替代执行");
  if(state.status==="pending"||state.status==="running")throw new WorkflowControlOwnerError(409,"已有活动后台执行，请查看当前运行记录");
  if(state.status!=="completed"&&!scheduled)throw new WorkflowControlOwnerError(409,"最新后台执行已失败或取消，请使用明确的后台重试操作");
}
