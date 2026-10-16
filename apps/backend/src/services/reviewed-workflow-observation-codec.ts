import {z} from "zod";
import {importKey} from "@workflow/core/encryption";
import {hydrateDataWithKey,isEncryptedData} from "@workflow/core/serialization-format";
import {observabilityRevivers} from "workflow/observability";
const Key=z.instanceof(Uint8Array).refine(value=>value.byteLength===32);
export const REVIEWED_OBSERVATION_BYTES=4*1024*1024;
export const REVIEWED_KEY_WAIT_MS=15_000;
/** SDK codec only; a derived Run key never becomes an API field, Event or persisted receipt. */
export async function decodeReviewedWorkflowIo(step:{input?:unknown;output?:unknown},resolveKey:()=>Promise<Uint8Array|undefined>){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    for(const value of [step.input,step.output])if(value instanceof Uint8Array&&value.byteLength>REVIEWED_OBSERVATION_BYTES)throw new Error("observation-limit");
    let key:Awaited<ReturnType<typeof importKey>>|undefined;
    if(isEncryptedData(step.input)||isEncryptedData(step.output)){
      const raw=await Promise.race([resolveKey(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("key-deadline")),REVIEWED_KEY_WAIT_MS);})]);
      const owned=Key.parse(raw).slice();
      try{key=await importKey(owned,["decrypt"]);}finally{owned.fill(0);}
    }
    const [input,output]=await Promise.all([hydrateDataWithKey(step.input,observabilityRevivers,key),hydrateDataWithKey(step.output,observabilityRevivers,key)]);
    return{input,output};
  }catch{throw new Error("无法核验旧 Workflow 私有完成记录；未启动新的评审。");}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
