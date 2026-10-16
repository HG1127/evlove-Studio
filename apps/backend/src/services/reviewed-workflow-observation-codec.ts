import {z} from "zod";
import {importKey} from "@workflow/core/encryption";
import {hydrateDataWithKey,isEncryptedData} from "@workflow/core/serialization-format";
import {observabilityRevivers} from "workflow/observability";
import {ReviewedObservationError,reviewedObservationError,type ReviewedObservationCode} from "./reviewed-workflow-observation-error";
const Key=z.instanceof(Uint8Array).refine(value=>value.byteLength===32);
export const REVIEWED_OBSERVATION_BYTES=4*1024*1024;
export const REVIEWED_KEY_WAIT_MS=15_000;
/** SDK codec only; a derived Run key never becomes an API field, Event or persisted receipt. */
export async function decodeReviewedWorkflowIo(step:{input?:unknown;output?:unknown},resolveKey:()=>Promise<Uint8Array|undefined>){
 let timer:ReturnType<typeof setTimeout>|undefined,stage:ReviewedObservationCode="SDK_LIMIT";
 try{
  for(const value of [step.input,step.output])if(value instanceof Uint8Array&&value.byteLength>REVIEWED_OBSERVATION_BYTES)throw new Error("observation-limit");
  let key:Awaited<ReturnType<typeof importKey>>|undefined;
  if(isEncryptedData(step.input)||isEncryptedData(step.output)){
   stage="SDK_KEY_READ";
   const raw=await Promise.race([resolveKey(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ReviewedObservationError("SDK_KEY_DEADLINE")),REVIEWED_KEY_WAIT_MS);})]);
   stage="SDK_KEY_FORMAT";
   // Buffer.slice() shares SDK-owned storage; Uint8Array.from() always makes our own copy.
   const owned=Uint8Array.from(Key.parse(raw));
   stage="SDK_KEY_IMPORT";
   try{key=await importKey(owned,["decrypt"]);}finally{owned.fill(0);}
  }
  stage="SDK_DECRYPT";
  const [input,output]=await Promise.all([hydrateDataWithKey(step.input,observabilityRevivers,key),hydrateDataWithKey(step.output,observabilityRevivers,key)]);
  return{input,output};
 }catch(error){throw reviewedObservationError(error,stage);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
