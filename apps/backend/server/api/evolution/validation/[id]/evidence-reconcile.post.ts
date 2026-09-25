import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {ValidationResultSchema} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError} from "../../../../../src/services/evidence-ledger";
import {EventEvidenceMirrorError} from "../../../../../src/services/event-persistence";
import {reconcileValidationEvidence,ValidationEvidenceAppendError} from "../../../../../src/services/validation-runtime";
import {requireGovernedEvolutionPermission} from "../../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=ValidationResultSchema.shape.id.safeParse(getRouterParam(event,"id"));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Validation ID"});
  let result;
  try{result=await reconcileValidationEvidence(parsed.data);}
  catch(error){
    if(error instanceof EventEvidenceIdentityConflictError){
      throw createError({statusCode:409,statusMessage:"Validation Event Evidence conflicts with persisted identity"});
    }
    if(error instanceof EventEvidenceMirrorError){
      throw createError({statusCode:503,statusMessage:"Validation Event Evidence mirror failed; retry the same Validation ID"});
    }
    if(error instanceof ValidationEvidenceAppendError){
      throw createError({statusCode:503,statusMessage:"Validation Evidence append failed; retry the same Validation ID"});
    }
    throw error;
  }
  if(!result)throw createError({statusCode:404,statusMessage:"Validation result not found"});
  return result;
});
