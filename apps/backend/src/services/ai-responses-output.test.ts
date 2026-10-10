// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {createHash} from "node:crypto";
import {SERVER_SEMANTIC_CONTEXT_VERSION} from "@evolution/harness";
import {COMPATIBLE_RESPONSES_OUTPUT_VERSION,COMPATIBLE_CHAT_OUTPUT_VERSION} from "@evolution/adapters";
import {DIRECT_AI_SCHEMA_RECOVERY_VERSION,runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {probeServerAiRuntime,resetServerAiRuntimeProbeCache} from "./server-ai-health";
const settings={connectionId:"fixture",label:"Synthetic Responses",apiKey:"fictional-provider-key",baseUrl:"https://provider.example.test/v1",model:"x",protocol:"responses" as const,responseFormat:"json-object" as const};
const task={answer:"Synthetic reply",suggestedAction:"none",evidence:[]};
const understanding={intentRestatement:"Synthetic health",implicitRequirements:[],assumptions:[],clarifications:[],acceptanceFocus:[],confidence:0.9};
const reply=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
afterEach(()=>{vi.unstubAllGlobals();resetServerAiRuntimeProbeCache();});
describe("backend Responses external output boundary",()=>{
 it.each(["json-schema","json-object","prompt-json"] as const)("joins all text parts while keeping selected %s protocol/format",async responseFormat=>{
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
   expect(url).toBe(settings.baseUrl+"/responses");const body=JSON.parse(String(init?.body));
   expect(body.model).toBe("x");expect(body.store).toBe(false);expect(init?.redirect).toBe("error");
   expect(body.text?.format?.type).toBe(responseFormat==="prompt-json"?undefined:responseFormat==="json-object"?"json_object":"json_schema");
   return reply({status:"completed",output:[{type:"reasoning",summary:[]},{content:[{type:"output_text",text:'{"answer":'}]},{content:[{type:"output_text",text:'"Synthetic reply","suggestedAction":"none","evidence":[]}'}]}]});
  });vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection({...settings,responseFormat},()=>runServerAi("copilot",{}))).resolves.toEqual(task);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([{status:"completed",output_text:JSON.stringify(task),error:{message:"Synthetic provider error"}},{status:"completed",output_text:JSON.stringify(task),error:{}}])("rejects an error envelope even if 200 carries contract-valid JSON",async body=>{
  const fetch=vi.fn(async()=>reply(body));vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("rejects a malformed envelope hidden behind a valid aggregate field",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>reply({status:"completed",output_text:JSON.stringify(task),output:"invalid"})));
  await expect(withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))).rejects.toThrow();
 });
 it("keeps the existing rejection of non-completed provider status",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>reply({status:"incomplete",output_text:JSON.stringify(task)})));
  await expect(withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))).rejects.toThrow();
 });
 it("redacts a key echoed by a 200 error body",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>reply({status:"completed",output_text:JSON.stringify(task),error:{message:"Rejected "+settings.apiKey}})));
  const error=await withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{})).catch(value=>value);
  expect(error).toBeInstanceOf(Error);expect(error.message).not.toContain(settings.apiKey);expect(error.stack).not.toContain(settings.apiKey);
 });
 it("does not report runtime readiness from a failed envelope with valid task text",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>reply({status:"completed",output_text:JSON.stringify(understanding),error:{message:"Synthetic unavailable"}})));
  const health=await withExplicitServerAiConnection(settings,()=>probeServerAiRuntime(undefined,{force:true,isolated:true}));
  expect(health.ready).toBe(false);expect(health.status).not.toBe("ready");
 });
 it("invalidates old Responses scoring identities without including credentials",async()=>{
  const route=["openai-compatible",settings.baseUrl,settings.model,settings.protocol,settings.responseFormat];
  const old=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION})).digest("hex");
  const expected=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,responsesOutputVersion:COMPATIBLE_RESPONSES_OUTPUT_VERSION,directSchemaRecoveryVersion:DIRECT_AI_SCHEMA_RECOVERY_VERSION})).digest("hex");
  const fingerprint=await withExplicitServerAiConnection(settings,()=>serverAiScoringRouteFingerprint());
  const previous=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,responsesOutputVersion:COMPATIBLE_RESPONSES_OUTPUT_VERSION})).digest("hex");
  expect(fingerprint).toBe(expected);expect(fingerprint).not.toBe(old);expect(fingerprint).not.toBe(previous);
  expect(await withExplicitServerAiConnection({...settings,apiKey:"rotated-fixture-key"},()=>serverAiScoringRouteFingerprint())).toBe(fingerprint);
 });
 it("invalidates the prior explicit Chat scoring identity",async()=>{
  const chat={...settings,protocol:"chat-completions" as const};
  const route=["openai-compatible",chat.baseUrl,chat.model,chat.protocol,chat.responseFormat];
  const expected=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,chatOutputVersion:COMPATIBLE_CHAT_OUTPUT_VERSION,directSchemaRecoveryVersion:DIRECT_AI_SCHEMA_RECOVERY_VERSION})).digest("hex");
  const previous=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,chatOutputVersion:COMPATIBLE_CHAT_OUTPUT_VERSION})).digest("hex");
  expect(await withExplicitServerAiConnection(chat,()=>serverAiScoringRouteFingerprint())).toBe(expected);
  expect(await withExplicitServerAiConnection(chat,()=>serverAiScoringRouteFingerprint())).not.toBe(previous);
 });
});
