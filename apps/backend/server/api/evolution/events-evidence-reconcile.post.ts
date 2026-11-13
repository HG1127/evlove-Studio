import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EventEvidenceReconcileRequestSchema} from "@evolution/contracts";
import {reconcileEventEvidence} from "../../../src/services/event-evidence-reconciliation";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=EventEvidenceReconcileRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  if(parsed.data.repair&&process.env.EVOLUTION_EXPERIMENT_MODE==="isolated"){
    // Lab evidence repair is a signed write; require admin beyond execution permission.
    // Do NOT require a currently existing Mission: MissionDeleted evidence is
    // precisely the case that must be recoverable from an append-only Event.
    await requireGovernedEvolutionPermission(event,"security.admin");
  }
  try{return await reconcileEventEvidence(parsed.data);}
  catch{throw createError({statusCode:503,statusMessage:"Event Evidence reconciliation unavailable"});}
});
