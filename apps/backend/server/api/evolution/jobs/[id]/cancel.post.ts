import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {EvolutionJobCancelResponseSchema} from "@evolution/contracts";
import {getServerProductionRuntime,JobStateConflictError} from "../../../../../src/services/production-runtime";
import {cancelServerJobWithWorkflow} from "../../../../../src/services/job-workflow-cancel";
import {requireGovernedEvolutionPermission} from "../../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Job id"});
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(id);
  if(!job)throw createError({statusCode:404,statusMessage:"Job not found"});
  const mission=job.missionId?await runtime.missions.get(job.missionId):undefined;
  try{
    const result=await cancelServerJobWithWorkflow(runtime,job,mission);
    if(result.requiresReconciliation){
      throw createError({statusCode:409,statusMessage:"Workflow completed but Job outcome is unresolved",data:{jobId:id,status:result.job.status,workflow:result.workflow}});
    }
    return EvolutionJobCancelResponseSchema.parse({ok:true,jobId:id,status:result.job.status,workflow:result.workflow});
  }catch(error){
    if(error instanceof JobStateConflictError){
      throw createError({
        statusCode:409,
        statusMessage:error.message,
        data:{code:error.code,jobId:error.jobId,reason:error.reason,current:error.current},
      });
    }
    if(error&&typeof error==="object"&&"statusCode" in error)throw error;
    throw createError({
      statusCode:502,
      statusMessage:"Workflow cancel failed",
      data:{jobId:id,message:error instanceof Error?error.message:String(error)},
    });
  }
});
