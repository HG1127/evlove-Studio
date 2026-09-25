import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EventEvidenceReconcileRequestSchema} from "@evolution/contracts";
import {reconcileEventEvidence} from "../../../src/services/event-evidence-reconciliation";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=EventEvidenceReconcileRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  try{return await reconcileEventEvidence(parsed.data);}
  catch{throw createError({statusCode:503,statusMessage:"Event Evidence reconciliation unavailable"});}
});
