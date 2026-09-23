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
  getServerProductionRuntime,
  isBenignJobBookkeepingConflict,
  JobStateConflictError,
  MissionRevisionConflictError,
} from "../../../src/services/production-runtime";
import { evolutionMissionWorkflow } from "../../../../../workflows/evolution-mission";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

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
        };
        return response;
      }
      setResponseStatus(event,409);
      return {error:"Durable Scheduler 正在绑定当前计划，请勿重复启动"};
    }
  }
  const controlJobId=`workflow-control-${randomUUID()}`;
  const input=EvolutionWorkflowRunInputSchema.parse({
    missionId:mission.id,
    controlJobId,
    requestedAt,
    ...(scheduledFor?{scheduledFor}:{}),
  });
  await runtime.jobs.put(EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,
    id:controlJobId,
    missionId:mission.id,
    type:"campaign",
    status:"queued",
    label:scheduledFor?"Evolution Durable Scheduler":"Evolution Workflow Control",
    idempotencyKey:`workflow-control:${controlJobId}`,
    generation:1,attempts:0,priority:70,
    progress:{percent:0,detail:scheduledFor?`等待 Durable Scheduler 武装至 ${scheduledFor}`:"等待 Durable Workflow 启动"},
    createdAt:requestedAt,updatedAt:requestedAt,
  }));

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
  if(queued){
    try{
      await runtime.jobs.put(EvolutionJobSchema.parse({
        ...queued,
        outputRef:run.runId,
        updatedAt:new Date().toISOString(),
      }));
    }catch(error){
      if(!isBenignJobBookkeepingConflict(error,queued.generation)){
        if(error instanceof JobStateConflictError){
          setResponseStatus(event,409);
          return {error:"Workflow 已启动，但 Job bookkeeping 发生并发冲突",message:error.message,runId:run.runId};
        }
        throw error;
      }
    }
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
