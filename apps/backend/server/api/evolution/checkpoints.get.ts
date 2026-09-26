import {defineEventHandler,getQuery,createError} from "nitro/h3";
import {MissionReadQuerySchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=MissionReadQuerySchema.safeParse(getQuery(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid missionId"});
  const missionId=parsed.data.missionId;
  const mission=await getServerProductionRuntime().missions.get(missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  return {missionId,checkpointId:mission.campaign.checkpoint?.id??null,checkpoint:mission.campaign.checkpoint??null};
});
