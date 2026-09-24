import {createError,defineEventHandler,getRouterParam,readBody} from "nitro/h3";
import {EvolutionJobTransitionRequestSchema} from "@evolution/contracts";
import {getServerProductionRuntime,JobStateConflictError} from "../../../../../src/services/production-runtime";
import {transitionJob} from "../../../../../src/services/job-lifecycle";
import {requireGovernedEvolutionPermission} from "../../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"Job id required"});
  const parsed=EvolutionJobTransitionRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  try{return await transitionJob(getServerProductionRuntime(),id,parsed.data.status,parsed.data.detail);}
  catch(error){
    if(error instanceof JobStateConflictError)throw createError({statusCode:409,statusMessage:error.message});
    if(error instanceof Error&&error.message.startsWith("Job not found"))throw createError({statusCode:404,statusMessage:error.message});
    if(error instanceof Error&&error.message.startsWith("Invalid Job transition"))throw createError({statusCode:409,statusMessage:error.message});
    throw error;
  }
});
