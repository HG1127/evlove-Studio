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
describe("independent Judge final JSON correction",()=>{
 for(const protocol of ["responses","chat-completions"] as const){
  it(protocol+" corrects completed malformed Judge JSON once with the identical evidence",async()=>{
   const payload={mode:"server-baseline",artifactSha256:"a".repeat(64),runs:[{testCaseId:"V1",output:"Actual frozen-file observations"}]};
   const requests:Array<{user:string;system:string;signal:AbortSignal;format:unknown}>=[];
   const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const b=JSON.parse(String(init?.body));
    requests.push({user:protocol==="responses"?b.input[1].content[0].text:b.messages[1].content,system:protocol==="responses"?b.input[0].content[0].text:b.messages[0].content,signal:init!.signal as AbortSignal,format:protocol==="responses"?b.text.format:b.response_format});
    if(requests.length===1)return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:'{"criteria": malformed private rejection'}:{choices:[{finish_reason:"stop",message:{content:'{"criteria": malformed private rejection'}}]}),{status:200});
    return envelope(protocol,report);
   });vi.stubGlobal("fetch",fetch);
   expect(await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("evaluate",payload))).toEqual(report);
   expect(requests).toHaveLength(2);
   expect(requests[1].user).toBe(requests[0].user);
   expect(requests[1].format).toEqual(requests[0].format);
   expect(requests[1].signal).toBe(requests[0].signal);
   expect(requests[1].system).toContain("The preceding response was rejected by the task schema");
   expect(requests[1].system).not.toContain("malformed private rejection");
  });
 }
 it("rejects a second malformed Judge reply without a third call",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"{invalid final report"}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{}))).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each(["length","content_filter","tool_calls"])("never corrects the Judge's nonfinal %s response",async finish=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:JSON.stringify(report)}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("evaluate",{}))).rejects.toBeInstanceOf(Error);
  expect(fetch).toHaveBeenCalledOnce();
 });
});

describe("semantic observation completed JSON correction",()=>{
 for(const protocol of ["responses","chat-completions"] as const){
  it(protocol+" corrects long-text JSON once with identical captured evidence and deadline",async()=>{
   const payload={project:{sourceArtifacts:[{id:"synthetic",content:'Actual synthetic "quotes"\nline two'}]},testCases:[{id:"V1"}]};
   const output={results:[{testCaseId:"V1",output:'Observed "quotes"\nline two; no browser proof',trace:[]}]};
   const captured:Array<{user:string;system:string;signal:AbortSignal;format:unknown}>=[];
   const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const b=JSON.parse(String(init?.body));captured.push({user:protocol==="responses"?b.input[1].content[0].text:b.messages[1].content,system:protocol==="responses"?b.input[0].content[0].text:b.messages[0].content,signal:init!.signal as AbortSignal,format:protocol==="responses"?b.text.format:b.response_format});
    if(captured.length===1)return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:'{"results":[{"output":"private failed\ntext"}]}'}:{choices:[{finish_reason:"stop",message:{content:'{"results":[{"output":"private failed\ntext"}]}'}}]}),{status:200});
    return envelope(protocol,output);
   });vi.stubGlobal("fetch",fetch);
   expect(await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("execute-artifact-batch",payload))).toEqual(output);
   expect(captured).toHaveLength(2);expect(captured[1].user).toBe(captured[0].user);expect(captured[1].signal).toBe(captured[0].signal);expect(captured[1].format).toEqual(captured[0].format);
   expect(captured[1].system).toContain("unescaped-control");expect(captured[1].system).not.toContain("private failed");
  });
 }
 it("keeps second malformed semantic output unavailable without a third call",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"{invalid final output"}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
  const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("execute-artifact-batch",{})).catch(error=>error);
  expect(error).toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});expect(error.message).not.toContain("invalid final output");expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each(["length","content_filter","tool_calls"])("never corrects semantic nonfinal %s output",async finish=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:'{"results":[]}'}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("execute-artifact-batch",{}))).rejects.toBeInstanceOf(Error);expect(fetch).toHaveBeenCalledOnce();
 });
 it.each(["evaluate","execute-artifact-batch"] as const)("does not trust remote INVALID_JSON error code for %s",async operation=>{
  const fetch=vi.fn(async()=>{throw Object.assign(new Error("private "+settings.apiKey),{code:"AI_OUTPUT_INVALID_JSON"});});vi.stubGlobal("fetch",fetch);
  const error=await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi(operation,{})).catch(error=>error);
  expect(error).toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});expect(error).toBeInstanceOf(Error);expect((error as Error).message).not.toContain(settings.apiKey);expect(fetch).toHaveBeenCalledOnce();
 });

 it("does not request correction for duplicate semantic case identity",async()=>{
  const result={testCaseId:"V1",output:"Observed synthetic evidence",trace:[]},fetch=vi.fn(async()=>envelope("chat-completions",{results:[result,result]}));vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi("execute-artifact-batch",{}))).rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});expect(fetch).toHaveBeenCalledOnce();
 });
});

describe("positive completion and refusal correction boundary",()=>{
 for(const operation of ["evaluate","execute-artifact-batch"] as const){
  it.each(["aggregate-valid","aggregate-invalid","item-refusal","root-refusal"])("rejects Responses "+operation+" %s without correction",async kind=>{
   const valid=operation==="evaluate"?report:{results:[{testCaseId:"V1",output:"synthetic",trace:[]}]};
   const body={status:"completed",output_text:kind==="aggregate-invalid"?"{invalid":JSON.stringify(valid),
    ...(kind==="root-refusal"?{refusal:"private "+settings.apiKey}:kind==="item-refusal"?{output:[{type:"refusal"}]}:{output:[{content:[{type:"output_text",text:"mixed"},{type:"refusal",refusal:"private "+settings.apiKey}]}]})};
   const fetch=vi.fn(async()=>new Response(JSON.stringify(body),{status:200}));vi.stubGlobal("fetch",fetch);
   const error=await withExplicitServerAiConnection({...settings,protocol:"responses"},()=>runServerAi(operation,{})).catch(error=>error);
   expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain("拒绝");expect((error as Error).message).not.toContain(settings.apiKey);expect((error as Error).message).not.toContain("private");expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([undefined,null])("never corrects unknown Responses completion status for "+operation,async status=>{
   const fetch=vi.fn(async()=>new Response(JSON.stringify({status,output_text:"{invalid"}),{status:200}));vi.stubGlobal("fetch",fetch);
   await expect(withExplicitServerAiConnection({...settings,protocol:"responses"},()=>runServerAi(operation,{}))).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([undefined,null,"provider_eos"])("never corrects unknown Chat finish reason for "+operation,async finish_reason=>{
   const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:"{invalid"}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
   await expect(withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi(operation,{}))).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSON"});expect(fetch).toHaveBeenCalledOnce();
  });
  it("keeps complete valid compatible JSON usable without assuming correction permission for "+operation,async()=>{
   const valid=operation==="evaluate"?report:{results:[{testCaseId:"V1",output:"synthetic",trace:[]}]};
   const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
   expect(await withExplicitServerAiConnection({...settings,protocol:"chat-completions"},()=>runServerAi(operation,{}))).toEqual(valid);expect(fetch).toHaveBeenCalledOnce();
  });
 }
});
