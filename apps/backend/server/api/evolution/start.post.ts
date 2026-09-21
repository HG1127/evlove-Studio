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
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
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
  const mission=await runtime.missions.get(parsed.data.missionId);
  if(!mission){
    setResponseStatus(event,404);
    return {error:"Mission 不存在"};
  }

  const requestedAt=new Date().toISOString();
  const controlJobId=`workflow-control-${randomUUID()}`;
  const input=EvolutionWorkflowRunInputSchema.parse({
    missionId:mission.id,
    controlJobId,
    requestedAt,
  });
  await runtime.jobs.put(EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,
    id:controlJobId,
    missionId:mission.id,
    type:"campaign",
    status:"queued",
    label:"Evolution Workflow Control",
    idempotencyKey:`workflow-control:${controlJobId}`,
    generation:1,attempts:0,priority:70,
    progress:{percent:0,detail:"等待 Durable Workflow 启动"},
    createdAt:requestedAt,updatedAt:requestedAt,
  }));

  try{
    const run=await start(evolutionMissionWorkflow,[input]);
    const queued=await runtime.jobs.get(controlJobId);
    if(queued)await runtime.jobs.put(EvolutionJobSchema.parse({
      ...queued,
      outputRef:run.runId,
      updatedAt:new Date().toISOString(),
    }));
    const response:EvolutionWorkflowStartResponse={
      missionId:mission.id,
      controlJobId,
      runId:run.runId,
      status:"queued",
    };
    return response;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const current=await runtime.jobs.get(controlJobId);
    if(current)await runtime.jobs.put(EvolutionJobSchema.parse({
      ...current,status:"failed",error:message,finishedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    }));
    setResponseStatus(event,500);
    return {error:"Workflow 启动失败",message};
  }
});
