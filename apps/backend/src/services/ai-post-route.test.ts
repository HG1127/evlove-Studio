// @vitest-environment node
import {H3} from "nitro/h3";
import {afterEach,describe,expect,it,vi} from "vitest";
import route from "../../server/api/evolution/ai.post";
const run=vi.hoisted(()=>vi.fn());
vi.mock("./ai-gateway",async(importOriginal)=>({...(await importOriginal<typeof import("./ai-gateway")>()),runServerAi:run}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
const app=new H3().post("/ai",route);
const request=()=>app.fetch(new Request("http://localhost/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"plan",payload:{}})}));
afterEach(()=>run.mockReset());
describe("AI operation public error response",()=>{
  it("serializes a connection failure with an actionable public reason",async()=>{
    run.mockRejectedValue(Object.assign(new Error("private native cause"),{code:"SERVER_AI_PROVIDER_NETWORK_ERROR"}));
    const response=await request();
    expect(response.status).toBe(503);
    const body=await response.json();
    expect(body.data).toMatchObject({code:"SERVER_AI_UNAVAILABLE",reasonCode:"provider-network-error",message:expect.stringContaining("无法连接模型服务")});
    expect(JSON.stringify(body)).not.toContain("private native cause");
  });
  it("keeps invalid model output distinct from connection fallback",async()=>{
    run.mockRejectedValue(Object.assign(new Error("模型最终输出不符合方案结构。"),{code:"AI_OUTPUT_SCHEMA_MISMATCH"}));
    const response=await request();
    expect(response.status).toBe(502);
    expect((await response.json()).data).toEqual({code:"AI_OUTPUT_SCHEMA_MISMATCH",message:"模型最终输出不符合方案结构。"});
  });
  it("does not expose an unknown internal exception",async()=>{
    run.mockRejectedValue(new Error("private internal path"));
    const response=await request();
    expect(response.status).toBe(500);
    const body=await response.json();
    expect(body.data.code).toBe("SERVER_AI_EXECUTION_FAILED");
    expect(body.data.message).toContain("已保留当前任务");
    expect(JSON.stringify(body)).not.toContain("private internal path");
  });
});
