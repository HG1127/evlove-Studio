import {defineEventHandler,readBody} from "nitro/h3";
import {EvidenceLedgerArchiveRequestSchema} from "@evolution/contracts";
import {archiveEvidenceLedgerExport} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"evidence.write");
  const {missionId}=EvidenceLedgerArchiveRequestSchema.parse(await readBody(event));
  return archiveEvidenceLedgerExport(missionId);
});
