import { getProductionRuntime, productionRuntimeMode } from "./production-runtime";
import {
  deleteLocalArtifactBlob,
  getLocalArtifactBlob,
  putLocalArtifactBlob,
  putLocalArtifactBlobs,
} from "./local-artifact-blob-store";

export async function putArtifactBlob(id:string,blob:Blob){
  return putArtifactBlobs([{id,blob}]);
}

export async function putArtifactBlobs(entries:Array<{id:string;blob:Blob}>){
  if(productionRuntimeMode()==="local"){
    await putLocalArtifactBlobs(entries);
    return;
  }
  const remote=getProductionRuntime().artifacts;
  await Promise.all(entries.map(({id,blob})=>remote.put(id,blob)));
  await putLocalArtifactBlobs(entries);
}

export async function getArtifactBlob(id:string):Promise<Blob|undefined>{
  const local=await getLocalArtifactBlob(id);
  if(local)return local;
  if(productionRuntimeMode()==="local")return undefined;
  const remote=await getProductionRuntime().artifacts.get(id);
  if(remote)await putLocalArtifactBlob(id,remote).catch(()=>undefined);
  return remote;
}

export async function deleteArtifactBlob(id:string){
  if(productionRuntimeMode()!=="local")await getProductionRuntime().artifacts.delete(id);
  await deleteLocalArtifactBlob(id);
}
