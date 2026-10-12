// @vitest-environment node
import {createHash} from "node:crypto";
import {SERVER_SEMANTIC_CONTEXT_VERSION} from "@evolution/harness";
import {COMPATIBLE_RESPONSES_OUTPUT_VERSION,COMPATIBLE_CHAT_OUTPUT_VERSION} from "@evolution/adapters";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DIRECT_AI_SCHEMA_RECOVERY_VERSION,DIRECT_AI_SCHEMA_INSTRUCTION_VERSION,isServerAiUnavailable,runServerAi,serverAiScoringRouteFingerprint,serverAiUnavailableReason} from "./ai-gateway";

const KEYS=[
  "VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED",
  "EVOLUTION_AI_API_KEY","OPENAI_API_KEY","EVOLUTION_AI_MODEL","OPENAI_MODEL",
  "EVOLUTION_AI_BASE_URL","OPENAI_BASE_URL","EVOLUTION_AI_TIMEOUT_MS",
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
    const expected=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,responsesOutputVersion:COMPATIBLE_RESPONSES_OUTPUT_VERSION,chatOutputVersion:COMPATIBLE_CHAT_OUTPUT_VERSION,directSchemaInstructionVersion:DIRECT_AI_SCHEMA_INSTRUCTION_VERSION,directSchemaRecoveryVersion:DIRECT_AI_SCHEMA_RECOVERY_VERSION})).digest("hex");
    expect(await serverAiScoringRouteFingerprint()).toBe(expected);
    expect(await serverAiScoringRouteFingerprint()).not.toBe(legacy);
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
});
