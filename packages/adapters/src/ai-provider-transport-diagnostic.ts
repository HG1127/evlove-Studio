import {AiProviderTransportDiagnosticSchema,type AiProviderTransportDiagnostic} from "@evolution/contracts";

type DiagnosticContext={
  phase:AiProviderTransportDiagnostic["phase"];
  configuredTimeoutMs?:number;
  requestSignal?:AbortSignal|null;
  executionSignal?:AbortSignal|null;
  failureReason?:"provider-network-error"|"provider-timeout";
};
const codes=new Set<string>(["ETIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT",
  "ECONNRESET","ECONNREFUSED","ENOTFOUND","EAI_AGAIN","EHOSTUNREACH","ENETUNREACH","UND_ERR_SOCKET",
  "SERVER_AI_PROVIDER_TIMEOUT","SERVER_AI_PROVIDER_NETWORK_ERROR","SERVER_CONTROL_EXECUTION_STOPPED"]);
const networkCodes=new Set(["ECONNRESET","ECONNREFUSED","ENOTFOUND","EAI_AGAIN","EHOSTUNREACH","ENETUNREACH","UND_ERR_SOCKET","SERVER_AI_PROVIDER_NETWORK_ERROR"]);
const object=(v:unknown):v is object=>Boolean(v&&(typeof v==="object"||typeof v==="function"));
const get=(v:object,key:string):unknown=>{try{return Reflect.get(v,key);}catch{return undefined;}};
const signalReason=(signal?:AbortSignal|null):unknown=>{try{return signal?.aborted?signal.reason:undefined;}catch{return undefined;}};

/** Diagnostic only. Does not authorize a retry, infer transmission/cost, or copy error text. */
export function aiProviderTransportDiagnostic(error:unknown,context:DiagnosticContext):AiProviderTransportDiagnostic{
  const chain:object[]=[],seen=new Set<object>();let current=error;
  while(chain.length<6&&object(current)&&!seen.has(current)){seen.add(current);chain.push(current);current=get(current,"cause");}
  const observed=[...new Set(chain.map(item=>get(item,"code")).filter((value):value is string=>typeof value==="string"&&codes.has(value)))];
  const ownReason=signalReason(context.requestSignal),executionReason=signalReason(context.executionSignal);
  const requestMatched=object(ownReason)&&chain.includes(ownReason);
  const executionMatched=executionReason!==ownReason&&object(executionReason)&&chain.includes(executionReason);
  const matchedSignal=requestMatched&&executionMatched?"both" as const:requestMatched?"request" as const:executionMatched?"execution" as const:undefined;
  const origins=new Set<AiProviderTransportDiagnostic["origin"]>();
  if(requestMatched)origins.add("request-signal");
  if(executionMatched)origins.add("execution-signal");
  if(observed.includes("UND_ERR_CONNECT_TIMEOUT"))origins.add("native-connect");
  if(observed.includes("UND_ERR_HEADERS_TIMEOUT"))origins.add("native-headers");
  if(observed.includes("UND_ERR_BODY_TIMEOUT"))origins.add("native-body");
  let origin:AiProviderTransportDiagnostic["origin"]="unknown";
  if(origins.size===1)origin=[...origins][0]!;
  else if(origins.size===0){
    if(observed.includes("ETIMEDOUT")||observed.includes("SERVER_AI_PROVIDER_TIMEOUT")||context.failureReason==="provider-timeout"
      ||chain.some(item=>get(item,"name")==="TimeoutError"))origin="transport-timeout";
    else if(observed.some(code=>networkCodes.has(code))||context.failureReason==="provider-network-error")origin="network";
  }
  const duration=context.configuredTimeoutMs;
  return AiProviderTransportDiagnosticSchema.parse({schemaVersion:"ai-provider-transport-diagnostic-v1",phase:context.phase,origin,codes:observed,matchedSignal,
    ...(duration!==undefined&&Number.isInteger(duration)&&duration>0&&duration<=86_400_000?{configuredTimeoutMs:duration}:{})});
}
