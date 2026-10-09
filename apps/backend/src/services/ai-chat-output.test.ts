// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {runServerAi} from "./ai-gateway";
import {probeServerAiRuntime,resetServerAiRuntimeProbeCache} from "./server-ai-health";
const settings={connectionId:"fixture",label:"Synthetic Chat",apiKey:"fictional-chat-key",baseUrl:"https://provider.example.test/v1",model:"x",protocol:"chat-completions" as const,responseFormat:"json-object" as const};
const task={answer:"Synthetic reply",suggestedAction:"none",evidence:[]};
const content=JSON.stringify(task);
const choice={finish_reason:"stop",message:{content}};
const understanding={intentRestatement:"Synthetic health",implicitRequirements:[],assumptions:[],clarifications:[],acceptanceFocus:[],confidence:0.9};
afterEach(()=>{vi.unstubAllGlobals();resetServerAiRuntimeProbeCache();});
describe("backend Chat output boundary",()=>{
 it.each([{error:{message:"Synthetic unavailable"}},{error:{}},{message:"Synthetic unavailable"}])("rejects a successful HTTP envelope containing a provider error",async fields=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({...fields,choices:[choice]})));vi.stubGlobal("fetch",request);
  await expect(withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 });
 it.each(["length","content_filter","tool_calls","function_call"])("rejects contract-valid JSON with nonfinal finish_reason %s",async finish_reason=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({choices:[{...choice,finish_reason}]})));vi.stubGlobal("fetch",request);
  await expect(withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 });
 it.each([{refusal:"Synthetic refusal",content},{content:[{type:"text",text:content},{type:"refusal",refusal:"Synthetic refusal"}]}])("rejects a refusal alongside otherwise valid task text",async message=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{...choice,message}]}))));
  await expect(withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))).rejects.toThrow();
 });
 it("validates the entire consumed envelope before trusting content",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({usage:"malformed",choices:[choice]}))));
  await expect(withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))).rejects.toThrow();
 });
 it("does not report health ready from a 200 body error carrying valid understanding",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:{message:"Rejected "+settings.apiKey},choices:[{message:{content:JSON.stringify(understanding)}}]}))));
  const result=await withExplicitServerAiConnection(settings,()=>probeServerAiRuntime(undefined,{force:true,isolated:true}));
  expect(result.ready).toBe(false);expect(result.message).not.toContain(settings.apiKey);
 });
 it.each(["json-schema","json-object","prompt-json"] as const)("keeps explicit %s wire format and decodes complete multipart content",async responseFormat=>{
  vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
   expect(url).toBe(settings.baseUrl+"/chat/completions");expect(init?.redirect).toBe("error");const body=JSON.parse(String(init?.body));
   expect(body.model).toBe("x");expect(body.response_format?.type).toBe(responseFormat==="prompt-json"?undefined:responseFormat==="json-object"?"json_object":"json_schema");
   return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:[{type:"text",text:content.slice(0,14)},{type:"output_text",text:content.slice(14)}]}}]}));
  }));
  expect(await withExplicitServerAiConnection({...settings,responseFormat},()=>runServerAi("copilot",{}))).toEqual(task);
 });
});