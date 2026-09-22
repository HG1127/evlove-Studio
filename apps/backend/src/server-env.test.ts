// @vitest-environment node
import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { getCapabilityEmbeddingConfig, getServerSupabaseConfig, getServerTargetProxyConfig, getVaultEncryptionConfig, serverSupabaseCredentialMode, serverSupabaseSecureConfigured, targetProxyCapabilities, vaultEncryptionConfigured } from "./server-env";

const KEYS=[
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ARTIFACT_BUCKET",
  "VITE_SUPABASE_ARTIFACT_BUCKET",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_OIDC_TOKEN",
  "EVOLUTION_AI_GATEWAY_ENABLED",
  "EVOLUTION_CAPABILITY_EMBEDDING_API_KEY",
  "EVOLUTION_CAPABILITY_EMBEDDING_MODEL",
  "EVOLUTION_CAPABILITY_EMBEDDING_BASE_URL",
  "EVOLUTION_CAPABILITY_EMBEDDING_DIMENSIONS",
  "EVOLUTION_TARGET_RUN_URL",
  "EVOLUTION_TARGET_RELEASE_URL",
  "EVOLUTION_TARGET_OBSERVE_URL",
  "EVOLUTION_TARGET_BEARER_TOKEN",
  "EVOLUTION_TARGET_TIMEOUT_MS",
  "EVOLUTION_WORKSPACE_ID",
  "EVOLUTION_VAULT_MASTER_KEY",
  "EVOLUTION_VAULT_KEY_ID",
  "EVOLUTION_VAULT_DECRYPT_KEYS_JSON",
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

  it("prefers server-only secret credentials when available",()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_test_fixture_0000000000000000";
    process.env.SUPABASE_SERVICE_ROLE_KEY="service_role_server_fixture_0000000000000000";
    const config=getServerSupabaseConfig();
    expect(config.anonKey).toBe("service_role_server_fixture_0000000000000000");
    expect(serverSupabaseCredentialMode()).toBe("secret");
    expect(serverSupabaseSecureConfigured()).toBe(true);
  });

  it("falls back to the internal-MVP Vite publishable key",()=>{
    process.env.VITE_SUPABASE_URL="https://example.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY="sb_publishable_test_fixture_1111111111111111";
    const config=getServerSupabaseConfig();
    expect(config.url).toBe("https://example.supabase.co");
    expect(config.anonKey).toBe("sb_publishable_test_fixture_1111111111111111");
    expect(serverSupabaseCredentialMode()).toBe("publishable");
    expect(serverSupabaseSecureConfigured()).toBe(false);
  });

  it("uses Vercel AI Gateway OIDC for capability embeddings without a static API key",()=>{
    process.env.VERCEL_ENV="production";
    process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";
    expect(getCapabilityEmbeddingConfig()).toEqual({
      mode:"vercel-gateway",
      model:"openai/text-embedding-3-small",
      dimensions:1536,
      timeoutMs:90_000,
    });
  });

  it("keeps OpenAI-compatible embedding credentials as the non-Vercel fallback",()=>{
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_API_KEY="embed-key";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_MODEL="text-embedding-test";
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_BASE_URL="https://embed.test/v1";
    expect(getCapabilityEmbeddingConfig()).toMatchObject({
      mode:"openai-compatible",
      apiKey:"embed-key",
      model:"text-embedding-test",
      baseUrl:"https://embed.test/v1",
    });
  });

  it("reports HTTP Target Run / Release / Observe capabilities independently",()=>{
    process.env.EVOLUTION_TARGET_RUN_URL="https://runner.test/run";
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://runner.test/release";
    process.env.EVOLUTION_TARGET_OBSERVE_URL="https://runner.test/observe";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="server-token";
    expect(getServerTargetProxyConfig()).toMatchObject({
      runUrl:"https://runner.test/run",
      releaseUrl:"https://runner.test/release",
      observeUrl:"https://runner.test/observe",
      token:"server-token",
    });
    expect(targetProxyCapabilities()).toEqual({
      codeReady:true,runConfigured:true,releaseConfigured:true,observeConfigured:true,credentialConfigured:true,
    });
    delete process.env.EVOLUTION_TARGET_OBSERVE_URL;
    expect(targetProxyCapabilities().observeConfigured).toBe(false);
    expect(targetProxyCapabilities().releaseConfigured).toBe(true);
  });

  it("builds a Vault active key plus historical decrypt key ring without exposing values",()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_test_fixture_1111111111111111";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_VAULT_MASTER_KEY="b".repeat(64);
    process.env.EVOLUTION_VAULT_KEY_ID="vault-v2";
    process.env.EVOLUTION_VAULT_DECRYPT_KEYS_JSON=JSON.stringify({"vault-v1":"a".repeat(64)});
    const config=getVaultEncryptionConfig();
    expect(config?.keyId).toBe("vault-v2");
    expect(Object.keys(config?.decryptKeys??{}).sort()).toEqual(["vault-v1","vault-v2"]);
    expect(vaultEncryptionConfigured()).toBe(true);
  });

  it("does not enable Vault with short key material",()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY="sb_publishable_test_fixture_1111111111111111";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_VAULT_MASTER_KEY="too-short";
    expect(getVaultEncryptionConfig()).toBeUndefined();
    expect(vaultEncryptionConfigured()).toBe(false);
  });
});
