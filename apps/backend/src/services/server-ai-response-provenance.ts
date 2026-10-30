import {AsyncLocalStorage} from "node:async_hooks";
import {createHash} from "node:crypto";
import {ServerAiResponseProvenanceSchema,type ServerAiResponseProvenance,type AiUsageRequestStarted,type AiUsageScope} from "@evolution/contracts";
type Context={observations:ServerAiResponseProvenance[];write?:(value:ServerAiResponseProvenance)=>Promise<void>};
const active=new AsyncLocalStorage<Context>(),sha=(text:string)=>createHash("sha256").update(text,"utf8").digest("hex");
const unavailable=()=>Object.assign(Error("Response provenance requires trusted physical request scope and complete body evidence"),{code:"AI_RESPONSE_PROVENANCE_NOT_RECORDED"});
function pairedFingerprint(body:string){
  try{
    const wire=JSON.parse(body),messages=wire.messages??wire.input;
    const user=Array.isArray(messages)?messages.findLast(m=>m.role==="user"):undefined;
    const text=typeof user?.content==="string"?user.content:Array.isArray(user?.content)?user.content.filter((p:{type:string;text?:string})=>["text","input_text"].includes(p.type)).map((p:{text?:string})=>p.text??"").join(""):undefined;
    const payload=typeof text==="string"?JSON.parse(text):undefined;
    return payload?.schemaVersion==="paired-judge-input-v1"&&typeof payload.requestFingerprint==="string"?payload.requestFingerprint:undefined;
  }catch{return undefined;}
}

/** Request-local opt-in. No raw body, prompt, headers or credential is exposed. */
export async function withServerAiResponseProvenance<T>(work:()=>Promise<T>,write?:Context["write"]){
  const context:Context={observations:[],write};
  const value=await active.run(context,work);
  if(!context.observations.length)throw unavailable();
  return {value,observations:context.observations.map(o=>structuredClone(o))};
}
export function assertServerAiResponseProvenanceReady(scope:AiUsageScope|undefined,body:unknown){
  if(active.getStore()&&(!scope?.missionId||!scope.jobId||typeof body!=="string"))throw unavailable();
}
export async function observeServerAiResponseProvenance(request:AiUsageRequestStarted|undefined,requestBody:unknown,responseBody:string,httpStatus:number){
  const context=active.getStore();if(!context)return;
  if(!request||typeof requestBody!=="string")throw unavailable();
  const observation=ServerAiResponseProvenanceSchema.parse({schemaVersion:"server-ai-response-provenance-v1",request,
    requestBodyTextSha256:sha(requestBody),responseBodyTextSha256:sha(responseBody),responseBodyUtf8Bytes:Buffer.byteLength(responseBody,"utf8"),
    httpStatus,receivedAt:new Date().toISOString(),hashScope:"fully-received-decoded-http-body-utf8",pairedRequestFingerprint:pairedFingerprint(requestBody)});
  try{await context.write?.(structuredClone(observation));}catch{throw unavailable();}
  context.observations.push(observation);
}
