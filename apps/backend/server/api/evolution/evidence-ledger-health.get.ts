import {defineEventHandler} from "nitro/h3";
import {getEvidenceLedgerHealth} from "../../../src/services/evidence-ledger";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler((event)=>{
  requireEvolutionPermission(event,"data.read");
  return getEvidenceLedgerHealth();
});
