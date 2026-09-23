import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerMissionEnvelope} from "../../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Mission id"});
  const envelope=await getServerMissionEnvelope(id);
  if(!envelope)throw createError({statusCode:404,statusMessage:"Mission not found"});
  return envelope;
});
