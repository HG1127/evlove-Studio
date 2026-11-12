// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {inspectIsolatedLabRuntime} from "./isolated-lab-runtime";
import {getServerSecurityConfig,getServerSupabaseConfig,serverSupabaseConfigured,serverSupabaseSecureConfigured,vaultEncryptionConfigured} from "./server-env";

type Env=Record<string,string|undefined>;
const lab=()=>({
  EVOLUTION_EXPERIMENT_MODE:"isolated",
  EVOLUTION_TEST_SUPABASE_PROJECT_REF:"jnlbqgpezenmpksyklme",
  EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF:"mlvevgdntlswxbyxmlum",
  EVOLUTION_TEST_SUPABASE_URL:"https://jnlbqgpezenmpksyklme.supabase.co",
  SUPABASE_URL:"https://jnlbqgpezenmpksyklme.supabase.co",
  SUPABASE_SECRET_KEY:"synthetic_lab_only_service_credential_00001",
  SUPABASE_ARTIFACT_BUCKET:"evolve-audit-p3c-lab",
  EVOLUTION_TEST_ARTIFACT_BUCKET:"evolve-audit-p3c-lab",
  EVOLUTION_WORKSPACE_ID:"lab-evolve-p3c-test",
  EVOLUTION_IDENTITY_HMAC_SECRET:"synthetic_lab_only_identity_secret_00001",
  EVOLUTION_VAULT_MASTER_KEY:"synthetic_lab_only_vault_master_000001",
  EVOLUTION_VAULT_KEY_ID:"lab-test-vault-key",
  EVOLUTION_OPERATOR_ACCESS_KEY:"a".repeat(64),
  EVOLUTION_EVIDENCE_SIGNING_KEY:"synthetic_lab_evidence_signing_key_00001",
  EVOLUTION_EVIDENCE_SIGNING_KEY_ID:"lab-test-evidence-key",
} satisfies Env);
const keys=[...Object.keys(lab()),"VERCEL_ENV","VITE_SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH",
  "EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH","NODE_ENV","EVOLUTION_EXPERIMENT_TARGET"] as const;
const saved=new Map<string,string|undefined>();
function setEnv(next:Env){for(const k of keys)delete process.env[k];Object.assign(process.env,next);}
describe("P3 isolated lab server runtime boundary",()=>{
  beforeEach(()=>{for(const k of keys)saved.set(k,process.env[k]);setEnv({});});  afterEach(()=>{for(const k of keys){const v=saved.get(k);if(v===undefined)delete process.env[k];else process.env[k]=v;}saved.clear();});

  it("leaves default production behavior unchanged when experiment mode is off",()=>{
    expect(inspectIsolatedLabRuntime({})).toEqual({isolated:false,ready:true,codes:[]});
  });
  it("rejects an empty lab and does not return credential values",()=>{
    const result=inspectIsolatedLabRuntime({EVOLUTION_EXPERIMENT_MODE:"isolated",SUPABASE_SECRET_KEY:"synthetic_sensitive_do_not_emit"});
    expect(result.ready).toBe(false);
    expect(result.codes).toContain("LAB_DATA_PLANE_BINDING_MISMATCH");
    expect(JSON.stringify(result)).not.toContain("synthetic_sensitive_do_not_emit");
  });
  it("accepts unambiguous synthetic metadata but no credential is actually authenticated",()=>{
    setEnv({...lab(),NODE_ENV:"production"});
    const result=inspectIsolatedLabRuntime(process.env);
    expect(result.ready).toBe(true);
    expect(getServerSupabaseConfig().url).toBe(lab().SUPABASE_URL);
    expect(serverSupabaseSecureConfigured()).toBe(true);
    expect(vaultEncryptionConfigured()).toBe(true);
    expect(getServerSecurityConfig().mode).toBe("trusted-header");
  });
  it("blocks production Supabase even if it has a secret",()=>{
    setEnv({...lab(),SUPABASE_URL:"https://mlvevgdntlswxbyxmlum.supabase.co"});
    expect(serverSupabaseConfigured()).toBe(false);
    expect(()=>getServerSupabaseConfig()).toThrow();
  });
  it("rejects mismatching test declaration even when raw runtime URL is lab",()=>{
    setEnv({...lab(),EVOLUTION_TEST_SUPABASE_URL:"https://mlvevgdntlswxbyxmlum.supabase.co"});
    expect(inspectIsolatedLabRuntime(process.env).codes).toContain("LAB_DATA_PLANE_BINDING_MISMATCH");
  });
  it("rejects an otherwise good lab with production Vite URL",()=>{
    setEnv({...lab(),VITE_SUPABASE_URL:"https://mlvevgdntlswxbyxmlum.supabase.co"});
    expect(serverSupabaseConfigured()).toBe(false);
  });
  it("does not allow an implicit default artifact bucket",()=>{
    setEnv({...lab(),SUPABASE_ARTIFACT_BUCKET:"evolution-artifacts"});
    expect(inspectIsolatedLabRuntime(process.env).codes).toContain("LAB_DEDICATED_BUCKET_REQUIRED");
  });
  it("rejects production deployment and bypassed identity",()=>{
    setEnv({...lab(),VERCEL_ENV:"production",EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH:"1"});
    expect(getServerSecurityConfig().mode).toBe("blocked");
    expect(inspectIsolatedLabRuntime(process.env).codes).toContain("LAB_PRODUCTION_DEPLOYMENT_FORBIDDEN");
  });
  it("does not fall back to insecure internal-dev auth even with complete lab metadata",()=>{
    setEnv({...lab(),NODE_ENV:"development",EVOLUTION_IDENTITY_HMAC_SECRET:undefined});
    expect(getServerSecurityConfig().mode).toBe("blocked");
  });
  it("rejects an absent/ambiguous secret and does not fall back to browser publishable access",()=>{
    setEnv({...lab(),SUPABASE_SECRET_KEY:undefined,SUPABASE_PUBLISHABLE_KEY:"sb_publishable_synthetic"});
    expect(serverSupabaseConfigured()).toBe(false);
    expect(serverSupabaseSecureConfigured()).toBe(false);
  });
  it("rejects missing operator access and evidence signing keys",()=>{
    const env:Env=lab();delete env.EVOLUTION_OPERATOR_ACCESS_KEY;delete env.EVOLUTION_EVIDENCE_SIGNING_KEY;    const result=inspectIsolatedLabRuntime(env);
    expect(result.codes).toContain("LAB_OPERATOR_ACCESS_REQUIRED");
    expect(result.codes).toContain("LAB_EVIDENCE_SIGNING_REQUIRED");
  });
  it("requires a dedicated vault identity instead of an inherited production vault ID",()=>{
    setEnv({...lab(),EVOLUTION_VAULT_KEY_ID:"vault-aes-gcm-v1"});
    expect(vaultEncryptionConfigured()).toBe(false);
  });
});
