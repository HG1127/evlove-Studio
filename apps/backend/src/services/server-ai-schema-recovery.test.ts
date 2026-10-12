// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {runServerAi,serverAiUnavailableReason} from "./ai-gateway";
import * as connectionConfig from "./server-ai-connection";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const settings={connectionId:"synthetic",label:"Synthetic only",baseUrl:"https://model.example.test/v1",apiKey:"fictional-key",model:"fixture-model",responseFormat:"json-object" as const,timeoutMs:1000};
const candidate={artifacts:[{sourceArtifactId:"synthetic-source",name:"synthetic.html",mimeType:"text/html",content:"<p>Quantity: 2</p>",buildMode:"ai-full",notes:[]}],summary:"Synthetic change"};
const report={accuracy:100,evidence:100,riskCoverage:100,completeness:100,safety:"PASS",notes:[],failures:[],cases:[{testCaseId:"V1",accuracy:100,evidence:100,completeness:100,reason:"observed"}],criteria:[{criterionId:"C1",score:100,pass:true,evidence:["measured"],gaps:[],testCaseIds:["V1"]}]};
const envelope=(protocol:string,value:unknown)=>new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:JSON.stringify(value)}:{choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]}),{status:200,headers:{"Content-Type":"application/json"}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("direct model bounded schema feedback",()=>{
 for(const protocol of ["responses","chat-completions"] as const){
  it.each(["json-schema","json-object"] as const)(protocol+" requests one strictly validated correction for %s",async responseFormat=>{
   const payload={syntheticOnly:true,currentTargets:[{id:"synthetic-source",content:"<p>Quantity: 1</p>"}]},requests:Array<{system:string;user:string;signal:AbortSignal;format:unknown}>=[];
   const timeout=vi.spyOn(AbortSignal,"timeout");
   vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));requests.push({system:protocol==="responses"?body.input[0].content[0].text:body.messages[0].content,user:protocol==="responses"?body.input[1].content[0].text:body.messages[1].content,signal:init!.signal as AbortSignal,format:protocol==="responses"?body.text?.format:body.response_format});
    return envelope(protocol,requests.length===1?{sourceArtifactId:"synthetic-source",content:"synthetic-invalid-response-only"}:candidate);
   }));
   const result=await withExplicitServerAiConnection({...settings,protocol,responseFormat},()=>runServerAi("build-candidate",payload));
   expect(result).toEqual(candidate);expect(requests).toHaveLength(2);expect(requests[0].user).toBe(JSON.stringify(payload));expect(requests[1].user).toBe(requests[0].user);expect(requests[1].signal).toBe(requests[0].signal);expect(timeout).toHaveBeenCalledOnce();expect(requests[1].format).toEqual(requests[0].format);
   expect(requests[1].system).toContain("The preceding response was rejected by the task schema");expect(requests[1].system).toContain('"artifacts","summary"');expect(requests[1].system).not.toContain("synthetic-invalid-response-only");expect(requests[1].system).not.toContain(settings.apiKey);
  });
 }
 it("pins the fallback protocol and deadline for the correction",async()=>{
  const routes:string[]=[],signals:AbortSignal[]=[],fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{routes.push(String(url));signals.push(init!.signal as AbortSignal);if(routes.length===1)return new Response('{}',{status:404});return envelope("chat-completions",routes.length===2?{content:"not a complete Candidate"}:candidate);});vi.stubGlobal("fetch",fetch);
  const resolve=vi.spyOn(connectionConfig,"resolveServerAiConfig").mockResolvedValue({...settings,mode:"openai-compatible"});
  expect(await runServerAi("build-candidate",{syntheticOnly:true})).toEqual(candidate);expect(resolve).toHaveBeenCalledOnce();
  expect(routes.map(route=>route.split('/').at(-1))).toEqual(["responses","completions","completions"]);expect(signals.every(signal=>signal===signals[0])).toBe(true);
 });
 it("retains the captured caller payload without echoing rejected output",async()=>{
  const payload={content:"original synthetic input"},captured:string[]=[],fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));captured.push(body.messages[1].content);if(captured.length===1){payload.content="changed outside operation";return envelope("chat-completions",{content:"private rejected model text"});}expect(body.messages[0].content).not.toContain("private rejected model text");return envelope("chat-completions",candidate);});vi.stubGlobal("fetch",fetch);
  await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("build-candidate",payload));expect(captured).toEqual(['{"content":"original synthetic input"}','{"content":"original synthetic input"}']);
 });
 it("rejects the second invalid shape without accepting or making a third request",async()=>{
  const fetch=vi.fn(async()=>envelope("chat-completions",{content:"private rejected output"}));vi.stubGlobal("fetch",fetch);
  const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("build-candidate",{})).catch(error=>error);expect(error).toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});expect(error.message).not.toContain("private rejected output");expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each(["duplicate-identity","all-zero"])("does not regenerate a semantic %s rejection",async kind=>{
  const output=kind==="duplicate-identity"?{...report,cases:[report.cases[0],report.cases[0]]}:{...report,accuracy:0,evidence:0,riskCoverage:0,completeness:0,cases:[],criteria:[]};
  const fetch=vi.fn(async()=>envelope("chat-completions",output));vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{}))).rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});expect(fetch).toHaveBeenCalledOnce();
 });
 it.each([401,429,503])("does not retry HTTP %s",async status=>{
  const fetch=vi.fn(async()=>new Response('{}',{status}));vi.stubGlobal("fetch",fetch);await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("build-candidate",{}))).rejects.toMatchObject({httpStatus:status});expect(fetch).toHaveBeenCalledOnce();
 });
 it.each([["{invalid","stop","AI_OUTPUT_INVALID_JSON"],["<think>unfinished","stop","AI_OUTPUT_INCOMPLETE"],[JSON.stringify(candidate),"length","AI_OUTPUT_INCOMPLETE"]])("does not retry nonfinal or invalid JSON",async(content,finish,code)=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:finish}]}),{status:200}));vi.stubGlobal("fetch",fetch);await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("build-candidate",{}))).rejects.toMatchObject({code});expect(fetch).toHaveBeenCalledOnce();
 });
 it("does not dispatch a correction after the original deadline expired",async()=>{
  const controller=new AbortController();vi.spyOn(AbortSignal,"timeout").mockReturnValue(controller.signal);
  const fetch=vi.fn(async()=>{controller.abort(new DOMException("synthetic timeout","TimeoutError"));return envelope("chat-completions",{content:"incomplete object"});});vi.stubGlobal("fetch",fetch);
  const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("build-candidate",{})).catch(error=>error);expect(serverAiUnavailableReason(error)).toBe("provider-timeout");expect(fetch).toHaveBeenCalledOnce();
 });
 it("does not treat a caller or provider error code as a validated shape rejection",async()=>{
  const fetch=vi.fn(async()=>{throw Object.assign(new Error("synthetic "+settings.apiKey),{code:"AI_OUTPUT_SCHEMA_MISMATCH"});});vi.stubGlobal("fetch",fetch);
  const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("build-candidate",{})).catch(error=>error);expect(error).toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});expect(error.message).not.toContain(settings.apiKey);expect(fetch).toHaveBeenCalledOnce();
 });
 it("retains a correction transport outage as unavailable",async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(envelope("chat-completions",{content:"incomplete object"})).mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"),{cause:{code:"ECONNRESET"}}));vi.stubGlobal("fetch",fetch);
  const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("build-candidate",{})).catch(error=>error);expect(serverAiUnavailableReason(error)).toBe("provider-network-error");expect(fetch).toHaveBeenCalledTimes(2);
 });
});