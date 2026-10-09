import { randomUUID } from "node:crypto";
import { defineEventHandler, readBody, setResponseStatus } from "nitro/h3";
import { start } from "workflow/api";
import {
  EvolutionJobSchema,
  EvolutionWorkflowRunInputSchema,
  EvolutionWorkflowStartRequestSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  type EvolutionWorkflowStartResponse,
} from "@evolution/contracts";
import {
  bindServerJobWorkflowRun,
  createServerJobIdempotentReceipt,
  getServerProductionRuntime,
  getServerJobByIdempotencyKey,
  isBenignJobBookkeepingConflict,
  JobStateConflictError,
  MissionRevisionConflictError,
} from "../../../src/services/production-runtime";
import { evolutionMissionWorkflow } from "../../../../../workflows/evolution-mission";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {cancelWorkflowRunById,workflowRunIdForJob} from "../../../src/services/workflow-run-control";
import { canRemeasureLegacyServerPlan } from "@evolution/harness";
import { serverMainFlowRecoveryDigest } from "../../../src/services/server-main-flow-recovery";

async function cleanupStartedRun(runId:string){
  try{return {ok:true as const,result:await cancelWorkflowRunById(runId)};}
  catch{return {ok:false as const,reason:"workflow-run-cancel-failed" as const};}
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
      setResponseStatus(event,409);
      return {error:"Durable Scheduler 正在绑定当前计划，请勿重复启动"};
    }
  }
  let freshBaseline: {sourceUpdatedAt:string;inputFingerprint:string}|undefined;
  if(parsed.data.intent){
    if(scheduledFor || !parsed.data.idempotencyKey || !parsed.data.expectedMissionUpdatedAt){
      setResponseStatus(event,400);return {error:"重新测量需要明确请求键与当前 Mission 版本，不能与计划执行混用"};
    }
    const prior=await getServerJobByIdempotencyKey(`workflow-control:${mission.id}:${parsed.data.idempotencyKey}`);
    if(prior){
      const runId=workflowRunIdForJob(prior,mission);
      if(runId && prior.metadata?.workflowIntent==="remeasure-current-input"
        && prior.metadata?.sourceUpdatedAt===parsed.data.expectedMissionUpdatedAt
        && !["failed","cancelled","partial"].includes(prior.status)){
        return {missionId:mission.id,controlJobId:prior.id,runId,status:"queued",reused:true} satisfies EvolutionWorkflowStartResponse;
      }
      setResponseStatus(event,409);return {error:"相同重新测量请求已终止或尚未绑定，请核对状态后刷新重试"};
    }
    if(mission.updatedAt!==parsed.data.expectedMissionUpdatedAt || !canRemeasureLegacyServerPlan(mission)){
      setResponseStatus(event,409);return {error:"当前不是可从当前输入重新测量的旧 Plan 零 Candidate 断点；有 Candidate、审批或安全边界时必须先核对保存的生成身份"};
    }
    freshBaseline={sourceUpdatedAt:mission.updatedAt,inputFingerprint:serverMainFlowRecoveryDigest(mission)};
  }
  const controlJobId=`workflow-control-${randomUUID()}`;
  const operationKey=parsed.data.idempotencyKey??(scheduledFor?`scheduled:${scheduledFor}`:randomUUID());
  const input=EvolutionWorkflowRunInputSchema.parse({
    missionId:mission.id,
    controlJobId,
    requestedAt,
    ...(freshBaseline?{freshBaseline}:{}),
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
      idempotencyKey:`workflow-control:${mission.id}:${operationKey}`,
      generation:1,attempts:0,priority:70,
      ...(freshBaseline?{metadata:{workflowIntent:"remeasure-current-input",sourceUpdatedAt:freshBaseline.sourceUpdatedAt,inputFingerprint:freshBaseline.inputFingerprint}}:{}),
      progress:{percent:0,detail:scheduledFor?`等待 Durable Scheduler 武装至 ${scheduledFor}`:"等待 Durable Workflow 启动"},
      createdAt:requestedAt,updatedAt:requestedAt,
    }));
  }catch(error){
    if(error instanceof JobStateConflictError){
      setResponseStatus(event,409);
      return {error:"Workflow 启动请求与已有 Job 冲突，请使用新的请求键重试"};
    }
    throw error;
  }
  if(created.reused){
    const prior=created.job;
    const priorRunId=workflowRunIdForJob(prior,mission);
    if(!priorRunId||["failed","cancelled","partial"].includes(prior.status)){
      setResponseStatus(event,409);
      return {error:"相同 Workflow 请求已存在但没有可复用的活动 run，请刷新状态后重试",controlJobId:prior.id};
    }
    const response:EvolutionWorkflowStartResponse={
      missionId:mission.id,controlJobId:prior.id,runId:priorRunId,
      status:"queued",...(scheduledFor?{scheduledFor}:{}),reused:true,
    };
    return response;
  }

  if(scheduledFor){
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
      updatedAt:requestedAt,
    };
    await runtime.missions.save(mission);
  }

  let run;
  try{
    run=await start(evolutionMissionWorkflow,[input]);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const current=await runtime.jobs.get(controlJobId);
    if(current){
      const finishedAt=new Date().toISOString();
      await runtime.jobs.put(EvolutionJobSchema.parse({
        ...current,status:"failed",error:message,finishedAt,updatedAt:finishedAt,
      })).catch((writeError)=>{
        if(!isBenignJobBookkeepingConflict(writeError,current.generation))throw writeError;
      });
    }
    if(scheduledFor){
      const currentMission=await runtime.missions.get(mission.id);
      if(currentMission?.campaign.schedule.durableJobId===controlJobId){
        const schedule={...currentMission.campaign.schedule};
        delete schedule.durableJobId;
        delete schedule.durableRunId;
        delete schedule.durableScheduledFor;
        await runtime.missions.save({
          ...currentMission,
          campaign:{...currentMission.campaign,schedule},
          updatedAt:new Date().toISOString(),
        }).catch((writeError)=>{
          if(!(writeError instanceof MissionRevisionConflictError))throw writeError;
        });
      }
    }
    setResponseStatus(event,500);
    return {error:"Workflow 启动失败",message};
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
