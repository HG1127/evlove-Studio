// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {StructuredAiJsonError} from "@evolution/adapters";
import {directAiCompletionDiagnosticSuffix,retainDirectAiCompletionDiagnostic,readDirectAiCompletionDiagnostic} from "./direct-ai-completion-diagnostics";
import {runServerAi,serverAiScoringRouteFingerprint,serverAiUnavailableReason} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const settings={connectionId:"synthetic",label:"Synthetic",baseUrl:"https://model.example.test/v1",apiKey:"fictional-key",model:"fixture-model",protocol:"chat-completions" as const,responseFormat:"json-object" as const};
const privateValue='private-source fictional\\u002dkey';
const report={accuracy:80,evidence:80,riskCoverage:80,completeness:80,safety:"FAIL",notes:[],failures:[],cases:[],criteria:[]};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const diagnostic=(envelope:unknown,protocol:"chat-completions"|"responses"="chat-completions")=>directAiCompletionDiagnosticSuffix({protocol,phase:"initial",envelope});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("bounded direct completion metadata",()=>{
  it("counts exact UTF8 first-choice text and never reasoning, later alternatives or nontext parts",()=>{
    const suffix=diagnostic({status:"completed",choices:[{finish_reason:"stop",message:{content:[{type:"text",text:"中"},{type:"output_text",text:"文"},{type:"image",text:privateValue}],reasoning_content:privateValue}},{finish_reason:"length",message:{content:privateValue}}],usage:{completion_tokens:123}});
    expect(suffix).toContain("finish=stop; contentBytes=6; outputTokens=123");expect(suffix).not.toContain(privateValue);
  });
  it("uses legacy first-choice text only when native text is empty",()=>{
    expect(diagnostic({choices:[{text:"中",message:{content:" "}}]})).toContain("contentBytes=3");
  });
  it("retains Responses aggregate precedence and only typed output parts",()=>{
    expect(diagnostic({status:"completed",output_text:"中",output:[{content:[{type:"output_text",text:"ignored"}]}],usage:{output_tokens:2}},"responses")).toContain("contentBytes=3; outputTokens=2");
    expect(diagnostic({status:"completed",output:[{type:"reasoning",content:[{type:"text",text:privateValue}]},{content:[{type:"output_text",text:"中文"}]}]},"responses")).toContain("contentBytes=6");
  });
  it.each([undefined,null,"provider_eos",privateValue])("reduces unknown finish/status %s to fixed categories",value=>{
    const suffix=diagnostic({status:value,choices:[{finish_reason:value,message:{content:"{invalid"}}],incomplete_details:{reason:privateValue},usage:{reason:privateValue}});
    expect(suffix).toContain("finish="+(value==null?"missing":"other"));expect(suffix).not.toContain("private");expect(suffix).not.toContain("fictional");expect(suffix).not.toContain("provider_eos");
  });
  it.each([NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1,1_000_000_001,privateValue])("never prints invalid token usage %s",tokens=>{
    expect(diagnostic({status:"completed",output_text:"{invalid",usage:{output_tokens:tokens}},"responses")).not.toContain("outputTokens=");
  });
  it.each([{choices:"invalid"},{choices:[{message:{content:123}}]},{choices:[],usage:{completion_tokens:privateValue}}])("does not mine invalid Chat envelopes for metadata",body=>{
    expect(diagnostic(body)).toBe(" [completionPhase=initial; protocol=chat-completions; envelope=invalid]");
  });
  it("preserves local JSON error identity and keeps remote metadata outside the private WeakMap",()=>{
    const error=new StructuredAiJsonError("unfinished-root");
    expect(retainDirectAiCompletionDiagnostic(error,{protocol:"chat-completions",phase:"correction",envelope:{choices:[{finish_reason:"stop",message:{content:"{"}}]}})).toBe(error);
    expect(error).toBeInstanceOf(StructuredAiJsonError);expect(readDirectAiCompletionDiagnostic(error)).toContain("completionPhase=correction");
    expect(readDirectAiCompletionDiagnostic({completionDiagnostic:privateValue})).toBe("");
  });
});
describe("initial and single correction completion failures",()=>{
  for(const protocol of ["chat-completions","responses"] as const){
    const body=(text:string)=>protocol==="responses"?{status:"completed",output_text:text,usage:{output_tokens:456}}:{choices:[{finish_reason:"stop",message:{content:text}}],usage:{completion_tokens:456}};
    it(protocol+" identifies a second malformed response without a third request or private excerpts",async()=>{
      const fetch=vi.fn(async()=>reply(body('{"incomplete":"private final marker"')));vi.stubGlobal("fetch",fetch);
      const error=await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("evaluate",{})).catch(error=>error);
      expect(error.code).toBe("AI_OUTPUT_INVALID_JSON");expect(error.message).toContain("completionPhase=initial");expect(error.message).toContain("completionPhase=correction");expect(error.message).toContain("outputTokens=456");expect(error.message).not.toContain(privateValue);expect(error.message).not.toContain("incomplete\"");expect(fetch).toHaveBeenCalledTimes(2);
    });
    it(protocol+" retains correction metadata on a schema wrapper",async()=>{
      const fetch=vi.fn(async()=>reply(body(fetch.mock.calls.length===1?'{invalid':JSON.stringify({criteria:[{score:privateValue}]}))));vi.stubGlobal("fetch",fetch);
      const error=await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("evaluate",{})).catch(error=>error);
      expect(error.code).toBe("AI_OUTPUT_SCHEMA_MISMATCH");expect(error.message).toContain("completionPhase=correction");expect(error.message).toContain("outputTokens=456");expect(error.message).not.toContain(privateValue);expect(fetch).toHaveBeenCalledTimes(2);
    });
    it.each([200,400,401,429,503])(protocol+" keeps initial HTTP %s errors private and retains HTTP classification",async status=>{
      const fetch=vi.fn(async()=>reply({...body("{invalid"),error:{message:privateValue}},status));vi.stubGlobal("fetch",fetch);
      const error=await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("evaluate",{})).catch(error=>error);
      expect(error.httpStatus).toBe(status);expect(error.message).toContain("completionPhase=initial");expect(error.message).not.toContain("private-source");expect(error.message).not.toContain("fictional");expect(fetch).toHaveBeenCalledOnce();
      if(status===401)expect(serverAiUnavailableReason(error)).toBe("provider-auth-or-billing");
      if(status===429)expect(serverAiUnavailableReason(error)).toBe("provider-rate-limit");
      if(status===503)expect(serverAiUnavailableReason(error)).toBe("provider-unavailable");
    });
    it(protocol+" preserves an independent valid FAIL without correction",async()=>{
      const fetch=vi.fn(async()=>reply(body(JSON.stringify(report))));vi.stubGlobal("fetch",fetch);
      expect(await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("evaluate",{}))).toEqual(report);expect(fetch).toHaveBeenCalledOnce();
    });
  }
  it.each([undefined,null,"provider_eos"])("never grants correction for unknown completion %s",async finish_reason=>{
    const fetch=vi.fn(async()=>reply({choices:[{finish_reason,message:{content:'{"unfinished":1'}}],usage:{completion_tokens:99}}));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error.code).toBe("AI_OUTPUT_INVALID_JSON");expect(error.message).toContain("completionPhase=initial");expect(error.message).toContain("contentBytes=15");expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["tool_calls","function_call"])("never prints arbitrary native finish_reason with %s",async field=>{
    const fetch=vi.fn(async()=>reply({choices:[{finish_reason:privateValue,message:{content:"{invalid",[field]:field==="tool_calls"?[{id:privateValue}]:{name:privateValue}}}]}));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error.message).toContain("finish=other");expect(error.message).not.toContain(privateValue);expect(error.message).not.toContain("private-source");expect(fetch).toHaveBeenCalledOnce();
  });
  it("distinguishes known length truncation and never repairs it",async()=>{
    const fetch=vi.fn(async()=>reply({choices:[{finish_reason:"length",message:{content:'{"unfinished":1'}}],usage:{completion_tokens:1000}}));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error.code).toBe("AI_OUTPUT_INCOMPLETE");expect(error.message).toContain("finish=length");expect(error.message).toContain("outputTokens=1000");expect(fetch).toHaveBeenCalledOnce();
  });
  it("keeps credential rotation out of the scoring identity",async()=>{
    const fingerprint=await withExplicitServerAiConnection(settings,()=>serverAiScoringRouteFingerprint());
    expect(await withExplicitServerAiConnection({...settings,apiKey:"rotated-synthetic"},()=>serverAiScoringRouteFingerprint())).toBe(fingerprint);
  });
});

it.each([1_000_000_001,Number.MAX_SAFE_INTEGER+1])("never publishes an unsafe native length token count %s",async completion_tokens=>{
 const fetch=vi.fn(async()=>reply({choices:[{finish_reason:"length",message:{content:"{invalid"}}],usage:{completion_tokens}}));vi.stubGlobal("fetch",fetch);
 const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
 if(Number.isSafeInteger(completion_tokens))expect(error.code).toBe("AI_OUTPUT_INCOMPLETE");
 else expect(error.message).toContain("envelope=invalid");
 expect(error.message).not.toContain(String(completion_tokens));expect(error.message).not.toContain("outputTokens=");expect(fetch).toHaveBeenCalledOnce();
});
it("retains distinct metadata from both actual response phases",async()=>{
 const fetch=vi.fn(async()=>reply({choices:[{finish_reason:"stop",message:{content:fetch.mock.calls.length===1?"{":"{\"second\":1"}}],usage:{completion_tokens:fetch.mock.calls.length===1?111:222}}));vi.stubGlobal("fetch",fetch);
 const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
 expect(error.message).toContain("completionPhase=initial; protocol=chat-completions; status=missing; finish=stop; contentBytes=1; outputTokens=111");
 expect(error.message).toContain("completionPhase=correction; protocol=chat-completions; status=missing; finish=stop; contentBytes=11; outputTokens=222");expect(fetch).toHaveBeenCalledTimes(2);
});