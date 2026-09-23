// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {isServerAiUnavailable,runServerAi,serverAiUnavailableReason} from "./ai-gateway";

const KEYS=[
  "VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED",
  "EVOLUTION_AI_API_KEY","OPENAI_API_KEY","EVOLUTION_AI_MODEL","OPENAI_MODEL",
  "EVOLUTION_AI_BASE_URL","OPENAI_BASE_URL",
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
