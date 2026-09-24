import {defineEventHandler,getQuery,createError} from "nitro/h3";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const missionId=String(getQuery(event).missionId??"").trim();
  if(!missionId)throw createError({statusCode:400,statusMessage:"missionId required"});
  const mission=await getServerProductionRuntime().missions.get(missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  return {missionId,checkpointId:mission.campaign.checkpoint?.id??null,checkpoint:mission.campaign.checkpoint??null};
});
