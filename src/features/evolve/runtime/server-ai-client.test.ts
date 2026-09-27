import {afterEach,describe,expect,it,vi} from "vitest";
import {runServerAiOperation,ServerAiUnavailableError} from "./server-ai-client";

describe("server AI degraded fallback classification",()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it.each([401,403])("treats HTTP %s as browser-server identity unavailable so API can fall back to local/BYOK",async(status)=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:status,
      statusMessage:"Trusted Evolution actor headers are required",
    }),{status,headers:{"Content-Type":"application/json"}})));

    await expect(runServerAiOperation("plan",{project:{}}))
      .rejects.toBeInstanceOf(ServerAiUnavailableError);
  });

  it("keeps the explicit server AI provider-unavailable contract as a local-fallback signal",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:503,
      statusMessage:"Server AI provider is not configured",
      data:{code:"SERVER_AI_UNAVAILABLE"},
    }),{status:503,headers:{"Content-Type":"application/json"}})));

    await expect(runServerAiOperation("plan",{project:{}}))
      .rejects.toBeInstanceOf(ServerAiUnavailableError);
  });

  it.each([422,500])("keeps HTTP %s as a real error instead of hiding it behind local fallback",async(status)=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:status,
      statusMessage:"AI request failed truthfully",
    }),{status,headers:{"Content-Type":"application/json"}})));

    const request=runServerAiOperation("plan",{project:{}});
    await expect(request).rejects.toThrow("AI request failed truthfully");
    await expect(request).rejects.not.toBeInstanceOf(ServerAiUnavailableError);
  });

  it("does not treat a generic 503 without SERVER_AI_UNAVAILABLE as a fallback signal",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:503,statusMessage:"Upstream service fault",data:{code:"OTHER"},
    }),{status:503,headers:{"Content-Type":"application/json"}})));

    const request=runServerAiOperation("plan",{project:{}});
    await expect(request).rejects.toThrow("Upstream service fault");
    await expect(request).rejects.not.toBeInstanceOf(ServerAiUnavailableError);
  });
  it("validates a successful AI result against the requested operation",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      operation:"gap-advice",result:{overall:"Needs one fix",actions:[]},
    }),{status:200})));
    await expect(runServerAiOperation("gap-advice",{project:{}}))
      .resolves.toEqual({overall:"Needs one fix",actions:[]});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      operation:"gap-advice",result:{overall:17,actions:[]},
    }),{status:200})));
    await expect(runServerAiOperation("gap-advice",{project:{}})).rejects.toThrow();
  });

  it("does not accept a successful response for a different operation",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      operation:"plan",result:{overall:"Valid for another operation",actions:[]},
    }),{status:200})));
    await expect(runServerAiOperation("gap-advice",{project:{}}))
      .rejects.toThrow("Server AI response operation mismatch");
  });
});
