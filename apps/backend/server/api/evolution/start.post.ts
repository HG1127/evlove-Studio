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
  listServerActiveMissionCampaignJobs,
  isBenignJobBookkeepingConflict,
  JobStateConflictError,
  MissionRevisionConflictError,
} from "../../../src/services/production-runtime";
import { evolutionMissionWorkflow } from "../../../../../workflows/evolution-mission";
import {requiresSandboxHtmlSourceExecution} from "@evolution/core";
import {serverExperimentRecoveryWait} from "@evolution/harness";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {cancelWorkflowRunById,workflowRunIdForJob} from "../../../src/services/workflow-run-control";
import {assertServerHtmlBrowserExecutionReady} from "../../../src/services/html-browser-preflight";

async function cleanupStartedRun(runId:string){
  try{return {ok:true as const,result:await cancelWorkflowRunById(runId)};}
  catch{return {ok:false as const,reason:"workflow-run-cancel-failed" as const};}
}

/** The identical request may retrieve its existing receipt without rerunning a metered Browser probe. */
function reusedStartReceipt(
  prior:ReturnType<typeof EvolutionJobSchema.parse>,
  mission:NonNullable<Awaited<ReturnType<ReturnType<typeof getServerProductionRuntime>["missions"]["get"]>>>,
  scheduledFor?:string,
):EvolutionWorkflowStartResponse|{error:string;controlJobId:string}{
  const priorRunId=workflowRunIdForJob(prior,mission);
  if(!priorRunId||["failed","cancelled","partial"].includes(prior.status)){
    return {error:"相同 Workflow 请求已存在但没有可复用的活动 run，请刷新状态后重试",controlJobId:prior.id};
  }
  return {
    missionId:mission.id,controlJobId:prior.id,runId:priorRunId,
    status:"queued",...(scheduledFor?{scheduledFor}:{}),reused:true,
  };
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
  const operationKey=parsed.data.idempotencyKey??(scheduledFor?`scheduled:${scheduledFor}`:randomUUID());
  // Recover an already accepted same-request Workflow BEFORE a new metered
  // Browser health probe. Receipt lookup is read-only; the SQL create RPC
  // below remains authoritative for concurrent requests racing this lookup.
  // Non-HTML Mission retries keep the original RPC path unchanged.
  const executableHtmlTarget=requiresSandboxHtmlSourceExecution(mission);
  if(executableHtmlTarget&&(parsed.data.idempotencyKey||scheduledFor)){
    const prior=await getServerJobByIdempotencyKey(`workflow-control:${mission.id}:${operationKey}`);
    if(prior){
      if(prior.missionId!==mission.id||prior.type!=="campaign"){
        setResponseStatus(event,409);
        return {error:"Workflow 请求键绑定的 Mission 或 Job 类型不匹配"};
      }
      const response=reusedStartReceipt(prior,mission,scheduledFor);
      if("error" in response)setResponseStatus(event,409);
      return response;
    }
  }
  // A fresh idempotency key is NOT permission to start a second Campaign
  // against the same HTML Mission. Query the durable Job system of record
  // before any metered Sandbox/AI work. Running, queued and waiting receipts
  // all remain blocking until an authorized reconciliation determines their
  // actual Workflow and checkpoint state. A failed read must fail closed.
  let allowSingleWaitingRetry=false;
  if(executableHtmlTarget){
    const campaigns=(await listServerActiveMissionCampaignJobs(mission.id,100))
      .filter(job=>job.type==="campaign"&&["queued","running","waiting"].includes(job.status));
    // Only a structurally validated frozen-Experiment recovery may reopen a
    // waiting job, and only via its explicit retry key. Generic start requests
    // remain blocked while any Campaign is queued/running/waiting.
    const authorizedExperimentRetry=operationKey.startsWith("experiment-judge-retry:")
      &&Boolean(serverExperimentRecoveryWait(mission));
    // An authorized retry may replace only one clearly identified waiting
    // Workflow. Never exempt every waiting job when duplicates are present.
    const singleRecoverableWait=authorizedExperimentRetry&&campaigns.length===1
      &&campaigns[0].status==="waiting"
      &&campaigns[0].idempotencyKey.startsWith("workflow-control:");
    allowSingleWaitingRetry=Boolean(singleRecoverableWait);
    const blockingCampaigns=singleRecoverableWait?[]:campaigns;
    if(blockingCampaigns.length){
      const latest=blockingCampaigns.at(-1)!;
      setResponseStatus(event,409);
      return {
        error:blockingCampaigns.length>1
          ?"此 Mission 存在多条尚未结算的 Durable Workflow；请先核查运行记录，禁止重复启动"
          :"此 Mission 已有未结束或待核验的 Durable Workflow；请刷新后端状态，禁止重新启动",
        code:"MISSION_WORKFLOW_ALREADY_ACTIVE",
        controlJobId:latest.id,
        ...(workflowRunIdForJob(latest,mission)?{runId:workflowRunIdForJob(latest,mission)}:{}),
      };
    }
  }

  // Standalone HTML Missions require actual isolated Chromium execution.
  // Check before a new Job receipt or billable AI Workflow is created. A
  // compiled adapter or local Chromium smoke cannot substitute this proof.
  await assertServerHtmlBrowserExecutionReady(mission);

  const controlJobId=`workflow-control-${randomUUID()}`;
  const input=EvolutionWorkflowRunInputSchema.parse({
    missionId:mission.id,
    controlJobId,
    requestedAt,
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
      progress:{percent:0,detail:scheduledFor?`等待 Durable Scheduler 武装至 ${scheduledFor}`:"等待 Durable Workflow 启动"},
      createdAt:requestedAt,updatedAt:requestedAt,
    }),executableHtmlTarget?{kind:"html-campaign",allowSingleWaitingRetry}:undefined);
  }catch(error){
    if(error instanceof JobStateConflictError){
      setResponseStatus(event,409);
      if(error.reason==="mission-active"&&error.current?.missionId===mission.id){
        const existing=error.current;
        const priorRunId=workflowRunIdForJob(existing,mission);
        return {
          code:"MISSION_WORKFLOW_ALREADY_ACTIVE",
          error:"并发请求已占用该 Mission 的 Campaign；请刷新后端状态，禁止重复启动",
          controlJobId:existing.id,
          ...(priorRunId?{runId:priorRunId}:{}),
        };
      }
      return {error:error.reason==="mission-missing"
        ?"Mission 在启动时已被移除，请刷新任务列表"
        :"Workflow 启动请求与已有 Job 冲突；请刷新后端任务状态，不要盲目更换请求键"};
    }
    throw error;
  }
  if(created.reused){
    const response=reusedStartReceipt(created.job,mission,scheduledFor);
    if("error" in response)setResponseStatus(event,409);
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
