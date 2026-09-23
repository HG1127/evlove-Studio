// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";

const originalEnv={...process.env};

afterEach(()=>{
  process.env={...originalEnv};
  vi.unstubAllGlobals();
});

describe("public readiness passive boundary",()=>{
  it("never performs network I/O or claims active health from an unauthenticated request",async()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY="server-secret-key-for-passive-readiness-test";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_IDENTITY_HMAC_SECRET="x".repeat(40);
    process.env.EVOLUTION_AI_API_KEY="ai-key";
    process.env.EVOLUTION_AI_MODEL="model";
    process.env.EVOLUTION_GITHUB_TOKEN="git-token";
    process.env.EVOLUTION_GITHUB_REPO_ALLOWLIST="acme/repo";
    process.env.EVOLUTION_GITHUB_WEBHOOK_SECRET="webhook";
    process.env.EVOLUTION_CONNECTORS_JSON=JSON.stringify([{
      id:"workflow-main",label:"Workflow",targetType:"workflow",baseUrl:"https://connector.example.com",
      mutationMode:"staged-version",paths:{read:"/read",snapshot:"/snapshot",mutate:"/mutate",validate:"/validate",deploy:"/deploy",observe:"/observe",rollback:"/rollback"},
    }]);
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("public readiness must not call fetch");}));

    vi.resetModules();
    const {getPublicReadinessSnapshot}=await import("./public-readiness");
    const snapshot=await getPublicReadinessSnapshot();

    expect(snapshot.probeMode).toBe("passive-config");
    expect(snapshot.dataPlane).toMatchObject({configured:true,secureCredential:true,database:false,storage:false,coreTables:false});
    expect(snapshot.serverAi).toBe(true);
    expect(snapshot.sandbox).toBe(false);
    expect(snapshot.browser).toBe(false);
    expect(snapshot.release).toEqual({read:false,write:false});
    expect(snapshot.connectors).toEqual({configured:true,fullLifecycle:true});
    expect(snapshot.security).toMatchObject({configured:true,enforced:true,productionSafe:false});
    expect(snapshot.blockers.map((item)=>item.code)).not.toContain("SUPABASE_SERVER_SECRET_MISSING");
    expect(snapshot.blockers.map((item)=>item.code)).not.toContain("WORKSPACE_ID_MISSING");
    expect(snapshot.blockers.map((item)=>item.code)).not.toContain("IDENTITY_NOT_CONFIGURED");
    expect(snapshot.blockers.map((item)=>item.code)).not.toContain("RELEASE_PROVIDER_NOT_CONFIGURED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns actionable configuration blockers without probing external systems",async()=>{
    process.env.NODE_ENV="production";
    process.env.SUPABASE_URL="https://example.supabase.co";
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_fixture";
    process.env.SUPABASE_ARTIFACT_BUCKET="evolution-artifacts";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_IDENTITY_HMAC_SECRET="x".repeat(40);
    process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";
    process.env.VERCEL_ENV="production";
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("public readiness must remain passive");}));

    vi.resetModules();
    const {getPublicReadinessSnapshot}=await import("./public-readiness");
    const snapshot=await getPublicReadinessSnapshot();

    expect(snapshot.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code:"SUPABASE_SERVER_SECRET_MISSING",
        severity:"error",
        area:"data-plane",
        configurationOnly:true,
      }),
      expect.objectContaining({
        code:"RELEASE_PROVIDER_NOT_CONFIGURED",
        severity:"warning",
        area:"release",
      }),
    ]));
    expect(snapshot.blockers.find((item)=>item.code==="SUPABASE_SERVER_SECRET_MISSING")?.action)
      .toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });
});
