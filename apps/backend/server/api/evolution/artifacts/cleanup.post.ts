import {ArtifactBlobCleanupRequestSchema} from "@evolution/contracts";
import {createError,defineEventHandler,readBody} from "nitro/h3";
import {cleanupArtifactBlobs} from "../../../../src/services/artifact-blob-cleanup";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"security.admin");
  const parsed=ArtifactBlobCleanupRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  return cleanupArtifactBlobs(parsed.data);
});
