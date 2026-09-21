import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {verifyEvidenceLedger} from "../../../src/services/evidence-ledger";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  const missionId=typeof getQuery(event).missionId==="string"?String(getQuery(event).missionId).trim():"";
  if(!missionId)throw createError({statusCode:400,statusMessage:"missionId is required"});
  return verifyEvidenceLedger(missionId);
});
