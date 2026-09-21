import {defineEventHandler,readBody} from "nitro/h3";
import {EvidenceLedgerAppendRequestSchema} from "@evolution/contracts";
import {appendEvidenceLedger} from "../../../src/services/evidence-ledger";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=requireEvolutionPermission(event,"evidence.write");
  const input=EvidenceLedgerAppendRequestSchema.parse(await readBody(event));
  return appendEvidenceLedger({...input,actor:actor.id});
});
