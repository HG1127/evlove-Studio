import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EvolutionEventSchema} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError} from "../../../src/services/evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "../../../src/services/event-persistence";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  const value=EvolutionEventSchema.parse(await readBody(event));
  try{await getServerProductionRuntime().events.append(value);}
  catch(error){
    if(error instanceof EventIdempotencyConflictError||error instanceof EventEvidenceIdentityConflictError){
      throw createError({statusCode:409,statusMessage:"Event or Evidence ID already exists with different content"});
    }
    if(error instanceof EventEvidenceMirrorError){
      throw createError({statusCode:503,statusMessage:"Event persisted; Evidence mirror failed. Retry the same Event ID."});
    }
    throw error;
  }
  return {ok:true,eventId:value.id};
});
