import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerArtifactStore} from "../../../../src/services/artifact-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Artifact id"});
  const blob=await getServerArtifactStore().get(id);
  if(!blob)throw createError({statusCode:404,statusMessage:"Artifact not found"});
  return new Response(await blob.arrayBuffer(),{
    headers:{
      "Content-Type":blob.type||"application/octet-stream",
      "Content-Length":String(blob.size),
      "Cache-Control":"no-store",
    },
  });
});
