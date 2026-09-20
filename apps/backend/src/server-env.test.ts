// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { getServerSupabaseConfig } from "./server-env";

const KEYS=[
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ARTIFACT_BUCKET",
  "VITE_SUPABASE_ARTIFACT_BUCKET",
] as const;

const previous=new Map<string,string|undefined>();

describe("server Supabase env",()=>{
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
  });

  it("prefers publishable credentials and ignores a leftover service-role key",()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_test_fixture_0000000000000000";
    process.env.SUPABASE_SERVICE_ROLE_KEY="service_role_should_never_be_selected";
    const config=getServerSupabaseConfig();
    expect(config.anonKey).toBe("sb_publishable_test_fixture_0000000000000000");
    expect(config.anonKey).not.toContain("service_role");
  });

  it("falls back to the internal-MVP Vite publishable key",()=>{
    process.env.VITE_SUPABASE_URL="https://example.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY="sb_publishable_test_fixture_1111111111111111";
    const config=getServerSupabaseConfig();
    expect(config.url).toBe("https://example.supabase.co");
    expect(config.anonKey).toBe("sb_publishable_test_fixture_1111111111111111");
  });
});
