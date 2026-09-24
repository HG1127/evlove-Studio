import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerArtifactStore} from "../../../../src/services/artifact-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"target.write");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Artifact id"});
  await getServerArtifactStore().delete(id);
  return {ok:true,artifactId:id};
});
