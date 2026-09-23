import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerProductionRuntime,JobStateConflictError} from "../../../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Job id"});
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(id);
  if(!job)throw createError({statusCode:404,statusMessage:"Job not found"});
  try{
    await runtime.jobs.cancel(id);
  }catch(error){
    if(error instanceof JobStateConflictError){
      throw createError({
        statusCode:409,
        statusMessage:error.message,
        data:{code:error.code,jobId:error.jobId,reason:error.reason,current:error.current},
      });
    }
    throw error;
  }
  const current=await runtime.jobs.get(id);
  return {ok:true,jobId:id,status:current?.status??job.status};
});
