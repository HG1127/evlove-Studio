import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {verifyEvidenceLedger} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const missionId=typeof getQuery(event).missionId==="string"?String(getQuery(event).missionId).trim():"";
  if(!missionId)throw createError({statusCode:400,statusMessage:"missionId is required"});
  return verifyEvidenceLedger(missionId);
});
