import {createError,defineEventHandler,getRouterParam,readBody} from "nitro/h3";
import {EvolutionJobSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Job id"});
  const job=EvolutionJobSchema.parse(await readBody(event));
  if(job.id!==id)throw createError({statusCode:409,statusMessage:"Job path id 与 payload 不一致"});
  await getServerProductionRuntime().jobs.put(job);
  return {ok:true,jobId:id};
});
