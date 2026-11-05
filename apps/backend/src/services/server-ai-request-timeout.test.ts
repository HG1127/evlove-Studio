// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import * as connections from "./server-ai-connection";
import {serverAiRequestTimeoutMs} from "./server-ai-request-timeout";
import {serverAiTimeoutMs} from "../server-env";
import {abortServerControlExecutions,withServerControlExecution} from "./server-control-execution";
import {withServerAiOutputPolicy} from "./server-ai-output-policy";
import {nativeAiDeadlineOptions} from "@evolution/adapters/native-ai-deadline";

const sdk=vi.hoisted(()=>({generateText:vi.fn(),createGateway:vi.fn()}));
vi.mock("ai",()=>({generateText:sdk.generateText,gateway:(model:string)=>model,createGateway:sdk.createGateway,Output:{object:(schema:unknown)=>schema}}));
const nativeDispatcherKey=Symbol.for("undici.globalDispatcher.1");let priorDispatcher:unknown,hadDispatcher=false;
const connection={connectionId:"synthetic-timeout",label:"Synthetic",apiKey:"synthetic-only",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
const config={mode:"openai-compatible" as const,...connection,timeoutMs:300_000};
const payload={evidence:"SYNTHETIC ONLY"};
const result={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",notes:[],failures:[],cases:[],criteria:[]};
const reply={schemaVersion:"paired-evaluation-v1",requestFingerprint:"synthetic-only",versions:["A","B","C"].map(slot=>({slot,result}))};
beforeEach(async()=>{
 hadDispatcher=Object.hasOwn(globalThis,nativeDispatcherKey);priorDispatcher=Reflect.get(globalThis,nativeDispatcherKey);Reflect.set(globalThis,nativeDispatcherKey,{dispatch(){return true;}});
 sdk.createGateway.mockImplementation(()=>(model:string)=>model);
 await nativeAiDeadlineOptions(600000);
 vi.stubEnv("EVOLUTION_AI_TIMEOUT_MS","900000");vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","");
 vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","");vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","");vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","");
});
afterEach(()=>{if(hadDispatcher)Reflect.set(globalThis,nativeDispatcherKey,priorDispatcher);else Reflect.deleteProperty(globalThis,nativeDispatcherKey);vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();sdk.generateText.mockReset();sdk.createGateway.mockReset();});

function virtualTimeout(){
 vi.useFakeTimers();
 return vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{
  const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException("Timed out","TimeoutError")),ms);return controller.signal;
 });
}
function delayedResponse(protocol:"chat-completions"|"responses",delay=310_000){
 const fetch=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((resolve,reject)=>{
  const signal=init!.signal!;
  const timer=setTimeout(()=>resolve(new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:JSON.stringify(reply)}:{choices:[{finish_reason:"stop",message:{content:JSON.stringify(reply)}}]}))),delay);
  const abort=()=>{clearTimeout(timer);reject(signal.reason);};
  if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
 }));vi.stubGlobal("fetch",fetch);return fetch;
}

it("keeps the legacy clamp/default and ignores paired settings for other operations",()=>{
 expect(serverAiTimeoutMs()).toBe(300000);expect(serverAiRequestTimeoutMs("evaluate-paired",config)).toBe(300000);
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");expect(serverAiRequestTimeoutMs("evaluate-paired",config)).toBe(600000);
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","invalid");expect(serverAiRequestTimeoutMs("evaluate",config)).toBe(300000);
 vi.stubEnv("EVOLUTION_AI_TIMEOUT_MS","");expect(serverAiTimeoutMs()).toBe(90000);
});

it.each(["chat-completions","responses"] as const)("allows a response after five minutes via %s without changing its scoring route or adding calls",async protocol=>{
 const timeout=virtualTimeout(),fetch=delayedResponse(protocol);vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");
 await connections.withExplicitServerAiConnection({...connection,protocol},async()=>{
  const extended=await serverAiScoringRouteFingerprint();vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","");expect(await serverAiScoringRouteFingerprint()).toBe(extended);vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");
  const running=withServerAiOutputPolicy({formatCorrection:"forbid"},()=>runServerAi("evaluate-paired",payload));
  await vi.advanceTimersByTimeAsync(310000);expect(await running).toEqual(reply);
 });expect(timeout).toHaveBeenCalledWith(600000);expect(fetch).toHaveBeenCalledTimes(1);
});

it("still stops once at the legacy timeout without retrying a sent request",async()=>{
 virtualTimeout();const fetch=delayedResponse("chat-completions");
 const running=connections.withExplicitServerAiConnection(connection,()=>runServerAi("evaluate-paired",payload));
 const rejected=expect(running).rejects.toMatchObject({code:"SERVER_AI_PROVIDER_TIMEOUT"});
 await vi.advanceTimersByTimeAsync(300000);await rejected;expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["chat-completions","responses"] as const)("does not replay an unknown reset through %s when the new paired mode is explicit",async protocol=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");const fetch=vi.fn().mockRejectedValue(new TypeError("fetch failed",{cause:{code:"ECONNRESET"}}));vi.stubGlobal("fetch",fetch);
 await expect(connections.withExplicitServerAiConnection({...connection,protocol},()=>runServerAi("evaluate-paired",payload))).rejects.toMatchObject({code:"SERVER_AI_PROVIDER_NETWORK_ERROR"});
 expect(fetch).toHaveBeenCalledTimes(1);
});

it("passes the explicit timeout and control abort signal to the SDK route",async()=>{
 vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");sdk.generateText.mockResolvedValue({output:reply});
 const at="2026-11-05T00:00:00.000Z",input={missionId:"synthetic",controlJobId:"control",requestedAt:at};
 const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:"synthetic",type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:control",generation:1,attempts:1,priority:1,createdAt:at,updatedAt:at});
 await withServerControlExecution(input,async()=>job,async()=>{
  expect(await runServerAi("evaluate-paired",payload)).toEqual(reply);
  const call=sdk.generateText.mock.calls[0]![0];expect(call.timeout).toBe(600000);expect(call.maxRetries).toBe(0);expect(call.abortSignal.aborted).toBe(false);
  abortServerControlExecutions(job);expect(call.abortSignal.aborted).toBe(true);
 });expect(sdk.generateText).toHaveBeenCalledTimes(1);
});

it("preserves the SDK legacy retry setting when unset and does not reinvoke an opted-in timeout",async()=>{
 vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});
 sdk.generateText.mockResolvedValue({output:reply});await runServerAi("evaluate-paired",payload);
 expect(sdk.generateText.mock.calls[0]![0]).not.toHaveProperty("maxRetries");sdk.generateText.mockReset();
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");sdk.generateText.mockRejectedValue(new DOMException("Timed out","TimeoutError"));
 await expect(runServerAi("evaluate-paired",payload)).rejects.toThrow();expect(sdk.generateText).toHaveBeenCalledTimes(1);
 expect(sdk.generateText.mock.calls[0]![0].maxRetries).toBe(0);
});

it.each(["chat-completions","responses"] as const)("cancels %s earlier than an extended provider timeout",async protocol=>{
 virtualTimeout();vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");const fetch=delayedResponse(protocol);
 const at="2026-11-05T00:00:00.000Z",input={missionId:"synthetic",controlJobId:"control",requestedAt:at};
 const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:"synthetic",type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:control",generation:1,attempts:1,priority:1,createdAt:at,updatedAt:at});
 const running=withServerControlExecution(input,async()=>job,()=>connections.withExplicitServerAiConnection({...connection,protocol},()=>runServerAi("evaluate-paired",payload)));
 const rejected=expect(running).rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
 await vi.advanceTimersByTimeAsync(15000);abortServerControlExecutions(job);await rejected;expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["0","9999","900001","600000.5","NaN","Infinity","no"])("rejects invalid timeout %s before direct and SDK I/O",async raw=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS",raw);const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 await expect(connections.withExplicitServerAiConnection(connection,()=>runServerAi("evaluate-paired",payload))).rejects.toMatchObject({code:"AI_REQUEST_TIMEOUT_INVALID"});
 vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});
 await expect(runServerAi("evaluate-paired",payload)).rejects.toMatchObject({code:"AI_REQUEST_TIMEOUT_INVALID"});
 expect(fetch).not.toHaveBeenCalled();expect(sdk.generateText).not.toHaveBeenCalled();
});
