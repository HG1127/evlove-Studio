import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {MissionReadQuerySchema} from "@evolution/contracts";
import {verifyEvidenceLedger} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=MissionReadQuerySchema.safeParse(getQuery(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid missionId"});
  return verifyEvidenceLedger(parsed.data.missionId);
});
