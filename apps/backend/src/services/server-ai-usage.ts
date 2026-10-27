import {AsyncLocalStorage} from "node:async_hooks";
import {createHash,randomUUID} from "node:crypto";
import {fetchAiProvider,observeAiProviderUsage} from "@evolution/adapters";
import {AiProviderUsageObservationSchema,AiUsageLedgerRecordSchema,AiUsageRequestStartedSchema,AiUsageScopeSchema,createEvolutionEvent,
  type AiOperation,type AiProviderUsageObservation,type AiUsageLedgerRecord,type AiUsageLedgerWriter,type AiUsageProtocol,type AiUsageRequestStarted,type AiUsageRoute,type AiUsageScope} from "@evolution/contracts";
import type {ServerAiConfig} from "../server-env";
import {assertServerControlExecutionActive,serverControlExecutionSignal} from "./server-control-execution";

const active=new AsyncLocalStorage<{scope:AiUsageScope;write:AiUsageLedgerWriter}>();

export async function persistServerAiUsageRecord(record:AiUsageLedgerRecord){
  const parsed=AiUsageLedgerRecordSchema.parse(record),request=parsed.kind==="request-start"?parsed.request:parsed.observation.request;
  const {getServerProductionRuntime}=await import("./production-runtime");
  const recordSha256=createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  await getServerProductionRuntime().events.append(createEvolutionEvent({
    id:`evt-ai-usage-${request.callId}-${parsed.kind}`,missionId:request.scope.missionId,jobId:request.scope.jobId,
    type:"JobProgress",source:"server-ai-usage",at:parsed.kind==="request-start"?request.startedAt:parsed.observation.completedAt,
    payload:{measurementKind:"ai-usage-ledger-v1",recordSha256,record:parsed},
  }));
}

/** Scope comes from trusted execution composition, never a model response or free-form payload. */
export function withServerAiUsageScope<T>(scope:AiUsageScope,work:()=>Promise<T>,writer?:AiUsageLedgerWriter):Promise<T>{
  const parent=active.getStore();
  return active.run({scope:AiUsageScopeSchema.parse({...parent?.scope,...scope}),write:writer??parent?.write??persistServerAiUsageRecord},work);
}

function route(config:ServerAiConfig,protocol:AiUsageProtocol,operation:AiOperation):AiUsageRoute{
  return {operation,protocol,model:config.model,routeFingerprint:createHash("sha256").update(JSON.stringify([
    config.mode,config.mode==="openai-compatible"?config.baseUrl:undefined,config.model,protocol,
  ])).digest("hex")};
}

async function start(details:AiUsageRoute,attempt:number,granularity:AiUsageRequestStarted["granularity"]){
  const context=active.getStore();if(!context)return undefined;
  const request=AiUsageRequestStartedSchema.parse({schemaVersion:"ai-usage-request-v1",callId:randomUUID(),scope:context.scope,
    route:details,attempt,granularity,startedAt:new Date().toISOString()});
  try{await context.write({kind:"request-start",request});}
  catch{throw Object.assign(new Error("AI 请求用量起始记录未持久化；尚未发送该请求。"),{code:"AI_USAGE_START_NOT_RECORDED"});}
  return {request,write:context.write,clock:performance.now()};
}
type ActiveCall=Awaited<ReturnType<typeof start>>;

async function finish(call:ActiveCall,raw:unknown,outcome:AiProviderUsageObservation["outcome"],extra?:{httpStatus?:number;transportReason?:AiProviderUsageObservation["transportReason"]}){
  if(!call)return;
  const observation=AiProviderUsageObservationSchema.parse({schemaVersion:"ai-provider-usage-v1",request:call.request,
    completedAt:new Date().toISOString(),elapsedMs:Math.max(0,performance.now()-call.clock),outcome,...extra,
    ...observeAiProviderUsage(raw,call.request.route.protocol),billing:{status:"unavailable"}});
  try{await call.write({kind:"request-result",observation});}
  catch{
    // The durable start remains unmatched. Do not cause a completed model request
    // to repeat merely because its telemetry write failed.
    console.warn("AI_USAGE_RESULT_NOT_RECORDED",call.request.callId);
  }
}

/** Each physical connection retry gets its own durable start/result pair. */
export async function fetchServerAiProviderUsage(config:ServerAiConfig,protocol:Exclude<AiUsageProtocol,"ai-sdk">,operation:AiOperation,url:string,init:RequestInit){
  let call:ActiveCall;
  const response=await fetchAiProvider(url,{...init,signal:serverControlExecutionSignal(init.signal)},{
    beforeAttempt:async attempt=>{
      await assertServerControlExecutionActive();
      call=await start(route(config,protocol,operation),attempt,"physical-http-attempt");
      await assertServerControlExecutionActive();
    },
    failedAttempt:async(_attempt,reason)=>finish(call,undefined,"transport-error",{transportReason:reason??"unknown"}),
  });
  let recorded=false;
  return {response,observe:async(raw:unknown)=>{
    if(recorded)return;recorded=true;
    await finish(call,raw,"response",{httpStatus:response.status});
    await assertServerControlExecutionActive();
  }};
}

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** SDK retries remain opaque; a generation receipt never claims physical-attempt coverage. */
export async function measureServerAiSdkUsage<T>(config:ServerAiConfig,operation:AiOperation,invoke:()=>Promise<T>):Promise<T>{
  await assertServerControlExecutionActive();
  const call=await start(route(config,"ai-sdk",operation),1,"sdk-generation");
  let recorded=false;
  try{
    await assertServerControlExecutionActive();
    const result=await invoke(),generated=object(result),response=object(generated.response);
    await finish(call,{usage:generated.totalUsage??generated.usage,id:response.id,model:response.modelId},"response");
    recorded=true;
    await assertServerControlExecutionActive();
    return result;
  }catch(error){
    if(!recorded)await finish(call,{usage:object(error).usage},"sdk-error");throw error;
  }
}
