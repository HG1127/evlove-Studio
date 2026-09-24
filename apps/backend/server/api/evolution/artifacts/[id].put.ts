import {assertBodySize,createError,defineEventHandler,getHeader,getRouterParam,readRawBody} from "nitro/h3";
import {BinaryArtifactUploadMetadataSchema,MAX_BINARY_ARTIFACT_BYTES} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../../src/services/artifact-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"target.write");
  const parsed=BinaryArtifactUploadMetadataSchema.safeParse({
    id:getRouterParam(event,"id"),
    mimeType:getHeader(event,"content-type")?.split(";")[0]?.trim()||"application/octet-stream",
  });
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Artifact upload metadata",data:parsed.error.flatten()});
  const declaredLength=getHeader(event,"content-length");
  if(declaredLength!==undefined){
    const length=Number(declaredLength);
    if(!Number.isSafeInteger(length)||length<0)throw createError({statusCode:400,statusMessage:"Invalid Content-Length"});
    if(length>MAX_BINARY_ARTIFACT_BYTES)throw createError({statusCode:413,statusMessage:"Artifact exceeds binary upload limit"});
  }
  assertBodySize(event,MAX_BINARY_ARTIFACT_BYTES);
  const raw=await readRawBody(event,false);
  if(raw===undefined)throw createError({statusCode:400,statusMessage:"缺少 Artifact body"});
  if(raw.byteLength>MAX_BINARY_ARTIFACT_BYTES)throw createError({statusCode:413,statusMessage:"Artifact exceeds binary upload limit"});
  const bytes=Uint8Array.from(raw);
  await getServerArtifactStore().put(parsed.data.id,new Blob([bytes.buffer],{type:parsed.data.mimeType}));
  return {ok:true,artifactId:parsed.data.id,size:raw.byteLength};
});
