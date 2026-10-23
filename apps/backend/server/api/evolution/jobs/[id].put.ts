import {createError,defineEventHandler,getRouterParam,readBody} from "nitro/h3";
import {EvolutionJobSchema} from "@evolution/contracts";
import {getServerProductionRuntime,JobStateConflictError} from "../../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";
import {requiresSandboxHtmlSourceExecution} from "@evolution/core";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Job id"});
  const job=EvolutionJobSchema.parse(await readBody(event));
  if(job.id!==id)throw createError({statusCode:409,statusMessage:"Job path id 与 payload 不一致"});
  const runtime=getServerProductionRuntime();
  if(job.type==="campaign"&&job.missionId){
    const mission=await runtime.missions.get(job.missionId);
    if(mission&&requiresSandboxHtmlSourceExecution(mission)){
      // PUT may update an existing durable Job, but cannot insert a new HTML
      // Campaign behind the Mission-atomic start RPC's back.
      const persisted=await runtime.jobs.get(job.id);
      if(!persisted){
        throw createError({statusCode:409,statusMessage:
          "HTML Campaign 新建必须通过 /api/evolution/start；不能使用 Job PUT 绕过原子启动保护"});
      }
    }
  }
  try{
    await runtime.jobs.put(job);
    return {ok:true,jobId:id};
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
});
