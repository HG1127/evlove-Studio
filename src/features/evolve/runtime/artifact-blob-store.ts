import { getProductionRuntime, productionRuntimeMode } from "./production-runtime";
import {
  deleteLocalArtifactBlob,
  getLocalArtifactBlob,
  putLocalArtifactBlob,
  putLocalArtifactBlobs,
} from "./local-artifact-blob-store";

const PENDING_UPLOADS_KEY="evolve-studio:artifact-sync:uploads:v1";
const PENDING_DELETES_KEY="evolve-studio:artifact-sync:deletes:v1";
const MAX_PENDING_IDS=2_000;
const volatilePending=new Map<string,Set<string>>();

type ArtifactSyncDetail={status:"pending"|"synced";pendingUploads:number;pendingDeletes:number;error?:string};

function readPending(key:string){
  const fallback=new Set(volatilePending.get(key)??[]);
  if(typeof window==="undefined")return fallback;
  try{
    const parsed=JSON.parse(window.localStorage.getItem(key)??"[]") as unknown;
    if(!Array.isArray(parsed))return fallback;
    const values=new Set(parsed.filter((value):value is string=>typeof value==="string"&&value.length>0).slice(-MAX_PENDING_IDS));
    volatilePending.set(key,new Set(values));
    return values;
  }catch{return fallback;}
}
function writePending(key:string,values:Set<string>){
  const bounded=new Set([...values].slice(-MAX_PENDING_IDS));
  volatilePending.set(key,bounded);
  if(typeof window==="undefined")return;
  try{window.localStorage.setItem(key,JSON.stringify([...bounded]));}catch{/* Volatile queue still protects this tab when browser storage is unavailable. */}
}
function updatePending(key:string,ids:string[],pending:boolean){
  const values=readPending(key);
  for(const id of ids){if(pending)values.add(id);else values.delete(id);}
  writePending(key,values);
}
function artifactError(error:unknown){return error instanceof Error?error.message:String(error);}
function emitArtifactSync(status:"pending"|"synced",error?:unknown){
  if(typeof window==="undefined")return;
  const detail:ArtifactSyncDetail={
    status,
    pendingUploads:readPending(PENDING_UPLOADS_KEY).size,
    pendingDeletes:readPending(PENDING_DELETES_KEY).size,
    ...(error===undefined?{}:{error:artifactError(error).slice(0,300)}),
  };
  window.dispatchEvent(new CustomEvent("evolve-artifact-sync-status",{detail}));
}
function clearOppositeOperation(ids:string[],operation:"upload"|"delete"){
  updatePending(operation==="upload"?PENDING_DELETES_KEY:PENDING_UPLOADS_KEY,ids,false);
}

export function artifactSyncStatus(){
  return {pendingUploads:readPending(PENDING_UPLOADS_KEY).size,pendingDeletes:readPending(PENDING_DELETES_KEY).size};
}

export async function putArtifactBlob(id:string,blob:Blob){
  return putArtifactBlobs([{id,blob}]);
}

export async function putArtifactBlobs(entries:Array<{id:string;blob:Blob}>){
  if(!entries.length)return;
  const ids=entries.map((item)=>item.id);
  // Local bytes are the degraded-mode safety net. Never lose them because the Production API is unavailable.
  await putLocalArtifactBlobs(entries);
  clearOppositeOperation(ids,"upload");
  if(productionRuntimeMode()==="local")return;
  const remote=getProductionRuntime().artifacts;
  try{
    await Promise.all(entries.map(({id,blob})=>remote.put(id,blob)));
    updatePending(PENDING_UPLOADS_KEY,ids,false);
    emitArtifactSync("synced");
  }catch(error){
    updatePending(PENDING_UPLOADS_KEY,ids,true);
    emitArtifactSync("pending",error);
    console.error("Production artifact upload deferred; local bytes retained",error);
  }
}

export async function getArtifactBlob(id:string,options?:{preferRemote?:boolean}):Promise<Blob|undefined>{
  if(readPending(PENDING_DELETES_KEY).has(id))return undefined;
  const mode=productionRuntimeMode();
  if(options?.preferRemote&&mode!=="local"){
    try{
      const remote=await getProductionRuntime().artifacts.get(id);
      if(remote){await putLocalArtifactBlob(id,remote).catch(()=>undefined);return remote;}
    }catch(error){
      console.error("Production artifact read unavailable; using local cache",error);
    }
  }
  const local=await getLocalArtifactBlob(id);
  if(local)return local;
  if(mode==="local")return undefined;
  const remote=await getProductionRuntime().artifacts.get(id);
  if(remote)await putLocalArtifactBlob(id,remote).catch(()=>undefined);
  return remote;
}

export async function deleteArtifactBlob(id:string){
  await deleteLocalArtifactBlob(id);
  clearOppositeOperation([id],"delete");
  if(productionRuntimeMode()==="local")return;
  try{
    await getProductionRuntime().artifacts.delete(id);
    updatePending(PENDING_DELETES_KEY,[id],false);
    emitArtifactSync("synced");
  }catch(error){
    updatePending(PENDING_DELETES_KEY,[id],true);
    emitArtifactSync("pending",error);
    console.error("Production artifact delete deferred; local tombstone retained",error);
  }
}

export async function flushPendingArtifactSync(){
  if(productionRuntimeMode()==="local")return artifactSyncStatus();
  const remote=getProductionRuntime().artifacts;
  const pendingDeletes=readPending(PENDING_DELETES_KEY);
  for(const id of [...pendingDeletes]){
    await remote.delete(id);
    pendingDeletes.delete(id);
    writePending(PENDING_DELETES_KEY,pendingDeletes);
  }
  const pendingUploads=readPending(PENDING_UPLOADS_KEY);
  for(const id of [...pendingUploads]){
    const blob=await getLocalArtifactBlob(id);
    if(!blob){
      pendingUploads.delete(id);
      writePending(PENDING_UPLOADS_KEY,pendingUploads);
      continue;
    }
    await remote.put(id,blob);
    pendingUploads.delete(id);
    writePending(PENDING_UPLOADS_KEY,pendingUploads);
  }
  emitArtifactSync("synced");
  return artifactSyncStatus();
}
