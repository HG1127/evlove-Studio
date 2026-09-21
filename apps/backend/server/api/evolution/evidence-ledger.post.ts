import {defineEventHandler,readBody} from "nitro/h3";
import {EvidenceLedgerAppendRequestSchema} from "@evolution/contracts";
import {appendEvidenceLedger} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"evidence.write");
  const input=EvidenceLedgerAppendRequestSchema.parse(await readBody(event));
  return appendEvidenceLedger({...input,actor:actor.id});
});
