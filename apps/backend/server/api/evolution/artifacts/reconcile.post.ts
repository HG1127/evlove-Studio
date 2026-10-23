import {createError,defineEventHandler,readBody} from "nitro/h3";
import {ArtifactReconcileRequestSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";
import {ArtifactReconciliationError,reconcileArtifactRegistration} from "../../../../src/services/artifact-lifecycle";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";
import {assertServerArtifactEvidenceReady} from "../../../../src/services/artifact-evidence-readiness";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  const parsed=ArtifactReconcileRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  await assertServerArtifactEvidenceReady(parsed.data.missionId);
  try{return await reconcileArtifactRegistration(getServerProductionRuntime(),parsed.data);}
  catch(error){
    if(error instanceof ArtifactReconciliationError){
      const statusCode=error.reason==="mission-missing"||error.reason==="artifact-missing"?404:409;
      throw createError({statusCode,statusMessage:error.message});
    }
    throw error;
  }
});
