import {pathToFileURL} from "node:url";

const fail = (code, message) => ({code, message});
const filled = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Disposable P3 experiment preflight. Checks non-secret configuration metadata.
 * Static success does NOT authorize any API call; runtime Vault / Judge / budget
 * and independent evaluation gates must be satisfied separately.
 */
export function evaluateExperimentLabEnvironment(env = process.env) {
  const failures = [];
  if (env.EVOLUTION_EXPERIMENT_MODE !== "isolated") failures.push(fail("LAB_MODE_REQUIRED", "必须明确启用隔离实验模式。"));
  if (env.VERCEL_ENV === "production" || env.EVOLUTION_EXPERIMENT_TARGET === "production") {
    failures.push(fail("PRODUCTION_TARGET_FORBIDDEN", "禁止在正式部署执行实验。"));
  }

  const testRef = env.EVOLUTION_TEST_SUPABASE_PROJECT_REF?.trim();
  const prodRef = env.EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF?.trim();
  const urlText = env.EVOLUTION_TEST_SUPABASE_URL?.trim();
  if (!filled(testRef) || !filled(prodRef)) {
    failures.push(fail("EXPLICIT_PROJECT_REFS_REQUIRED", "必须声明测试与正式 Supabase 项目身份。"));
  }
  if (filled(testRef) && filled(prodRef) && testRef === prodRef) {
    failures.push(fail("PRODUCTION_DATA_PLANE_COLLISION", "测试数据平面与正式数据平面身份相同。"));
  }

  let hostRef = null;
  if (!filled(urlText)) failures.push(fail("ISOLATED_SUPABASE_URL_REQUIRED", "缺少专用实验 Supabase 地址。"));
  else {
    try {
      const url = new URL(urlText);
      const match = /^([a-z0-9]{12,32})\.supabase\.co$/i.exec(url.hostname);
      if (url.protocol !== "https:" || !match || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        failures.push(fail("UNSUPPORTED_TEST_SUPABASE_URL", "实验数据平面必须是独立的 HTTPS Supabase 项目根地址。"));
      } else hostRef = match[1];
    } catch {
      failures.push(fail("INVALID_TEST_SUPABASE_URL", "实验数据平面地址无效。"));
    }
  }
  if (filled(testRef) && hostRef && hostRef !== testRef) {
    failures.push(fail("TEST_REF_URL_MISMATCH", "实验地址与声明的 Supabase 测试项目身份不一致。"));
  }
  if (filled(prodRef) && hostRef && hostRef === prodRef) {
    failures.push(fail("PRODUCTION_URL_FORBIDDEN", "实验地址指向声明的正式项目。"));
  }
  const serverUrl=env.SUPABASE_URL?.trim();
  if(!filled(serverUrl)||serverUrl!==urlText)failures.push(fail("RUNTIME_SUPABASE_URL_MISMATCH","服务端 Supabase 地址必须与独立实验项目一致。"));
  const secret=env.SUPABASE_SECRET_KEY?.trim();
  if(!filled(secret)||secret.length<24||filled(env.EVOLUTION_TEST_SUPABASE_SECRET_KEY)&&env.EVOLUTION_TEST_SUPABASE_SECRET_KEY!==secret)
    failures.push(fail("TEST_SERVICE_CREDENTIAL_REQUIRED","实验环境必须配置自己的 Supabase 服务端密钥。"));
  const bucket = env.EVOLUTION_TEST_ARTIFACT_BUCKET?.trim();
  if (!filled(bucket) || !/^evolve-audit-[a-z0-9-]{4,48}$/.test(bucket)) {
    failures.push(fail("DEDICATED_AUDIT_BUCKET_REQUIRED", "必须使用独立的 evolve-audit-* Artifact Bucket。"));
  }
  if(env.SUPABASE_ARTIFACT_BUCKET?.trim()!==bucket)failures.push(fail("RUNTIME_BUCKET_MISMATCH","后端运行 Bucket 与实验专用 Bucket 不一致。"));
  if(!/^lab-[a-z0-9-]{6,80}$/.test(env.EVOLUTION_WORKSPACE_ID?.trim()??""))failures.push(fail("LAB_WORKSPACE_REQUIRED","必须使用独立 Lab Workspace。"));
  if((env.EVOLUTION_IDENTITY_HMAC_SECRET?.trim().length??0)<32
    || /^(1|true|yes|on)$/i.test(env.EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH??""))
    failures.push(fail("LAB_TRUSTED_IDENTITY_REQUIRED","实验环境必须启用可信身份验证。"));
  if((env.EVOLUTION_VAULT_MASTER_KEY?.trim().length??0)<32
    || !/^lab-[a-z0-9-]{4,80}$/.test(env.EVOLUTION_VAULT_KEY_ID?.trim()??""))
    failures.push(fail("LAB_VAULT_REQUIRED","实验环境必须使用独立 Vault 加密密钥。"));
  if(!/^[a-f0-9]{64}$/i.test(env.EVOLUTION_OPERATOR_ACCESS_KEY?.trim()??""))
    failures.push(fail("LAB_OPERATOR_ACCESS_REQUIRED","必须配置独立的64位十六进制管理员访问密钥。"));
  if((env.EVOLUTION_EVIDENCE_SIGNING_KEY?.trim().length??0)<32
    || !/^lab-[a-z0-9-]{4,80}$/.test(env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID?.trim()??""))
    failures.push(fail("LAB_EVIDENCE_SIGNING_REQUIRED","必须配置独立证据签名密钥。"));
  const maxCalls = Number(env.EVOLUTION_EXPERIMENT_MAX_CALLS);
  const maxGenerations = Number(env.EVOLUTION_EXPERIMENT_MAX_GENERATIONS);
  const maxOutputTokens = Number(env.EVOLUTION_EXPERIMENT_MAX_OUTPUT_TOKENS);
  const maxCost = Number(env.EVOLUTION_EXPERIMENT_MAX_COST_USD);
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 6) failures.push(fail("INVALID_MODEL_CALL_LIMIT", "最多允许 6 次模型生成/修复调用。"));
  if (!Number.isInteger(maxGenerations) || maxGenerations < 1 || maxGenerations > 3) failures.push(fail("INVALID_GENERATION_LIMIT", "最多允许 3 代成果物。"));
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 12000) failures.push(fail("INVALID_OUTPUT_TOKEN_LIMIT", "单次输出 Token 上限为 12000。"));
  if (!Number.isFinite(maxCost) || maxCost <= 0 || maxCost > 5) failures.push(fail("INVALID_EXPERIMENT_COST_LIMIT", "实验上限必须不超过 5 美元。"));

  return {
    staticReady: failures.length === 0,
    liveCallAllowed: false,
    failureCodes: [...new Set(failures.map((item) => item.code))],
    failures,
    checks: {
      isolatedProjectDeclared: Boolean(hostRef && testRef && hostRef === testRef && prodRef && hostRef !== prodRef),
      testSecretPresent: filled(env.SUPABASE_SECRET_KEY),      dedicatedArtifactBucketDeclared: Boolean(bucket && /^evolve-audit-[a-z0-9-]{4,48}$/.test(bucket)),
      modelCallsMaximum: Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 6 ? maxCalls : null,
      generationsMaximum: Number.isInteger(maxGenerations) && maxGenerations >= 1 && maxGenerations <= 3 ? maxGenerations : null,
    },
    pendingRuntimeGates: [
      "隔离 Supabase 认证、存储 Bucket 和项目权限实际验收",
      "加密 Vault 中已授权生成模型的真实连接状态",
      "独立 Judge 的真实调用与隐藏评测隔离",
      "模型供应商端预算限制与超时/取消控制",
      "只针对一次性合成 HTML Mission 的执行授权",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluateExperimentLabEnvironment();
  console.log(JSON.stringify(result, null, 2));
  if (!result.staticReady) process.exitCode = 2;
}
