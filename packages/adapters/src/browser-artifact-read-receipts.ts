import {z} from "zod";
const ReceiptSchema=z.object({source:z.string().min(1),artifactId:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().nonnegative(),mediaType:z.string()});
type Receipt=z.infer<typeof ReceiptSchema>;
const DB="evolve-studio-artifact-read-receipts",STORE="receipts",memory=new Map<string,Receipt>();
async function receiptFor(id:string,blob:Blob,source:string):Promise<Receipt>{
 const digest=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
 return ReceiptSchema.parse({source,artifactId:id,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join(""),size:blob.size,mediaType:blob.type});
}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error("Artifact receipt cache unavailable"));
});}
/** An authenticated complete remote read proves these exact cached bytes already exist remotely.
 * Keep receipts separate from the legacy Blob database so older tabs can still read raw Blobs. */
export async function rememberRemoteArtifactRead(id:string,blob:Blob,source:string){
 const receipt=await receiptFor(id,blob,source),key=JSON.stringify([source,id]);memory.delete(key);memory.set(key,receipt);if(memory.size>2000)memory.delete(memory.keys().next().value!);
 if(source.startsWith("session:")||typeof indexedDB==="undefined")return;
 const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(receipt,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
/** A local edit, including a MIME change under the same ID, invalidates the receipt. */
export async function matchesRemoteArtifactRead(id:string,blob:Blob,source:string){
 const key=JSON.stringify([source,id]);let stored:unknown=memory.get(key);
 if(!stored&&!source.startsWith("session:")&&typeof indexedDB!=="undefined"){
  try{const db=await open();try{stored=await new Promise<unknown>((resolve,reject)=>{const request=db.transaction(STORE,"readonly").objectStore(STORE).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}}catch{return false;}
 }
 const result=ReceiptSchema.safeParse(stored);if(!result.success||result.data.source!==source||result.data.artifactId!==id||result.data.size!==blob.size||result.data.mediaType!==blob.type)return false;
 return result.data.sha256===(await receiptFor(id,blob,source)).sha256;
}
