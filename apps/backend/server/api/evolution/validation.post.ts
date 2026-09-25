import {createError,defineEventHandler,readBody} from "nitro/h3";
import {ValidationRequestSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {registerArtifactEvidence} from "../../../src/services/evidence-runtime";
import {EventEvidenceIdentityConflictError} from "../../../src/services/evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "../../../src/services/event-persistence";
import {ValidationIdempotencyConflictError,validateArtifact} from "../../../src/services/validation-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=ValidationRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid validation request",data:parsed.error.flatten()});
  const body=parsed.data;
  const runtime=getServerProductionRuntime();
  let validation;
  try{
    validation=await validateArtifact(runtime,body);
  }catch(error){
    if(error instanceof ValidationIdempotencyConflictError)throw createError({statusCode:409,statusMessage:error.message});
    if(error instanceof EventEvidenceIdentityConflictError||error instanceof EventIdempotencyConflictError){
      throw createError({statusCode:409,statusMessage:"Validation Event or Evidence ID already exists with different content"});
    }
    if(error instanceof EventEvidenceMirrorError){
      throw createError({statusCode:503,statusMessage:body.idempotencyKey
        ?"Validation Event persisted; Evidence mirror failed. Retry with the same idempotency key."
        :"Validation Event persisted; Evidence mirror failed. Run Event Evidence reconciliation."});
    }
    throw error;
  }

  const evidence=await registerArtifactEvidence({
    missionId:body.missionId,
    artifactId:body.artifactId,
    jobId:validation.jobId,
    checkpointId:validation.checkpointId,
    kind:"validation",
    payload:{
      validationId:validation.id,
      status:validation.status,
      artifactSha256:validation.artifactSha256,
    },
  });
  return {
    validation,
    evidence,
  };
});
