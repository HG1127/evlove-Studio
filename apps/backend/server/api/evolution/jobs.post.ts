import {randomUUID} from "node:crypto";
import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EvolutionJobCreateRequestSchema,EvolutionJobSchema,PRODUCTION_SCHEMA_VERSIONS} from "@evolution/contracts";
import {createServerJobIdempotent,getServerProductionRuntime,JobStateConflictError} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  requireServerDataPlaneAvailable();
  const parsed=EvolutionJobCreateRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  const input=parsed.data;
  if(input.missionId&&!await getServerProductionRuntime().missions.get(input.missionId)){
    throw createError({statusCode:404,statusMessage:"Mission not found"});
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
