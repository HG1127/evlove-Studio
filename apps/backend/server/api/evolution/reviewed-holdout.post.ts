import {createError,defineEventHandler,readBody,setResponseStatus} from "nitro/h3";
import {start} from "workflow/api";
import {createEvolutionEvent,EvolutionJobSchema,PRODUCTION_SCHEMA_VERSIONS,ReviewedHoldoutRequestSchema,ReviewedHoldoutRunInputSchema,
  type EvolutionWorkflowStartResponse,type ReviewedHoldoutRunInput} from "@evolution/contracts";
import {getServerProductionRuntime,createServerJobIdempotentReceipt,bindServerJobWorkflowRun} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireReviewedHuman,reviewedSha,sameReviewedHoldoutScope} from "../../../src/services/reviewed-holdout-identity";
import {previewReviewedHoldout} from "../../../src/services/reviewed-holdout-admission";
import {previewReviewedInvalidRecovery} from "../../../src/services/reviewed-holdout-invalid-recovery";
import {requireServerNewControlAllowed,reserveServerWorkflowControl,beginServerWorkflowDispatchForMission,bindServerWorkflowOwner,WorkflowControlOwnerError} from "../../../src/services/workflow-control-owner";
import {readWorkflowRunMetadata} from "../../../src/services/workflow-run-metadata";
import {workflowRunIdForJob} from "../../../src/services/workflow-run-control";
import {appendWorkflowControlEvent} from "../../../src/services/workflow-control-events";
import {evolutionReviewedHoldoutWorkflow} from "../../../../../workflows/evolution-reviewed-holdout";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"mission.execute");
  try{requireReviewedHuman(actor);}catch{throw createError({statusCode:403,statusMessage:"需要人工操作员确认。"});}
  const parsed=ReviewedHoldoutRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"缺少明确人工确认或精确文件身份。"});
  const request=parsed.data,runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(request.binding.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission 不存在。"});
  const key='workflow-control:'+mission.id+':reviewed-holdout:'+request.idempotencyKey;
  const jobs=await runtime.jobs.list(mission.id);
  const prior=jobs.find(j=>j.idempotencyKey===key);
  const requestSha=reviewedSha(request);
  if(prior){
    if(prior.type!=="campaign"||prior.generation!==1||prior.missionId!==mission.id
      ||prior.metadata?.workflowIntent!=="reviewed-holdout"||prior.metadata?.requestSha256!==requestSha
      ||prior.metadata?.reviewedActorId!==actor.id||["failed","cancelled","partial"].includes(prior.status))
      throw createError({statusCode:409,statusMessage:"相同请求与已保存的人工作业不一致或已终止。"});
    const runId=workflowRunIdForJob(prior,mission);
    if(runId){
      const state=await readWorkflowRunMetadata(runId);
      if(!state.exists||state.status==="failed"||state.status==="cancelled")throw createError({statusCode:409,statusMessage:"已保存 Run 不存在或已失败。"});
      const owner=mission.campaign.serverControlOwner;
      if(!owner||owner.controlJobId!==prior.id||owner.operationKey!==key)throw createError({statusCode:409,statusMessage:"后台控制归属已变化。"});
      if(owner.phase==="dispatching")await bindServerWorkflowOwner(mission.id,owner,runId);
      if(owner.phase!=="bound"&&owner.phase!=="dispatching")throw createError({statusCode:409,statusMessage:"后台预留尚未发送。"});
      return {missionId:mission.id,controlJobId:prior.id,runId,status:"queued",reused:true} satisfies EvolutionWorkflowStartResponse;
    }
  }
  const priorScopeExists=jobs.some(j=>j.idempotencyKey!==key&&j.missionId===mission.id&&j.type==="campaign"&&j.generation===1
    &&j.metadata?.workflowIntent==="reviewed-holdout"&&sameReviewedHoldoutScope(j.metadata.reviewedApproval,request.binding));
  if(priorScopeExists&&!request.invalidOutputRecovery)
    throw createError({statusCode:409,statusMessage:"同一复核范围已有作业；请使用原请求键核对结果，不能新建评审重试。"});
  const reservation=mission.campaign.serverControlOwner;
  const reserved=reservation?.operationKey===key&&reservation.phase==="reserved"
    &&reservation.sourceUpdatedAt===request.binding.sourceUpdatedAt&&reservation.inputFingerprint===request.binding.inputSha256;
  let preview;
  try{
    if(request.invalidOutputRecovery&&!priorScopeExists)throw new Error("没有可恢复的旧复核作业。");
    preview=request.invalidOutputRecovery?await previewReviewedInvalidRecovery(mission,prior&&reserved?{controlJobId:prior.id,operationKey:key}:undefined):await previewReviewedHoldout(mission);
    if(reviewedSha(preview.invalidOutputRecovery)!==reviewedSha(request.invalidOutputRecovery))throw new Error("旧失败或私有 SDK 核验记录已变化，请重新人工确认。");
  }
  catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:"无法核验复核范围。"});}
  const expected={...preview.binding,...(reserved?{sourceUpdatedAt:reservation.sourceUpdatedAt}:{})};
  if(reviewedSha(expected)!==reviewedSha(request.binding))throw createError({statusCode:409,statusMessage:"复核对象、隐藏卷或 Mission 版本已变化。"});
  if(prior&&(!reserved||reservation.controlJobId!==prior.id))throw createError({statusCode:409,statusMessage:"启动结果尚未确认，请保留原请求。"});
  let owner;
  try{
    await requireServerNewControlAllowed(runtime,mission,key);
    owner=await reserveServerWorkflowControl(mission,key,new Date().toISOString());
  }catch(error){
    if(error instanceof WorkflowControlOwnerError)throw createError({statusCode:error.statusCode,statusMessage:error.message});
    throw error;
  }
  const input=ReviewedHoldoutRunInputSchema.parse({
    missionId:mission.id,controlJobId:owner.controlJobId,controlOwnerKey:key,requestedAt:owner.requestedAt,
    approval:{schemaVersion:"reviewed-holdout-approval-v1",request,actorId:actor.id,actorSource:actor.source,confirmedAt:owner.requestedAt},
  });
  const created=await createServerJobIdempotentReceipt(EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,id:owner.controlJobId,missionId:mission.id,type:"campaign",status:"queued",
    label:"人工复核 · 同一冻结文件隔离隐藏验证",idempotencyKey:key,generation:1,attempts:0,priority:70,
    metadata:{workflowIntent:"reviewed-holdout",requestSha256:requestSha,reviewedActorId:actor.id,reviewedApproval:input.approval},
    progress:{percent:0,detail:"保留 REVIEW，等待隔离验证"},createdAt:owner.requestedAt,updatedAt:owner.requestedAt,
  }));
  if(created.job.id!==owner.controlJobId||created.job.generation!==1||created.job.type!=="campaign"
    ||created.job.missionId!==mission.id||created.job.idempotencyKey!==key
    ||created.job.metadata?.requestSha256!==requestSha||created.job.metadata?.reviewedActorId!==actor.id
    ||reviewedSha(created.job.metadata?.reviewedApproval)!==reviewedSha(input.approval)
    ||["completed","failed","cancelled","partial"].includes(created.job.status))
    throw createError({statusCode:409,statusMessage:"后台预留与人工作业收据不一致。"});
  await appendWorkflowControlEvent(runtime.events,createEvolutionEvent({
    id:'evt-'+input.controlJobId+'-reviewed-holdout-authorized',missionId:mission.id,jobId:input.controlJobId,
    type:"MissionUpdated",source:"human-reviewed-holdout",at:input.requestedAt,
    payload:{approval:input.approval,priorBaseline:mission.baselineRun,priorValidation:mission.validationRun,
      priorRecoveryWait:mission.campaign.serverRecoveryWait,priorCheckpoint:mission.campaign.checkpoint,
      notice:"Original REVIEW remains unchanged; fresh same-paper evidence and Gate F remain mandatory."},
  }));
  await beginServerWorkflowDispatchForMission(mission.id,owner);
  let run;
  try{run=await start(evolutionReviewedHoldoutWorkflow,[input]);}
  catch{throw createError({statusCode:503,statusMessage:"启动结果尚未确认；请保留相同请求键核对，不能重复创建。"});}
  try{
    await bindServerJobWorkflowRun(input.controlJobId,1,run.runId,"output-ref");
    await bindServerWorkflowOwner(mission.id,owner,run.runId);
  }catch{
    // Binding may have succeeded despite a lost response. Same-key replay can recover it.
    setResponseStatus(event,503);
    return {error:"Run 已启动，绑定尚未确认；请保留相同请求。",code:"WORKFLOW_OWNER_BIND_PENDING",controlJobId:input.controlJobId,runId:run.runId};
  }
  return {missionId:mission.id,controlJobId:input.controlJobId,runId:run.runId,status:"queued"} satisfies EvolutionWorkflowStartResponse;
});

// Exported type is only for server tests, not another dispatch path.
export type ReviewedHoldoutServerInput=ReviewedHoldoutRunInput;
