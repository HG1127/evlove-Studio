import {defineEventHandler,readBody} from "nitro/h3";
import {EvidenceLedgerExportBundleSchema} from "@evolution/contracts";
import {verifyEvidenceLedgerExport} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const bundle=EvidenceLedgerExportBundleSchema.parse(await readBody(event));
  return verifyEvidenceLedgerExport(bundle);
});
