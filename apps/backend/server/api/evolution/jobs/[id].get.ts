import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Job id"});
  const job=await getServerProductionRuntime().jobs.get(id);
  if(!job)throw createError({statusCode:404,statusMessage:"Job not found"});
  return job;
});
