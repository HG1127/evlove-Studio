import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {analyzeMissionOutcome} from "../../../src/services/outcome-analytics";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  const query=getQuery(event);
  const missionId=typeof query.missionId==="string"?query.missionId.trim():"";
  const candidateId=typeof query.candidateId==="string"&&query.candidateId.trim()?query.candidateId.trim():undefined;
  if(!missionId)throw createError({statusCode:400,statusMessage:"missionId is required"});
  return analyzeMissionOutcome({missionId,candidateId});
});
