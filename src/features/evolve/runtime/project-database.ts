import { EvolveProjectSchema, type EvolveProject } from "../schemas";
let database: IDBDatabase | undefined;
let cache: EvolveProject[] | undefined;
let pending = Promise.resolve();
let latest:EvolveProject[]|undefined;
let writing=false;
let unsaved=false;
export const PROJECT_SAVE_EVENT = "evolve-project-save-status";
export function databaseProjects() { return cache; }
export async function initializeProjectDatabase(legacy: EvolveProject[]) {
  if(typeof indexedDB === "undefined") return;
  const db = await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("evolve-studio-projects",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("state");
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  const stored = await new Promise<EvolveProject[] | undefined>((resolve,reject)=>{
    const request=db.transaction("state").objectStore("state").get("projects");
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  database=db;
  // IndexedDB may contain a project written by an older Studio version. Always run the
  // current schema here too (not only on localStorage migration) so newly-added defaulted
  // fields are materialized before React receives the object.
  cache=EvolveProjectSchema.array().parse(stored ?? legacy);
  // Persist the normalized shape before mounting. An existing empty array is authoritative.
  await writeDatabase(cache);
  window.addEventListener("beforeunload",event=>{if(unsaved){event.preventDefault();event.returnValue="";}});
}
function writeDatabase(projects:EvolveProject[]) {
  return new Promise<void>((resolve,reject)=>{
    const tx=database!.transaction("state","readwrite");tx.objectStore("state").put(projects,"projects");
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error ?? new Error("保存已中止"));
  });
}
export function saveDatabaseProjects(projects:EvolveProject[]) {
  cache=projects;
  // Snapshot now: later mutations must not change a queued write.
  latest=structuredClone(projects);unsaved=true;
  window.dispatchEvent(new CustomEvent(PROJECT_SAVE_EVENT,{detail:{state:"saving"}}));
  if(writing)return;
  writing=true;
  pending=(async()=>{try{while(latest){const snapshot=latest;latest=undefined;await writeDatabase(snapshot);}unsaved=false;window.dispatchEvent(new CustomEvent(PROJECT_SAVE_EVENT,{detail:{state:"saved"}}));}finally{writing=false;}})();
  void pending.catch(error=>window.dispatchEvent(new CustomEvent(PROJECT_SAVE_EVENT,{detail:{state:"error",message:String(error)}})));
}
export function flushProjectDatabase(){return pending;}
