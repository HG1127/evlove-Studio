import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {missionEnvelope} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Mission id"});
  const project=await getServerProductionRuntime().missions.get(id);
  if(!project)throw createError({statusCode:404,statusMessage:"Mission not found"});
  return missionEnvelope(project);
});
