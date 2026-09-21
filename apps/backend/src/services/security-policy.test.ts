// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {getServerSecurityConfig} from "../server-env";
import {getSecurityCapabilities,permissionAllowed} from "./security-policy";

const KEYS=[
  "NODE_ENV","EVOLUTION_IDENTITY_HMAC_SECRET","EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH",
  "EVOLUTION_WORKSPACE_ID","SUPABASE_URL","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY","VITE_SUPABASE_ANON_KEY",
] as const;
const previous=new Map<string,string|undefined>();

describe("security policy",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
  });
  afterEach(()=>{
    for(const key of KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });

  it("separates approval from execution roles",()=>{
    expect(permissionAllowed("approver","release.approve")).toBe(true);
    expect(permissionAllowed("approver","release.execute")).toBe(false);
    expect(permissionAllowed("operator","release.execute")).toBe(true);
    expect(permissionAllowed("operator","release.approve")).toBe(false);
    expect(permissionAllowed("service","release.execute")).toBe(true);
    expect(permissionAllowed("service","release.approve")).toBe(false);
    expect(permissionAllowed("admin","release.execute")).toBe(true);
    expect(permissionAllowed("admin","release.approve")).toBe(true);
  });

  it("does not enter trusted-header mode with a weak identity secret in production",()=>{
    process.env.NODE_ENV="production";
    process.env.EVOLUTION_IDENTITY_HMAC_SECRET="too-short";
    expect(getServerSecurityConfig().mode).toBe("blocked");
  });

  it("reports production-safe only with trusted identity, workspace and server-only Supabase credential",()=>{
    process.env.NODE_ENV="production";
    process.env.EVOLUTION_IDENTITY_HMAC_SECRET="0123456789abcdef0123456789abcdef";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_SECRET_KEY="server-secret-key-1234567890";
    const security=getSecurityCapabilities();
    expect(security).toMatchObject({
      mode:"trusted-header",
      configured:true,
      enforced:true,
      productionSafe:true,
      workspaceId:"workspace-test",
    });
    expect(security.credentials.find((item)=>item.id==="supabase-data-plane")?.configured).toBe(true);
  });

  it("keeps internal-dev explicitly non-production-safe",()=>{
    process.env.NODE_ENV="development";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    const security=getSecurityCapabilities();
    expect(security.mode).toBe("internal-dev");
    expect(security.productionSafe).toBe(false);
  });
});
