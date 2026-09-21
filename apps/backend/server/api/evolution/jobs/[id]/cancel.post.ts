import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerProductionRuntime} from "../../../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Job id"});
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(id);
  if(!job)throw createError({statusCode:404,statusMessage:"Job not found"});
  await runtime.jobs.cancel(id);
  return {ok:true,jobId:id,status:"cancelled"};
});
