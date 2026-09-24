import {defineEventHandler,getQuery,createError} from "nitro/h3";
import {ArtifactIdSchema} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {isTextArtifactMimeType} from "../../../src/services/artifact-lifecycle";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=ArtifactIdSchema.safeParse(getQuery(event).id);
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Artifact id"});
  const id=parsed.data;
  const blob=await getServerArtifactStore().get(id);
  if(!blob)throw createError({statusCode:404,statusMessage:"Artifact not found"});
  if(!isTextArtifactMimeType(blob.type)){
    throw createError({statusCode:415,statusMessage:"Use /api/evolution/artifacts/:id for binary Artifacts"});
  }
  return {id,size:blob.size,content:await blob.text()};
});
