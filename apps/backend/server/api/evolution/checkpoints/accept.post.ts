import {createError,defineEventHandler,readBody} from "nitro/h3";
import {CheckpointAcceptRequestSchema} from "@evolution/contracts";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";
import {canAcceptCheckpoint,getValidation} from "../../../../src/services/validation-runtime";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";
import {CheckpointBindingError,evaluateCheckpointValidation} from "../../../../src/services/validation-gate";
import {EventEvidenceIdentityConflictError} from "../../../../src/services/evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "../../../../src/services/event-persistence";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=CheckpointAcceptRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid checkpoint acceptance request",data:parsed.error.flatten()});
  const validation=await getValidation(parsed.data.validationId);
  if(!validation||!canAcceptCheckpoint(validation)){
    throw createError({statusCode:409,statusMessage:"validation not passed"});
  }
  if(!validation.checkpointId)throw createError({statusCode:409,statusMessage:"validation is not bound to a checkpoint"});
  try{
    return await evaluateCheckpointValidation(getServerProductionRuntime(),{
      missionId:validation.missionId,checkpointId:validation.checkpointId,artifactId:validation.artifactId,
      artifactSha256:validation.artifactSha256!,validationId:validation.id,status:"passed",
    });
  }catch(error){
    if(error instanceof CheckpointBindingError)throw createError({statusCode:409,statusMessage:error.message});
    if(error instanceof EventIdempotencyConflictError||error instanceof EventEvidenceIdentityConflictError){
      throw createError({statusCode:409,statusMessage:"Checkpoint Event or Evidence ID already exists with different content"});
    }
    if(error instanceof EventEvidenceMirrorError){
      throw createError({statusCode:503,statusMessage:"Checkpoint Event persisted; Evidence mirror failed. Retry the same validation ID."});
    }
    throw error;
  }
});
