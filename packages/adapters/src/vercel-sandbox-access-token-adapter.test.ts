import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const mock=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("@vercel/sandbox",()=>({
  Sandbox:{create:mock.create},
  Snapshot:{get:vi.fn()},
  APIError:class extends Error{},
}));
import {checkVercelSandboxHealth} from "./vercel-sandbox-adapter";

const originalEnv={...process.env};
beforeEach(()=>{
  mock.create.mockReset();
  mock.create.mockResolvedValue({
    region:"iad1",
    runCommand:vi.fn(async()=>({exitCode:0,stdout:async()=>"v22.0.0\n"})),
    stop:vi.fn(async()=>undefined),
  });
});
afterEach(()=>{process.env={...originalEnv};});

const oldJwt=[
  Buffer.from(JSON.stringify({alg:"RS256"})).toString("base64url"),
  Buffer.from(JSON.stringify({exp:1700000000,owner_id:"team_example",project_id:"prj_example"})).toString("base64url"),
  "signature",
].join(".");

describe("Sandbox SDK explicit credentials rather than expired local OIDC",()=>{
  it("passes explicitly configured scoped Access Token into real Sandbox.create options",async()=>{
    Object.assign(process.env,{
      EVOLUTION_SANDBOX_AUTH_MODE:"access-token",
      VERCEL_TOKEN:"test-scoped-token-not-a-real-secret",
      VERCEL_TEAM_ID:"team_example",
      VERCEL_PROJECT_ID:"prj_example",
      VERCEL_OIDC_TOKEN:oldJwt,
    });
    const result=await checkVercelSandboxHealth();
    expect(result.ready).toBe(true); // mocked provider only, NOT cloud proof
    expect(mock.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      token:"test-scoped-token-not-a-real-secret",
      teamId:"team_example",projectId:"prj_example",
      networkPolicy:"deny-all",persistent:false,
    }));
  });
  it("does not allow expired OIDC to spawn a Sandbox in the default mode",async()=>{
    delete process.env.EVOLUTION_SANDBOX_AUTH_MODE;
    delete process.env.VERCEL_TOKEN;
    process.env.VERCEL_OIDC_TOKEN=oldJwt;
    const result=await checkVercelSandboxHealth();
    expect(result.ready).toBe(false);
    expect(result.message).toContain("VERCEL_OIDC_EXPIRED");
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("never falls back to another identity on incomplete explicit Access Token settings",async()=>{
    Object.assign(process.env,{
      EVOLUTION_SANDBOX_AUTH_MODE:"access-token",
      VERCEL_TOKEN:"present-but-no-project",
      VERCEL_TEAM_ID:"team_example",
      VERCEL_OIDC_TOKEN:oldJwt,
    });
    delete process.env.VERCEL_PROJECT_ID;
    const result=await checkVercelSandboxHealth();
    expect(result.ready).toBe(false);
    expect(result.message).toContain("VERCEL_ACCESS_TOKEN_INCOMPLETE");
    expect(mock.create).not.toHaveBeenCalled();
  });
});
