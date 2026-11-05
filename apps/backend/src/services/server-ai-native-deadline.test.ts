// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {nativeAiDeadlineOptions,type AiRequestDispatcher,type NativeAiFetchInit} from "@evolution/adapters/native-ai-deadline";
import * as nativeDeadline from "@evolution/adapters/native-ai-deadline";
import {runServerAi,serverAiUnavailableReason} from "./ai-gateway";
import * as connections from "./server-ai-connection";
import {withServerAiUsageScope} from "./server-ai-usage";
import type {AiUsageLedgerRecord} from "@evolution/contracts";

const sdk=vi.hoisted(()=>({generateText:vi.fn(),createGateway:vi.fn()}));
vi.mock("ai",()=>({generateText:sdk.generateText,gateway:(model:string)=>model,createGateway:sdk.createGateway,Output:{object:(schema:unknown)=>schema}}));
const connection={connectionId:"native-fixture",label:"Synthetic",apiKey:"synthetic-only",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
const payload={evidence:"SYNTHETIC ONLY"},result={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",notes:[],failures:[],cases:[],criteria:[]},reply={schemaVersion:"paired-evaluation-v1",requestFingerprint:"synthetic-only",versions:["A","B","C"].map(slot=>({slot,result}))};
const key=Symbol.for("undici.globalDispatcher.1");let had=false,prior:unknown;const parent={dispatch:vi.fn<AiRequestDispatcher["dispatch"]>(()=>true)};
beforeEach(async()=>{
 had=Object.hasOwn(globalThis,key);prior=Reflect.get(globalThis,key);Reflect.set(globalThis,key,parent);await nativeAiDeadlineOptions(600000);parent.dispatch.mockClear();
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","600000");vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","");vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","");vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","");
});
afterEach(()=>{if(had)Reflect.set(globalThis,key,prior);else Reflect.deleteProperty(globalThis,key);vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();sdk.generateText.mockReset();sdk.createGateway.mockReset();});

it.each(["chat-completions","responses"] as const)("applies native header/body timeouts to %s while leaving the model payload intact",async protocol=>{
 const fetch=vi.fn(async(_input:unknown,init?:NativeAiFetchInit)=>{
  expect(init!.signal).toBeInstanceOf(AbortSignal);expect(init!.dispatcher).toBeDefined();
  const body=JSON.parse(String(init!.body));expect(protocol==="responses"?JSON.parse(body.input.find((x:{role:string})=>x.role==="user").content[0].text):JSON.parse(body.messages.find((x:{role:string})=>x.role==="user").content)).toEqual(payload);
  init!.dispatcher!.dispatch({path:"/",method:"POST"},{});expect(parent.dispatch.mock.calls[0]![0]).toMatchObject({headersTimeout:600000,bodyTimeout:600000});
  return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:JSON.stringify(reply)}:{choices:[{finish_reason:"stop",message:{content:JSON.stringify(reply)}}]}));
 });vi.stubGlobal("fetch",fetch);
 expect(await connections.withExplicitServerAiConnection({...connection,protocol},()=>runServerAi("evaluate-paired",payload))).toEqual(reply);expect(fetch).toHaveBeenCalledTimes(1);expect(Reflect.get(globalThis,key)).toBe(parent);
});

it("wires the SDK to the original fetch and preserves an explicit custom dispatcher, body, headers and signal",async()=>{
 vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});
 let sdkFetch!:typeof globalThis.fetch;sdk.createGateway.mockImplementation((options:{fetch:typeof globalThis.fetch})=>{sdkFetch=options.fetch;return (model:string)=>model;});
 const custom={dispatch:vi.fn(()=>true)} as AiRequestDispatcher,controller=new AbortController(),input=new Request("https://synthetic.invalid/model"),headers={"x-fixture":"only"},init:NativeAiFetchInit={method:"POST",body:"fixture-body",headers,signal:controller.signal,dispatcher:custom};
 const fetch=vi.fn(async(received:unknown,options?:NativeAiFetchInit)=>{expect(received).toBe(input);expect(options!.body).toBe(init.body);expect(options!.headers).toBe(headers);expect(options!.signal).toBe(controller.signal);options!.dispatcher!.dispatch({path:"/model",method:"POST"},{});return new Response("fixture");});vi.stubGlobal("fetch",fetch);
 sdk.generateText.mockImplementation(async(options:{timeout:number;maxRetries:number})=>{expect(options.timeout).toBe(600000);expect(options.maxRetries).toBe(0);await sdkFetch(input,init);return {output:reply};});
 expect(await runServerAi("evaluate-paired",payload)).toEqual(reply);expect(sdk.createGateway).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);expect(custom.dispatch).toHaveBeenCalledWith(expect.objectContaining({headersTimeout:600000,bodyTimeout:600000}),expect.anything());expect(parent.dispatch).not.toHaveBeenCalled();expect(Reflect.get(globalThis,key)).toBe(parent);
});

it.each(["chat-completions","responses","sdk"] as const)("classifies missing native capability before %s provider I/O or usage starts",async protocol=>{
 Reflect.set(globalThis,key,undefined);const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const records:AiUsageLedgerRecord[]=[];
 if(protocol==="sdk")vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});
 const invoke=()=>runServerAi("evaluate-paired",payload),work=()=>protocol==="sdk"?invoke():connections.withExplicitServerAiConnection({...connection,protocol},invoke);
 const error=await withServerAiUsageScope({missionId:"synthetic",jobId:"fixture",phase:"fixture"},work,async row=>{records.push(row);}).catch(x=>x);
 expect(error).toMatchObject({code:"AI_NATIVE_DISPATCHER_UNAVAILABLE"});expect(serverAiUnavailableReason(error)).toBe("native-deadline-unavailable");expect(fetch).not.toHaveBeenCalled();expect(sdk.generateText).not.toHaveBeenCalled();expect(sdk.createGateway).not.toHaveBeenCalled();expect(records).toEqual([]);
});

it.each([10000,300000])("keeps the SDK's original gateway and native defaults for timeout %s",async timeout=>{
 Reflect.set(globalThis,key,undefined);vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS",String(timeout));vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});sdk.generateText.mockResolvedValue({output:reply});
 expect(await runServerAi("evaluate-paired",payload)).toEqual(reply);expect(sdk.createGateway).not.toHaveBeenCalled();expect(sdk.generateText.mock.calls[0]![0].model).toBe("synthetic/model");expect(Reflect.get(globalThis,key)).toBeUndefined();
});
it.each(["chat-completions","responses","sdk"] as const)("keeps normalized native dependency failure before %s usage or provider I/O",async protocol=>{
 vi.spyOn(nativeDeadline,"nativeAiDeadlineOptions").mockRejectedValue(Object.assign(new Error("synthetic capability failure",{cause:new Error("synthetic dependency failure")}),{code:"AI_NATIVE_DISPATCHER_UNAVAILABLE"}));
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const records:AiUsageLedgerRecord[]=[];
 if(protocol==="sdk")vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});
 const invoke=()=>runServerAi("evaluate-paired",payload),work=()=>protocol==="sdk"?invoke():connections.withExplicitServerAiConnection({...connection,protocol},invoke);
 await expect(withServerAiUsageScope({missionId:"synthetic",jobId:"fixture",phase:"fixture"},work,async row=>{records.push(row);})).rejects.toMatchObject({code:"AI_NATIVE_DISPATCHER_UNAVAILABLE"});
 expect(fetch).not.toHaveBeenCalled();expect(sdk.generateText).not.toHaveBeenCalled();expect(sdk.createGateway).not.toHaveBeenCalled();expect(records).toEqual([]);
});
it.each([null,false,0,""])("rejects explicitly malformed SDK dispatcher %s without default fallback",async invalid=>{
 vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:300000});let sdkFetch!:typeof globalThis.fetch;
 sdk.createGateway.mockImplementation((options:{fetch:typeof globalThis.fetch})=>{sdkFetch=options.fetch;return (model:string)=>model;});
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);sdk.generateText.mockImplementation(async()=>{const init={method:"POST",dispatcher:invalid} as unknown as NativeAiFetchInit;await sdkFetch("https://synthetic.invalid",init);return{output:reply};});
 await expect(runServerAi("evaluate-paired",payload)).rejects.toMatchObject({code:"AI_NATIVE_DISPATCHER_UNAVAILABLE"});expect(fetch).not.toHaveBeenCalled();expect(parent.dispatch).not.toHaveBeenCalled();
});
