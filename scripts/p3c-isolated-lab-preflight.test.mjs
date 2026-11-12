import test from "node:test";
import assert from "node:assert/strict";
import {evaluateExperimentLabEnvironment} from "./p3c-isolated-lab-preflight.mjs";

const valid = () => ({
  EVOLUTION_EXPERIMENT_MODE: "isolated",
  EVOLUTION_TEST_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
  EVOLUTION_TEST_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SECRET_KEY: "SYNTHETIC_TEST_SECRET_NEVER_PRINT_000",
  SUPABASE_ARTIFACT_BUCKET: "evolve-audit-synthetic-run",
  EVOLUTION_TEST_ARTIFACT_BUCKET: "evolve-audit-synthetic-run",
  EVOLUTION_WORKSPACE_ID: "lab-synthetic-environment",
  EVOLUTION_IDENTITY_HMAC_SECRET: "synthetic_identity_secret_for_tests_only_000",
  EVOLUTION_VAULT_MASTER_KEY: "synthetic_vault_master_for_tests_only_000",
  EVOLUTION_VAULT_KEY_ID: "lab-synthetic-vault",
  EVOLUTION_OPERATOR_ACCESS_KEY: "a".repeat(64),
  EVOLUTION_EVIDENCE_SIGNING_KEY: "synthetic_evidence_signing_key_for_tests_000",
  EVOLUTION_EVIDENCE_SIGNING_KEY_ID: "lab-synthetic-evidence",
  EVOLUTION_EXPERIMENT_MAX_CALLS: "6",  EVOLUTION_EXPERIMENT_MAX_GENERATIONS: "3",
  EVOLUTION_EXPERIMENT_MAX_OUTPUT_TOKENS: "12000",
  EVOLUTION_EXPERIMENT_MAX_COST_USD: "5",
});
test("fails closed when the isolated environment is absent", () => {
  const out = evaluateExperimentLabEnvironment({});
  assert.equal(out.staticReady, false);
  assert.equal(out.liveCallAllowed, false);
  assert.ok(out.failureCodes.includes("ISOLATED_SUPABASE_URL_REQUIRED"));
});
test("rejects a preview pointed at the production project", () => {
  const env = valid();
  env.EVOLUTION_TEST_SUPABASE_PROJECT_REF = env.EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF;
  env.EVOLUTION_TEST_SUPABASE_URL = "https://" + env.EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF + ".supabase.co";
  const out = evaluateExperimentLabEnvironment(env);
  assert.equal(out.staticReady, false);
  assert.ok(out.failureCodes.includes("PRODUCTION_DATA_PLANE_COLLISION"));
  assert.ok(out.failureCodes.includes("PRODUCTION_URL_FORBIDDEN"));
});
test("rejects missing test service credential", () => {
  const env = valid(); env.SUPABASE_SECRET_KEY = "";  assert.ok(evaluateExperimentLabEnvironment(env).failureCodes.includes("TEST_SERVICE_CREDENTIAL_REQUIRED"));
});
test("rejects a shared or unapproved bucket", () => {
  const env = valid();env.EVOLUTION_TEST_ARTIFACT_BUCKET = "evolution-artifacts";
  assert.ok(evaluateExperimentLabEnvironment(env).failureCodes.includes("DEDICATED_AUDIT_BUCKET_REQUIRED"));
});
test("rejects model budgets exceeding the caps", () => {
  const env = valid();env.EVOLUTION_EXPERIMENT_MAX_CALLS = "7";
  env.EVOLUTION_EXPERIMENT_MAX_COST_USD = "8";
  const r=evaluateExperimentLabEnvironment(env);
  assert.ok(r.failureCodes.includes("INVALID_MODEL_CALL_LIMIT"));
  assert.ok(r.failureCodes.includes("INVALID_EXPERIMENT_COST_LIMIT"));
});
test("rejects production deployments", () => {
  const env=valid();env.VERCEL_ENV="production";
  assert.ok(evaluateExperimentLabEnvironment(env).failureCodes.includes("PRODUCTION_TARGET_FORBIDDEN"));
});
test("rejects unsupported or mismatched Supabase URLs", () => {
  const env=valid();env.EVOLUTION_TEST_SUPABASE_URL="https://supabase.example.com";
  assert.ok(evaluateExperimentLabEnvironment(env).failureCodes.includes("UNSUPPORTED_TEST_SUPABASE_URL"));
  env.EVOLUTION_TEST_SUPABASE_URL="https://differentabcdefghijkl.supabase.co";
  assert.ok(evaluateExperimentLabEnvironment(env).failureCodes.includes("TEST_REF_URL_MISMATCH"));
});
test("static readiness is never permission to make live calls", () => {
  const r=evaluateExperimentLabEnvironment(valid());
  assert.equal(r.staticReady, true);
  assert.equal(r.liveCallAllowed, false);
  assert.ok(r.pendingRuntimeGates.length>=4);
});
test("rejects a runtime URL or bucket belonging to a different environment",()=>{
  const urlEnv=valid();urlEnv.SUPABASE_URL="https://zyxwvutsrqponmlkjihg.supabase.co";
  assert.ok(evaluateExperimentLabEnvironment(urlEnv).failureCodes.includes("RUNTIME_SUPABASE_URL_MISMATCH"));
  const bucketEnv=valid();bucketEnv.SUPABASE_ARTIFACT_BUCKET="evolution-artifacts";
  assert.ok(evaluateExperimentLabEnvironment(bucketEnv).failureCodes.includes("RUNTIME_BUCKET_MISMATCH"));
});
test("requires trusted lab identity and dedicated Vault",()=>{
  const env=valid();env.EVOLUTION_IDENTITY_HMAC_SECRET="short";
  env.EVOLUTION_VAULT_KEY_ID="vault-aes-gcm-v1";
  const result=evaluateExperimentLabEnvironment(env);
  assert.ok(result.failureCodes.includes("LAB_TRUSTED_IDENTITY_REQUIRED"));
  assert.ok(result.failureCodes.includes("LAB_VAULT_REQUIRED"));
});
test("requires independent operator and evidence signing credentials",()=>{
  const env=valid();env.EVOLUTION_OPERATOR_ACCESS_KEY="short";env.EVOLUTION_EVIDENCE_SIGNING_KEY="";
  const result=evaluateExperimentLabEnvironment(env);
  assert.ok(result.failureCodes.includes("LAB_OPERATOR_ACCESS_REQUIRED"));
  assert.ok(result.failureCodes.includes("LAB_EVIDENCE_SIGNING_REQUIRED"));
});
test("never prints secret material or full project URLs", () => {
  const env=valid();const serialized=JSON.stringify(evaluateExperimentLabEnvironment(env));
  assert.equal(serialized.includes(env.EVOLUTION_TEST_SUPABASE_SECRET_KEY), false);
  assert.equal(serialized.includes(env.EVOLUTION_TEST_SUPABASE_URL), false);
});
