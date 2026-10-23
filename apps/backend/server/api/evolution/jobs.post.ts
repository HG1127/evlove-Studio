import {randomUUID} from "node:crypto";
import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EvolutionJobCreateRequestSchema,EvolutionJobSchema,PRODUCTION_SCHEMA_VERSIONS} from "@evolution/contracts";
import {createServerJobIdempotent,getServerProductionRuntime,JobStateConflictError} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";
import {requiresSandboxHtmlSourceExecution} from "@evolution/core";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  requireServerDataPlaneAvailable();
  const parsed=EvolutionJobCreateRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  const input=parsed.data;
  const mission=input.missionId?await getServerProductionRuntime().missions.get(input.missionId):undefined;
  if(input.missionId&&!mission){
    throw createError({statusCode:404,statusMessage:"Mission not found"});
  }
  // Generic Job creation does not start a Workflow or acquire the per-Mission
  // transaction lock. HTML Campaigns must only enter through the governed
  // start endpoint, otherwise they could leave a competing queued receipt.
  if(input.type==="campaign"&&mission&&requiresSandboxHtmlSourceExecution(mission)){
    throw createError({statusCode:409,statusMessage:
      "HTML Campaign 请使用 /api/evolution/start；通用 Job 创建入口不能绕过 Mission 原子启动保护"});
  }
  const now=new Date().toISOString();
  const job=EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,id:randomUUID(),
    missionId:input.missionId,type:input.type,status:"queued",label:input.label,
    idempotencyKey:input.idempotencyKey,generation:0,attempts:0,priority:input.priority,
    inputRef:input.inputRef,metadata:input.metadata,createdAt:now,updatedAt:now,
  });
  try{return await createServerJobIdempotent(job);}
  catch(error){
    if(error instanceof JobStateConflictError)throw createError({statusCode:409,statusMessage:error.message});
    throw error;
  }
});
