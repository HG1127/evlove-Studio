import {createError,defineEventHandler,readBody} from "nitro/h3";
import {CheckpointValidateRequestSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";
import {getValidation} from "../../../../src/services/validation-runtime";
import {CheckpointArtifactDriftError,CheckpointBindingError,evaluateCheckpointValidation} from "../../../../src/services/validation-gate";
import {EventEvidenceIdentityConflictError} from "../../../../src/services/evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "../../../../src/services/event-persistence";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=CheckpointValidateRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid checkpoint validation request",data:parsed.error.flatten()});
  const input=parsed.data;
  const validation=await getValidation(input.validationId);
  if(!validation)throw createError({statusCode:404,statusMessage:"Validation result not found"});
  if(validation.missionId!==input.missionId||validation.checkpointId!==input.checkpointId||validation.artifactId!==input.artifactId){
    throw createError({statusCode:409,statusMessage:"Validation is bound to a different Mission, checkpoint, or Artifact"});
  }
  if(validation.status==="unverified")return {checkpointId:input.checkpointId,accepted:false,status:"unverified",validationId:validation.id};
  try{
    return await evaluateCheckpointValidation(getServerProductionRuntime(),{
      missionId:validation.missionId,checkpointId:input.checkpointId,artifactId:validation.artifactId,
      artifactSha256:validation.artifactSha256??"",validationId:validation.id,status:validation.status,
    });
  }catch(error){
    if(error instanceof CheckpointBindingError||error instanceof CheckpointArtifactDriftError){
      throw createError({statusCode:409,statusMessage:error.message});
    }
    if(error instanceof EventIdempotencyConflictError||error instanceof EventEvidenceIdentityConflictError){
      throw createError({statusCode:409,statusMessage:"Checkpoint Event or Evidence ID already exists with different content"});
    }
    if(error instanceof EventEvidenceMirrorError){
      throw createError({statusCode:503,statusMessage:"Checkpoint Event persisted; Evidence mirror failed. Retry the same validation ID."});
    }
    throw error;
  }
});
