import {defineEventHandler} from "nitro/h3";
import {getEvidenceLedgerHealth} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return getEvidenceLedgerHealth();
});
