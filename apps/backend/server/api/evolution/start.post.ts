import { randomUUID } from "node:crypto";
import { defineEventHandler, readBody, setResponseStatus } from "nitro/h3";
import { start } from "workflow/api";
import {
  EvolutionJobSchema,
  EvolutionWorkflowRunInputSchema,
  EvolutionWorkflowStartRequestSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  type EvolutionWorkflowStartResponse,
  type EvolutionWorkflowRunInput,
  type EvolutionJob,
  type EvolveProject,
} from "@evolution/contracts";
import {
  bindServerJobWorkflowRun,
  createServerJobIdempotentReceipt,
  getServerProductionRuntime,
  getServerJobByIdempotencyKey,
  JobStateConflictError,
  MissionRevisionConflictError,
} from "../../../src/services/production-runtime";
import { evolutionMissionWorkflow } from "../../../../../workflows/evolution-mission";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {cancelWorkflowRunById,workflowRunIdForJob} from "../../../src/services/workflow-run-control";
import {reserveServerWorkflowControl,beginServerWorkflowDispatchForMission,bindServerWorkflowOwner,requireServerNewControlAllowed,WorkflowControlOwnerError} from "../../../src/services/workflow-control-owner";
import {prepareServerFailedControlRetry,WorkflowControlRetryError} from "../../../src/services/workflow-failed-control-retry";
import {readWorkflowRunMetadata} from "../../../src/services/workflow-run-metadata";
import { canRemeasureLegacyServerPlan,serverControlJobRunId } from "@evolution/harness";
import { serverMainFlowRecoveryDigest } from "../../../src/services/server-main-flow-recovery";

async function cleanupStartedRun(runId:string){
  try{return {ok:true as const,result:await cancelWorkflowRunById(runId)};}
  catch{return {ok:false as const,reason:"workflow-run-cancel-failed" as const};}
}

async function workflowReuseFailure(runId:string,controlJobId:string,mission?:EvolveProject,operationKey?:string){
  try{
    const metadata=await readWorkflowRunMetadata(runId);
    if(metadata.exists){
      if(metadata.status==="failed"||metadata.status==="cancelled"){
        return {statusCode:409,body:{error:"关联 Workflow 已终止；请核对最新运行记录后使用明确的后台重试操作",controlJobId}};
      }
      const owner=mission?.campaign.serverControlOwner;
      if(owner?.controlJobId===controlJobId){
        if(owner.operationKey!==operationKey||(owner.runId&&owner.runId!==runId))return {statusCode:409,body:{error:"已有请求与后台预留身份不一致",controlJobId}};
        if(owner.phase==="dispatching")await bindServerWorkflowOwner(mission!.id,owner,runId);
        else if(owner.phase!=="bound")return {statusCode:409,body:{error:"后台预留尚未发送，Run 绑定不能复用",controlJobId}};
      }
      return undefined;
    }
    return {statusCode:409,body:{error:"关联 Workflow Run 在当前运行环境中不存在，请核对运行环境和已有请求后重试",controlJobId}};
  }catch{
    return {statusCode:503,body:{error:"当前无法核验已保存的 Workflow Run，请稍后使用相同请求键重试",controlJobId}};
  }
}

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=EvolutionWorkflowStartRequestSchema.safeParse(await readBody(event));
  if(!parsed.success){
    setResponseStatus(event,400);
    return {error:"missionId 无效",issues:parsed.error.issues};
  }
  const runtime=getServerProductionRuntime();
  let mission=await runtime.missions.get(parsed.data.missionId);
  if(!mission){
    setResponseStatus(event,404);
    return {error:"Mission 不存在"};
  }

  const requestedAt=new Date().toISOString();
  const scheduledFor=parsed.data.scheduledFor;
  if(scheduledFor){
    const schedule=mission.campaign.schedule;
    if(!schedule.enabled||schedule.nextRunAt!==scheduledFor||mission.campaign.status!=="scheduled"){
      setResponseStatus(event,409);
      return {error:"计划已取消、改期或不再处于 scheduled 状态，请刷新后重试"};
    }
    if(schedule.durableScheduledFor===scheduledFor&&schedule.durableJobId){
      if(schedule.durableRunId){
        const job=await runtime.jobs.get(schedule.durableJobId);
        if(!job||job.generation!==1||job.type!=="campaign"||job.missionId!==mission.id||!job.idempotencyKey.startsWith(`workflow-control:${mission.id}:`)||serverControlJobRunId(job,mission)!==schedule.durableRunId){
          setResponseStatus(event,409);return {error:"计划执行的 Job/Run 身份已变化",controlJobId:schedule.durableJobId};
        }
        const failure=await workflowReuseFailure(schedule.durableRunId,schedule.durableJobId,mission,job.idempotencyKey);
        if(failure){setResponseStatus(event,failure.statusCode);return failure.body;}
        const response:EvolutionWorkflowStartResponse={
          missionId:mission.id,
          controlJobId:schedule.durableJobId,
          runId:schedule.durableRunId,
          status:"queued",
          scheduledFor,
          reused:true,
        };
        return response;
      }
      if(mission.campaign.serverControlOwner?.controlJobId!==schedule.durableJobId){
        setResponseStatus(event,409);return {error:"Durable Scheduler 正在绑定当前计划，请勿重复启动"};
      }
    }
  }
  let failedControlRetry:EvolutionWorkflowRunInput["failedControlRetry"];
  let retryMetadata:EvolutionJob["metadata"];
  if(parsed.data.intent==="retry-failed-control"){
    try{
      const prepared=await prepareServerFailedControlRetry(runtime,mission,parsed.data);
      if("reused" in prepared){
        const prior=prepared.reused,runId=workflowRunIdForJob(prior,mission);
        if(!runId||["failed","cancelled","partial"].includes(prior.status)){
          setResponseStatus(event,409);return {error:"此后台重试已终止或尚未绑定，请核对最新运行记录",controlJobId:prior.id};
        }
        const failure=await workflowReuseFailure(runId,prior.id,mission,prior.idempotencyKey);
        if(failure){setResponseStatus(event,failure.statusCode);return failure.body;}
        return {missionId:mission.id,controlJobId:prior.id,runId,status:"queued",reused:true} satisfies EvolutionWorkflowStartResponse;
      }
      failedControlRetry=prepared.binding;retryMetadata=prepared.metadata;
    }catch(error){
      if(error instanceof WorkflowControlRetryError){setResponseStatus(event,error.statusCode);return {error:error.message};}
      setResponseStatus(event,503);return {error:"当前无法核验后台重试状态，请使用相同请求稍后重试"};
    }
  }
  let freshBaseline: {sourceUpdatedAt:string;inputFingerprint:string}|undefined;
  if(parsed.data.intent==="remeasure-current-input"){
    if(scheduledFor || !parsed.data.idempotencyKey || !parsed.data.expectedMissionUpdatedAt){
      setResponseStatus(event,400);return {error:"重新测量需要明确请求键与当前 Mission 版本，不能与计划执行混用"};
    }
    const prior=await getServerJobByIdempotencyKey(`workflow-control:${mission.id}:${parsed.data.idempotencyKey}`);
    const reservation=mission.campaign.serverControlOwner;
    const reserved=reservation?.phase==="reserved"&&reservation.operationKey===`workflow-control:${mission.id}:${parsed.data.idempotencyKey}`
      &&reservation.sourceUpdatedAt===parsed.data.expectedMissionUpdatedAt&&!reservation.retryOfControlJobId
      &&reservation.inputFingerprint===serverMainFlowRecoveryDigest(mission);
    if(prior){
      const runId=serverControlJobRunId(prior,mission);
      const identity=prior.generation===1&&prior.type==="campaign"&&prior.missionId===mission.id
        &&prior.metadata?.workflowIntent==="remeasure-current-input"&&prior.metadata?.sourceUpdatedAt===parsed.data.expectedMissionUpdatedAt
        &&!["failed","cancelled","partial"].includes(prior.status);
      if(identity&&runId){
        const failure=await workflowReuseFailure(runId,prior.id,mission,prior.idempotencyKey);
        if(failure){setResponseStatus(event,failure.statusCode);return failure.body;}
        return {missionId:mission.id,controlJobId:prior.id,runId,status:"queued",reused:true} satisfies EvolutionWorkflowStartResponse;
      }
      if(!identity||!reserved||reservation.controlJobId!==prior.id){
        setResponseStatus(event,409);return {error:"相同重新测量请求已终止或尚未绑定，请核对状态后使用原请求重试"};
      }
    }
    if(!reserved&&(mission.updatedAt!==parsed.data.expectedMissionUpdatedAt||!canRemeasureLegacyServerPlan(mission))){
      setResponseStatus(event,409);return {error:"当前不是可从当前输入重新测量的旧 Plan 零 Candidate 断点；有 Candidate、审批或安全边界时必须先核对保存的生成身份"};
    }
    freshBaseline={sourceUpdatedAt:parsed.data.expectedMissionUpdatedAt,inputFingerprint:reserved?reservation.inputFingerprint:serverMainFlowRecoveryDigest(mission)};
  }
  const operationKey=parsed.data.idempotencyKey??(scheduledFor?`scheduled:${scheduledFor}`:randomUUID());
  const fullOperationKey=`workflow-control:${mission.id}:${operationKey}`;
  const existing=(await runtime.jobs.list(mission.id)).find(job=>job.idempotencyKey===fullOperationKey);
  if(existing){
    const existingRun=serverControlJobRunId(existing,mission),reserved=mission.campaign.serverControlOwner;
    if(existing.generation!==1||existing.type!=="campaign"||existing.missionId!==mission.id||["failed","cancelled","partial"].includes(existing.status)){
      setResponseStatus(event,409);return {error:"已有请求的控制身份已变化，请核对运行记录",controlJobId:existing.id};
    }
    if(existingRun){
      const failure=await workflowReuseFailure(existingRun,existing.id,mission,existing.idempotencyKey);
      if(failure){setResponseStatus(event,failure.statusCode);return failure.body;}
      return {missionId:mission.id,controlJobId:existing.id,runId:existingRun,status:"queued",reused:true} satisfies EvolutionWorkflowStartResponse;
    }
    if(!reserved||reserved.controlJobId!==existing.id||reserved.operationKey!==fullOperationKey||reserved.phase!=="reserved"){
      setResponseStatus(event,409);return {error:"后台启动结果尚未确认，请保留原请求并查看运行记录",code:"WORKFLOW_START_RESULT_UNKNOWN",controlJobId:existing.id};
    }
  }
  let owner;
  try{
    if(!failedControlRetry)await requireServerNewControlAllowed(runtime,mission,fullOperationKey,Boolean(scheduledFor));
    owner=await reserveServerWorkflowControl(mission,fullOperationKey,requestedAt,failedControlRetry);
    mission=await runtime.missions.get(mission.id)??mission;
  }catch(error){
    if(error instanceof WorkflowControlOwnerError){setResponseStatus(event,error.statusCode);return {error:error.message,code:error.code};}
    setResponseStatus(event,503);return {error:"无法安全预留后台执行，请保留相同请求稍后重试"};
  }
  const controlJobId=owner.controlJobId;
  const operationRequestedAt=owner.requestedAt;
  const input=EvolutionWorkflowRunInputSchema.parse({
    missionId:mission.id,
    controlJobId,
    controlOwnerKey:owner.operationKey,
    requestedAt:operationRequestedAt,
    ...(freshBaseline?{freshBaseline}:{}),
    ...(failedControlRetry?{failedControlRetry}:{}),
    ...(scheduledFor?{scheduledFor}:{}),
  });
  let created;
  try{
    created=await createServerJobIdempotentReceipt(EvolutionJobSchema.parse({
      schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,
      id:controlJobId,
      missionId:mission.id,
      type:"campaign",
      status:"queued",
      label:scheduledFor?"Evolution Durable Scheduler":"Evolution Workflow Control",
      idempotencyKey:fullOperationKey,
      generation:1,attempts:0,priority:70,
      ...(freshBaseline?{metadata:{workflowIntent:"remeasure-current-input",sourceUpdatedAt:freshBaseline.sourceUpdatedAt,inputFingerprint:freshBaseline.inputFingerprint}}:retryMetadata?{metadata:retryMetadata}:{}),
      progress:{percent:0,detail:scheduledFor?`等待 Durable Scheduler 武装至 ${scheduledFor}`:"等待 Durable Workflow 启动"},
      createdAt:operationRequestedAt,updatedAt:operationRequestedAt,
    }));
  }catch(error){
    if(error instanceof JobStateConflictError){
      setResponseStatus(event,409);
      return {error:"Workflow 启动请求与已有 Job 冲突，请核对后台预留并保留原请求"};
    }
    throw error;
  }
  if(created.job.id!==owner.controlJobId||created.job.missionId!==mission.id||created.job.type!=="campaign"
    ||created.job.generation!==1||created.job.idempotencyKey!==fullOperationKey||["failed","cancelled","partial"].includes(created.job.status)){
    setResponseStatus(event,409);return {error:"Control Job 收据与当前预留身份不一致，未发送后台启动",controlJobId};
  }
  if(created.reused&&owner.phase!=="reserved"){
    const prior=created.job;
    const priorRunId=workflowRunIdForJob(prior,mission);
    if(!priorRunId||["failed","cancelled","partial"].includes(prior.status)){
      setResponseStatus(event,409);
      return {error:"相同 Workflow 请求已存在但没有可复用的活动 run，请刷新状态后重试",controlJobId:prior.id};
    }
    const failure=await workflowReuseFailure(priorRunId,prior.id,mission,prior.idempotencyKey);
    if(failure){setResponseStatus(event,failure.statusCode);return failure.body;}
    const response:EvolutionWorkflowStartResponse={
      missionId:mission.id,controlJobId:prior.id,runId:priorRunId,
      status:"queued",...(scheduledFor?{scheduledFor}:{}),reused:true,
    };
    return response;
  }

  if(scheduledFor){
    mission=await runtime.missions.get(mission.id)??mission;
    mission={
      ...mission,
      campaign:{
        ...mission.campaign,
        schedule:{
          ...mission.campaign.schedule,
          durableJobId:controlJobId,
          durableScheduledFor:scheduledFor,
        },
      },
      updatedAt:operationRequestedAt,
    };
    await runtime.missions.save(mission);
  }

  try{await beginServerWorkflowDispatchForMission(mission.id,owner);}
  catch(error){
    if(error instanceof WorkflowControlOwnerError){setResponseStatus(event,error.statusCode);return {error:error.message,code:error.code,controlJobId};}
    setResponseStatus(event,503);return {error:"无法确认启动发送权，请保留相同请求",controlJobId};
  }
  let run;
  try{
    run=await start(evolutionMissionWorkflow,[input]);
  }catch{
    // Once dispatch permission is recorded, a lost response cannot prove start was not sent.
    setResponseStatus(event,503);
    return {error:"后台启动结果尚未确认，请保留原请求并查看运行记录",code:"WORKFLOW_START_RESULT_UNKNOWN",controlJobId};
  }

  const queued=await runtime.jobs.get(controlJobId);
  if(!queued){
    const cleanup=await cleanupStartedRun(run.runId);
    setResponseStatus(event,cleanup.ok?409:503);
    return {error:cleanup.ok?"Workflow 已启动，但 Control Job 已不存在；请核对清理结果":"Workflow 已启动但取消未确认，请按 runId 检查",runId:run.runId,cleanup:cleanup.ok?cleanup.result:{reason:cleanup.reason}};
  }
  try{
    const bound=await bindServerJobWorkflowRun(controlJobId,queued.generation,run.runId,"output-ref");
    if(["cancelled","failed","partial"].includes(bound.status)){
      const cleanup=await cleanupStartedRun(run.runId);
      setResponseStatus(event,cleanup.ok?409:503);
      return {error:cleanup.ok?`Control Job 已进入 ${bound.status}；请核对 Workflow 清理结果`:"Workflow 已启动但取消未确认，请按 runId 检查",runId:run.runId,cleanup:cleanup.ok?cleanup.result:{reason:cleanup.reason}};
    }
  }catch(error){
    const cleanup=await cleanupStartedRun(run.runId);
    if(!cleanup.ok){
      setResponseStatus(event,503);
      return {error:"Workflow 绑定失败且取消未确认，请按 runId 检查",runId:run.runId,cleanup:{reason:cleanup.reason}};
    }
    if(error instanceof JobStateConflictError){
      setResponseStatus(event,409);
      return {error:"Workflow 已启动，但 runId 绑定发生并发冲突；请核对清理结果",message:error.message,runId:run.runId,cleanup:cleanup.result};
    }
    throw error;
  }

  try{await bindServerWorkflowOwner(mission.id,owner,run.runId);}
  catch{
    setResponseStatus(event,503);return {error:"Run 已启动，控制预留绑定尚未确认，请使用相同请求查看状态",controlJobId,runId:run.runId,code:"WORKFLOW_OWNER_BIND_PENDING"};
  }

  if(scheduledFor){
    for(let attempt=0;attempt<2;attempt++){
      const currentMission=await runtime.missions.get(mission.id);
      if(currentMission?.campaign.schedule.durableJobId!==controlJobId||currentMission.campaign.schedule.durableScheduledFor!==scheduledFor)break;
      try{
        await runtime.missions.save({
          ...currentMission,
          campaign:{
            ...currentMission.campaign,
            schedule:{...currentMission.campaign.schedule,durableRunId:run.runId},
          },
          updatedAt:new Date().toISOString(),
        });
        break;
      }catch(error){
        if(error instanceof MissionRevisionConflictError&&attempt===0)continue;
        if(error instanceof MissionRevisionConflictError)break;
        throw error;
      }
    }
  }

  const response:EvolutionWorkflowStartResponse={
    missionId:mission.id,
    controlJobId,
    runId:run.runId,
    status:"queued",
    ...(scheduledFor?{scheduledFor}:{}),
  };
  return response;
});
