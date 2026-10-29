// @vitest-environment node
import {createHash} from "node:crypto";
import {SERVER_SEMANTIC_CONTEXT_VERSION,SERVER_MEASURED_REVIEW_VERSION} from "@evolution/harness";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {isServerAiUnavailable,runServerAi,serverAiScoringRouteFingerprint,serverAiUnavailableReason} from "./ai-gateway";

const KEYS=[
  "VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED",
  "EVOLUTION_AI_API_KEY","OPENAI_API_KEY","EVOLUTION_AI_MODEL","OPENAI_MODEL",
  "EVOLUTION_AI_BASE_URL","OPENAI_BASE_URL","EVOLUTION_AI_TIMEOUT_MS",
  "EVOLUTION_AI_REASONING_EFFORT",
] as const;
const previous=new Map<string,string|undefined>();

beforeEach(()=>{
  for(const key of KEYS){
    previous.set(key,process.env[key]);
    delete process.env[key];
  }
});

afterEach(()=>{
  for(const key of KEYS){
    const value=previous.get(key);
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
  vi.unstubAllGlobals();
});

describe("Server AI provider availability classification",()=>{
  it("classifies Vercel customer verification failures as unavailable",()=>{
    const error=Object.assign(new Error("AI Gateway requires a valid credit card; customer_verification_required"),{status:403});
    expect(serverAiUnavailableReason(error)).toBe("customer-verification-required");
    expect(isServerAiUnavailable(error)).toBe(true);
  });

  it("classifies nested provider auth/rate limit failures but not schema bugs",()=>{
    expect(serverAiUnavailableReason(Object.assign(new Error("outer"),{cause:{statusCode:403}}))).toBe("provider-auth-or-billing");
    expect(serverAiUnavailableReason(Object.assign(new Error("rate limit"),{statusCode:429}))).toBe("provider-rate-limit");
    expect(serverAiUnavailableReason(new Error("Zod schema mismatch"))).toBeUndefined();
  });
});

describe("server AI scoring route identity",()=> {
  it("binds semantic context policy instead of reusing the old provider-only score route",async()=>{
    process.env.EVOLUTION_AI_API_KEY="test-key";
    process.env.EVOLUTION_AI_MODEL="model-a";
    process.env.EVOLUTION_AI_BASE_URL="https://ai.example.test/v1";
    const route=["openai-compatible","https://ai.example.test/v1","model-a"];
    const legacy=createHash("sha256").update(JSON.stringify(route)).digest("hex");
    const contextOnly=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION})).digest("hex");
    const expected=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,measuredReviewVersion:SERVER_MEASURED_REVIEW_VERSION})).digest("hex");
    expect(await serverAiScoringRouteFingerprint()).toBe(expected);
    expect(await serverAiScoringRouteFingerprint()).not.toBe(legacy);
    expect(await serverAiScoringRouteFingerprint()).not.toBe(contextOnly);
  });

  it("changes with provider/model but excludes credentials and timeout",async()=> {
    process.env.EVOLUTION_AI_API_KEY="secret-first";
    process.env.EVOLUTION_AI_MODEL="model-a";
    process.env.EVOLUTION_AI_BASE_URL="https://ai.example.test/v1";
    const first=await serverAiScoringRouteFingerprint();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("secret-first");
    process.env.EVOLUTION_AI_API_KEY="secret-rotated";
    process.env.EVOLUTION_AI_TIMEOUT_MS="120000";
    expect(await serverAiScoringRouteFingerprint()).toBe(first);
    process.env.EVOLUTION_AI_MODEL="model-b";
    expect(await serverAiScoringRouteFingerprint()).not.toBe(first);
  });
});
describe("server AI multimodal gateway",()=>{
  it("sends visual evidence as image input instead of embedding the data URL in text",async()=>{
    process.env.EVOLUTION_AI_API_KEY="test-key";
    process.env.EVOLUTION_AI_MODEL="vision-test";
    process.env.EVOLUTION_AI_BASE_URL="https://ai.example.test/v1";
    const image="data:image/jpeg;base64,aGVsbG8=";
    const fetchMock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      expect(String(input)).toBe("https://ai.example.test/v1/responses");
      const body=JSON.parse(String(init?.body)) as {input:Array<{role:string;content:Array<Record<string,unknown>>}>};
      const user=body.input.find((item)=>item.role==="user");
      expect(user?.content[0]).toMatchObject({type:"input_text"});
      expect(String(user?.content[0]?.text)).not.toContain("data:image");
      expect(user?.content[1]).toEqual({type:"input_image",image_url:image});
      return new Response(JSON.stringify({
        status:"completed",
        output_text:JSON.stringify({
          scores:{usability:88,aesthetics:86,responsiveness:90,interaction:84},
          summary:"真实截图可评审",
          findings:["移动端层级清晰"],
        }),
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);

    const result=await runServerAi("visual-judge",{testCase:{id:"V1"}},{imageDataUrls:[image]});
    expect(result.scores.responsiveness).toBe(90);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed image evidence before any provider request",async()=>{
    process.env.EVOLUTION_AI_API_KEY="test-key";
    process.env.EVOLUTION_AI_MODEL="vision-test";
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(runServerAi("visual-judge",{}, {imageDataUrls:["not-a-data-url"]})).rejects.toThrow("必须是 PNG/JPEG/WebP data URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("custom provider protocols and JSON output",()=>{
  const input={
    connectionId:"custom",label:"Custom",apiKey:"custom-private-key",
    baseUrl:"https://custom.example.test/v1",model:"user-chosen-model",
    protocol:"chat-completions" as const,responseFormat:"json-object" as const,
  };
  const result={scores:{usability:80,aesthetics:81,responsiveness:82,interaction:83},summary:"真实接口输出",findings:["可观察结果"]};

  it.each(["json-object","json-schema","prompt-json"] as const)("uses user-selected chat protocol and %s format",async(responseFormat)=>{
    const fetchMock=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
      expect(String(url)).toBe("https://custom.example.test/v1/chat/completions");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toMatchObject({Authorization:"Bearer custom-private-key"});
      const body=JSON.parse(String(init?.body));
      expect(body.model).toBe("user-chosen-model");
      if(responseFormat==="prompt-json")expect(body).not.toHaveProperty("response_format");
      else expect(body.response_format.type).toBe(responseFormat==="json-object"?"json_object":"json_schema");
      if(responseFormat!=="json-schema")expect(body.messages[0].content).toContain("exact schema");
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    expect(await withExplicitServerAiConnection({...input,responseFormat},()=>runServerAi("visual-judge",{}))).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses an explicitly selected Responses endpoint without attempting chat fallback",async()=>{
    const fetchMock=vi.fn(async(url:string|URL|Request)=>{
      expect(String(url)).toBe("https://custom.example.test/v1/responses");
      return new Response(JSON.stringify({status:"completed",output_text:JSON.stringify(result)}),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    expect(await withExplicitServerAiConnection({...input,protocol:"responses"},()=>runServerAi("visual-judge",{}))).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["chat-completions","responses"] as const)("accepts final JSON after reasoning and fences via %s",async(protocol)=>{
    const content=`<think>Ignore this intermediate {"invented":"pass"}.</think>\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``;
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(protocol==="responses"
      ?{status:"completed",output_text:content}
      :{choices:[{finish_reason:"stop",message:{content}}]}),{status:200})));
    expect(await withExplicitServerAiConnection({...input,protocol},()=>runServerAi("visual-judge",{}))).toEqual(result);
  });

  it("uses final text parts and excludes a separate reasoning part",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{
      content:[{type:"reasoning",text:'{"invented":"pass"}'},{type:"text",text:JSON.stringify(result)}],
      reasoning_content:'{"invented":"pass"}',
    }}]}),{status:200})));
    expect(await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{}))).toEqual(result);
  });

  it("reserves enough output tokens for multi-case independent evaluation, without weakening JSON validation",async()=>{
    const judgement={
      accuracy:90,evidence:88,riskCoverage:87,completeness:89,safety:"PASS",notes:[],failures:[],
      cases:[{testCaseId:"V1",accuracy:90,evidence:88,completeness:89,reason:"实体原文可核验"}],
      criteria:[{criterionId:"CONTENT",score:90,pass:true,evidence:["V1: frozen source"],gaps:[],testCaseIds:["V1"]}],
    };
    const requests:Array<Record<string,unknown>>=[];
    const fetchMock=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
      requests.push(JSON.parse(String(init?.body)) as Record<string,unknown>);
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(judgement)}}]}),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    expect(await withExplicitServerAiConnection(input,()=>runServerAi("evaluate",{mode:"server-candidate"}))).toEqual(judgement);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.max_tokens).toBe(8192);
    expect(requests[0]?.response_format).toEqual({type:"json_object"});
    await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})).catch(()=>undefined);
    expect(requests[1]?.max_tokens).toBeUndefined();
  });
  it("rejects a length-limited reply even when its JSON happens to parse",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{
      finish_reason:"length",message:{content:JSON.stringify(result)},
    }]}),{status:200})));
    await expect(withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})))
      .rejects.toMatchObject({code:"AI_OUTPUT_INCOMPLETE"});
  });
  it("reserves paired output capacity and strictly parses both version slots",async()=>{
    const judgement={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",notes:[],failures:[],cases:[],criteria:[{criterionId:"CONTENT",score:90,pass:true,evidence:[],gaps:[],testCaseIds:["V1"]}]};
    const reply={schemaVersion:"paired-evaluation-v1",requestFingerprint:"issued-pair",versions:[{slot:"A",result:judgement},{slot:"B",result:judgement},{slot:"C",result:judgement}]};
    const requests:Array<Record<string,unknown>>=[];
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(reply)}}]}));}));
    expect(await withExplicitServerAiConnection({...input,responseFormat:"prompt-json"},()=>runServerAi("evaluate-paired",{evidence:"UNCHANGED_PAIR"}))).toEqual(reply);
    expect(requests).toHaveLength(1);expect(requests[0]!.max_tokens).toBe(16384);expect(requests[0]).not.toHaveProperty("response_format");
    expect(JSON.stringify(requests[0])).toContain("UNCHANGED_PAIR");
  });

  it("reports reasoning-only replies without attempting to accept them",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{
      content:"",reasoning_content:JSON.stringify(result),
    }}]}),{status:200})));
    await expect(withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})))
      .rejects.toMatchObject({code:"AI_OUTPUT_MISSING_FINAL"});
  });

  it("continues validating the task schema after removing reasoning wrappers",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{
      content:'<think>Work complete.</think> {"invented":"pass"}',
    }}]}),{status:200})));
    await expect(withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})))
      .rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});
  });

  it("never accepts a malformed provider result even in prompt-only JSON mode",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      choices:[{message:{content:JSON.stringify({invented:"pass"})}}],
    }),{status:200})));
    await expect(withExplicitServerAiConnection({...input,responseFormat:"prompt-json"},()=>runServerAi("visual-judge",{}))).rejects.toThrow();
  });

  it("preserves auth/billing classification for a custom chat endpoint",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:{message:"denied"}}),{status:403})));
    const error=await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})).catch((value:unknown)=>value);
    expect(serverAiUnavailableReason(error)).toBe("provider-auth-or-billing");
  });

  it("redacts an echoed provider key from errors returned by any custom endpoint",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      error:{message:"Provider rejected "+input.apiKey},
    }),{status:403})));
    const error=await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})).catch((value:unknown)=>value);
    expect((error as Error).message).toContain("[REDACTED]");
    expect((error as Error).message).not.toContain(input.apiKey);
    expect((error as Error).stack).not.toContain(input.apiKey);
    expect(serverAiUnavailableReason(error)).toBe("provider-auth-or-billing");
  });

  it("changes scoring identity with protocol or JSON mode but not an API key rotation",async()=>{
    const identity=await withExplicitServerAiConnection(input,()=>serverAiScoringRouteFingerprint());
    expect(await withExplicitServerAiConnection({...input,apiKey:"rotated"},()=>serverAiScoringRouteFingerprint())).toBe(identity);
    expect(await withExplicitServerAiConnection({...input,protocol:"responses"},()=>serverAiScoringRouteFingerprint())).not.toBe(identity);
    expect(await withExplicitServerAiConnection({...input,responseFormat:"prompt-json"},()=>serverAiScoringRouteFingerprint())).not.toBe(identity);
  });
  it("recovers a transient network failure using the configured provider",async()=>{
    const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("fetch failed",{cause:{code:"ECONNRESET"}}))
      .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    expect(await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{}))).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
  });
  it("repairs a missing structured field with exactly one grounded schema retry",async()=>{
    const first={choices:[{message:{content:JSON.stringify({summary:"missing scores",findings:[]})}}]};
    const valid={choices:[{message:{content:JSON.stringify(result)}}]};
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(first),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify(valid),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const settled=await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{}));
    expect(settled).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const original=JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {messages:Array<{content:string}>};
    const retry=JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as {messages:Array<{content:string}>};
    expect(retry.messages[0]!.content).toContain("PREVIOUS OUTPUT INVALID");
    expect(retry.messages[0]!.content).toContain("scores");
    expect(retry.messages[1]!.content).toBe(original.messages[1]!.content);
  });
  it("retries malformed final JSON once with concise, schema-bound instructions",async()=>{
    const broken={choices:[{message:{content:'{"scores":'}}]};
    const valid={choices:[{message:{content:JSON.stringify(result)}}]};
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(broken),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify(valid),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    expect(await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{}))).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry=JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as {messages:Array<{content:string}>};
    expect(retry.messages[0]!.content).toContain("JSON syntax");
    expect(retry.messages[0]!.content).toContain("COMPLETE syntactically valid JSON");
  });
  it("sends a bounded structural diagnosis on the single format correction without forwarding invalid prose",async()=>{
    const broken='{"scores":[{"private":"PRIVATE_INVALID_REPLY"}}]}';
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:broken}}]}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    expect(await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{}))).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first=JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)),retry=JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(retry.messages[0].content).toContain("expected comma or closing square bracket");
    expect(retry.messages[0].content).toContain("got closing brace");
    expect(retry.messages[0].content).not.toContain("PRIVATE_INVALID_REPLY");
    expect(retry.messages[1].content).toBe(first.messages[1].content);
  });
  it.each([1,9])("repairs a %s-case Hidden paper with the unchanged cardinality contract and exact source payload",async(count)=>{
    const makeCase=(id:string,hidden:boolean)=>({id,title:id,input:"independent scenario "+id,expected:["observed"],tags:[],hidden,
      criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"});
    const makeSuite=(length:number)=>({validationCases:Array.from({length:3},(_,i)=>makeCase("V"+i,false)),
      hiddenCases:Array.from({length},(_,i)=>makeCase("F"+i,true)),summary:"independent final paper"});
    const invalid=makeSuite(count),valid=makeSuite(count<2?2:8);
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(invalid)}}]}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const payload={original:"same exact original",instruction:"reserve before planning"};
    const settled=await withExplicitServerAiConnection(input,()=>runServerAi("eval-suite",payload));
    expect(settled.hiddenCases).toHaveLength(valid.hiddenCases.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const original=JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    const retry=JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(original.messages[0].content).toContain('"minItems":2,"maxItems":8');
    expect(retry.messages[0].content).toContain("hiddenCases:");
    expect(retry.messages[0].content).toContain(count<2?">=2":"<=8");
    expect(retry.messages[1].content).toBe(original.messages[1].content);
    fetchMock.mockImplementation(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(invalid)}}]}),{status:200}));
    await expect(withExplicitServerAiConnection(input,()=>runServerAi("eval-suite",payload)))
      .rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});
  });
  it("rejects an invented seventh-case document scope and retries with the exact unchanged enum",async()=>{
    const test=(id:string,hidden:boolean)=>({id,title:id,input:"inspect document",expected:["written steps"],tags:[],hidden,
      criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior",browserSteps:[]});
    const valid={validationCases:Array.from({length:3},(_,i)=>test("V"+i,false)),hiddenCases:Array.from({length:8},(_,i)=>test("H"+i,true)),summary:"paper"};
    const invalid=structuredClone(valid);invalid.hiddenCases[6]!.evidenceScope="document-content";
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(invalid)}}]}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const payload={original:"same source",instruction:"reserve before planning"};
    const result=await withExplicitServerAiConnection(input,()=>runServerAi("eval-suite",payload));
    expect(result.hiddenCases[6]!.evidenceScope).toBe("product-behavior");expect(fetchMock).toHaveBeenCalledTimes(2);
    const first=JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    const retry=JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(retry.messages[0].content).toContain("hiddenCases.6.evidenceScope");
    for(const scope of ["product-behavior","implementation","format","parser","cross-artifact"])expect(retry.messages[0].content).toContain(scope);
    expect(first.messages[0].content).toContain("Do not invent document/content/semantic scope aliases");
    expect(retry.messages[1].content).toBe(first.messages[1].content);
  });
  it("stops after one retry when schema remains invalid instead of inventing a success",async()=>{
    const invalid={choices:[{message:{content:JSON.stringify({summary:"no evidence"})}}]};
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify(invalid),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})))
      .rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("sends browser assertions in the final-paper schema and preserves the returned executable steps",async()=>{
    const test=(id:string,hidden:boolean)=>({id,title:id,input:"independent DOM scenario "+id,expected:["111 cards"],tags:[],hidden,
      criterionIds:["PROTECT"],executionMode:"external-runner",evidenceScope:"product-behavior",
      browserSteps:[{action:"count",selector:"article.slide-card",count:111,value:""}]});
    const result={validationCases:Array.from({length:3},(_,i)=>test("V"+i,false)),hiddenCases:[test("F1",true),test("F2",true)],summary:"actual DOM assertions"};
    const fetchMock=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body));
      const schema=request.response_format.json_schema.schema.properties.hiddenCases.items;
      expect(schema.required).toContain("browserSteps");
      expect(schema.properties.browserSteps).toMatchObject({type:"array",maxItems:24,items:{properties:{action:{enum:["click","fill","visible","text","count"]}}}});
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    const response=await withExplicitServerAiConnection({...input,responseFormat:"json-schema"},()=>runServerAi("eval-suite",{}));
    expect(response.hiddenCases[0]?.browserSteps).toEqual(result.hiddenCases[0]!.browserSteps);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("preserves network classification without exposing native causes or credentials",async()=>{
    const fetchMock=vi.fn().mockRejectedValue(new TypeError("fetch failed "+input.apiKey,{cause:{code:"ECONNRESET"}}));
    vi.stubGlobal("fetch",fetchMock);
    const error=await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})).catch((value:unknown)=>value);
    expect(error).toMatchObject({code:"SERVER_AI_PROVIDER_NETWORK_ERROR"});
    expect(serverAiUnavailableReason(error)).toBe("provider-network-error");
    expect((error as Error).message).toContain("无法连接模型服务");
    expect((error as Error).message).not.toContain(input.apiKey);
    expect(error).not.toHaveProperty("cause");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("preserves a nested provider timeout and avoids extending its deadline",async()=>{
    const fetchMock=vi.fn().mockRejectedValue(new TypeError("fetch failed",{cause:{code:"UND_ERR_CONNECT_TIMEOUT"}}));
    vi.stubGlobal("fetch",fetchMock);
    const error=await withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})).catch((value:unknown)=>value);
    expect(error).toMatchObject({code:"SERVER_AI_PROVIDER_TIMEOUT"});
    expect(serverAiUnavailableReason(error)).toBe("provider-timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
