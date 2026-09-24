import { SupabaseBackendConfigSchema, type SupabaseBackendConfig } from "@evolution/contracts";
import {createError} from "nitro/h3";
import fs from "node:fs";
import path from "node:path";

function value(...items:Array<string|undefined>) {
  return items.map((item)=>item?.trim()).find(Boolean);
}

export function getServerSupabaseConfig():SupabaseBackendConfig {
  const url=value(process.env.SUPABASE_URL,process.env.VITE_SUPABASE_URL);
  const secret=value(process.env.SUPABASE_SECRET_KEY,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const publishable=value(process.env.SUPABASE_PUBLISHABLE_KEY,process.env.VITE_SUPABASE_ANON_KEY);
  const allowPublishable=/^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE)??"")
    ||process.env.NODE_ENV!=="production";
  const key=secret??(allowPublishable?publishable:undefined);
  const artifactBucket=value(process.env.SUPABASE_ARTIFACT_BUCKET,process.env.VITE_SUPABASE_ARTIFACT_BUCKET)
    ?? "evolution-artifacts";
  const parsed=SupabaseBackendConfigSchema.safeParse({url,anonKey:key,artifactBucket});
  if(!parsed.success){
    const diagnostics=serverSupabaseConfigDiagnostics();
    throw createError({
      statusCode:503,
      statusMessage:"Server Data Plane 未配置或当前不可用",
      data:{
        code:"SERVER_DATA_PLANE_UNAVAILABLE",
        credentialMode:diagnostics.credentialMode,
        urlPresent:diagnostics.urlPresent,
        secretPresent:diagnostics.secretPresent,
        publishablePresent:diagnostics.publishablePresent,
        artifactBucketPresent:diagnostics.artifactBucketPresent,
        issueFields:diagnostics.issueFields,
      },
    });
  }
  return parsed.data;
}

export function serverSupabaseConfigured(){
  const url=value(process.env.SUPABASE_URL,process.env.VITE_SUPABASE_URL);
  const secret=value(process.env.SUPABASE_SECRET_KEY,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const publishable=value(process.env.SUPABASE_PUBLISHABLE_KEY,process.env.VITE_SUPABASE_ANON_KEY);
  const allowPublishable=/^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE)??"")
    ||process.env.NODE_ENV!=="production";
  const key=secret??(allowPublishable?publishable:undefined);
  return SupabaseBackendConfigSchema.safeParse({
    url,
    anonKey:key,
    artifactBucket:value(process.env.SUPABASE_ARTIFACT_BUCKET,process.env.VITE_SUPABASE_ARTIFACT_BUCKET)??"evolution-artifacts",
  }).success;
}

export function serverSupabaseCredentialMode():"secret"|"publishable"|"missing"{
  if(value(process.env.SUPABASE_SECRET_KEY,process.env.SUPABASE_SERVICE_ROLE_KEY))return "secret";
  const publishable=value(process.env.SUPABASE_PUBLISHABLE_KEY,process.env.VITE_SUPABASE_ANON_KEY);
  const allow=/^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE)??"")
    ||process.env.NODE_ENV!=="production";
  return publishable&&allow?"publishable":"missing";
}

export function serverSupabaseSecureConfigured(){
  return serverSupabaseConfigured()&&serverSupabaseCredentialMode()==="secret";
}

export function scheduledReconciliationConfigured(){
  return (value(process.env.CRON_SECRET)?.length??0)>=16;
}

export function serverSupabaseConfigDiagnostics(){
  const url=value(process.env.SUPABASE_URL,process.env.VITE_SUPABASE_URL);
  const secret=value(process.env.SUPABASE_SECRET_KEY,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const publishable=value(process.env.SUPABASE_PUBLISHABLE_KEY,process.env.VITE_SUPABASE_ANON_KEY);
  const allowPublishable=/^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE)??"")
    ||process.env.NODE_ENV!=="production";
  const key=secret??(allowPublishable?publishable:undefined);
  const artifactBucket=value(process.env.SUPABASE_ARTIFACT_BUCKET,process.env.VITE_SUPABASE_ARTIFACT_BUCKET)
    ??"evolution-artifacts";
  const parsed=SupabaseBackendConfigSchema.safeParse({url,anonKey:key,artifactBucket});
  return {
    credentialMode:serverSupabaseCredentialMode(),
    urlPresent:Boolean(url),
    secretPresent:Boolean(secret),
    publishablePresent:Boolean(publishable),
    artifactBucketPresent:Boolean(value(process.env.SUPABASE_ARTIFACT_BUCKET,process.env.VITE_SUPABASE_ARTIFACT_BUCKET)),
    configValid:parsed.success,
    issueFields:parsed.success
      ?[]
      :[...new Set(parsed.error.issues.map((issue)=>String(issue.path[0]??"config")))].sort(),
  };
}

export function getEvolutionWorkspaceId(){
  return value(process.env.EVOLUTION_WORKSPACE_ID);
}

export function releaseApprovalTtlSeconds(){
  const raw=Number(value(process.env.EVOLUTION_RELEASE_APPROVAL_TTL_SECONDS)??"3600")||3600;
  return Math.max(300,Math.min(raw,86_400));
}

export type VaultEncryptionConfig={
  keyId:string;
  activeKey:string;
  decryptKeys:Record<string,string>;
};

function vaultDecryptKeyRing(){
  const raw=value(process.env.EVOLUTION_VAULT_DECRYPT_KEYS_JSON);
  if(!raw)return {} as Record<string,string>;
  try{
    const parsed=JSON.parse(raw) as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string,unknown>)
        .filter(([id,key])=>id.trim().length>0&&id.length<=120&&typeof key==="string"&&key.length>=32)
        .slice(0,32)
        .map(([id,key])=>[id,key as string]),
    );
  }catch{return {};}
}

export function getVaultEncryptionConfig():VaultEncryptionConfig|undefined{
  const activeKey=value(process.env.EVOLUTION_VAULT_MASTER_KEY);
  if(!activeKey||activeKey.length<32)return undefined;
  const keyId=value(process.env.EVOLUTION_VAULT_KEY_ID)??"vault-aes-gcm-v1";
  return {
    keyId,
    activeKey,
    decryptKeys:{...vaultDecryptKeyRing(),[keyId]:activeKey},
  };
}

export function vaultEncryptionConfigured(){
  return Boolean(getVaultEncryptionConfig())&&serverSupabaseConfigured()&&Boolean(getEvolutionWorkspaceId());
}

export type ServerSecurityConfig={
  mode:"trusted-header"|"vercel-protected-internal"|"internal-dev"|"blocked";
  identitySecret?:string;
  protectedDeploymentHost?:string;
  maxActorAgeSeconds:number;
  workspaceId?:string;
};

function normalizedVercelHost(raw:string|undefined){
  const host=value(raw)?.replace(/^https?:\/\//i,"").split("/")[0]?.trim().toLowerCase();
  return host||undefined;
}

export function getServerSecurityConfig():ServerSecurityConfig{
  const rawIdentitySecret=value(process.env.EVOLUTION_IDENTITY_HMAC_SECRET);
  const identitySecret=rawIdentitySecret&&rawIdentitySecret.length>=32?rawIdentitySecret:undefined;
  const protectedDeploymentHost=normalizedVercelHost(process.env.VERCEL_URL);
  const allowProtectedInternal=/^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH)??"")
    &&process.env.VERCEL==="1"
    &&Boolean(protectedDeploymentHost);
  const allowInternal=/^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH)??"")
    ||process.env.NODE_ENV!=="production";
  return {
    mode:allowProtectedInternal?"vercel-protected-internal":identitySecret?"trusted-header":allowInternal?"internal-dev":"blocked",
    identitySecret,
    protectedDeploymentHost,
    maxActorAgeSeconds:Math.max(60,Math.min(Number(value(process.env.EVOLUTION_IDENTITY_MAX_AGE_SECONDS)??"3600")||3600,86_400)),
    workspaceId:getEvolutionWorkspaceId(),
  };
}

export function organizationCapabilityConfigured(){
  return serverSupabaseConfigured()&&Boolean(getEvolutionWorkspaceId());
}

export type EvidenceLedgerSigningConfig={
  key:string;
  keyId:string;
  verificationKeys:Record<string,string>;
};

function evidenceVerificationKeyRing(){
  const raw=value(process.env.EVOLUTION_EVIDENCE_VERIFY_KEYS_JSON);
  if(!raw)return {} as Record<string,string>;
  try{
    const parsed=JSON.parse(raw) as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string,unknown>)
        .filter(([id,key])=>id.trim().length>0&&id.length<=120&&typeof key==="string"&&key.length>=32)
        .slice(0,32)
        .map(([id,key])=>[id,key as string]),
    );
  }catch{return {};}
}

export function getEvidenceLedgerSigningConfig():EvidenceLedgerSigningConfig|undefined{
  const key=value(process.env.EVOLUTION_EVIDENCE_SIGNING_KEY);
  if(!key||key.length<32)return undefined;
  const keyId=value(process.env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID)??"hmac-sha256-v1";
  return {
    key,
    keyId,
    verificationKeys:{...evidenceVerificationKeyRing(),[keyId]:key},
  };
}

export function getEvidenceLedgerSigningVaultId(){
  return value(process.env.EVOLUTION_EVIDENCE_SIGNING_VAULT_ID);
}

export function getEvidenceLedgerVerifyVaultIds(){
  const raw=value(process.env.EVOLUTION_EVIDENCE_VERIFY_VAULT_IDS_JSON);
  if(!raw)return {} as Record<string,string>;
  try{
    const parsed=JSON.parse(raw) as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string,unknown>)
        .filter(([keyId,vaultId])=>keyId.trim().length>0&&keyId.length<=120&&typeof vaultId==="string"&&vaultId.trim().length>0&&vaultId.length<=120)
        .slice(0,32)
        .map(([keyId,vaultId])=>[keyId,(vaultId as string).trim()]),
    );
  }catch{return {};}
}

export function getEvidenceLedgerSigningKeyId(){
  return value(process.env.EVOLUTION_EVIDENCE_SIGNING_KEY_ID)??"hmac-sha256-v1";
}

export function evidenceLedgerConfigured(){
  return serverSupabaseConfigured()
    &&Boolean(getEvolutionWorkspaceId())
    &&Boolean(getEvidenceLedgerSigningConfig()||getEvidenceLedgerSigningVaultId());
}

export type CapabilityEmbeddingConfig=
  | {mode:"vercel-gateway";model:string;dimensions:1536;timeoutMs:number}
  | {mode:"openai-compatible";apiKey:string;baseUrl:string;model:string;dimensions?:number;timeoutMs:number};

export function getCapabilityEmbeddingConfig():CapabilityEmbeddingConfig|undefined{
  const configuredModel=value(process.env.EVOLUTION_CAPABILITY_EMBEDDING_MODEL);
  if(serverAiOidcAvailable()&&serverAiGatewayEnabled()){
    return {
      mode:"vercel-gateway",
      model:configuredModel??"openai/text-embedding-3-small",
      dimensions:1536,
      timeoutMs:serverAiTimeoutMs(),
    };
  }
  const apiKey=value(
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_API_KEY,
    process.env.EVOLUTION_AI_API_KEY,
    process.env.OPENAI_API_KEY,
  );
  if(!apiKey||!configuredModel)return undefined;
  const baseUrl=(value(
    process.env.EVOLUTION_CAPABILITY_EMBEDDING_BASE_URL,
    process.env.EVOLUTION_AI_BASE_URL,
    process.env.OPENAI_BASE_URL,
  )??"https://api.openai.com/v1").replace(/\/+$/,"");
  const dimensionsRaw=value(process.env.EVOLUTION_CAPABILITY_EMBEDDING_DIMENSIONS);
  const dimensions=dimensionsRaw?Math.max(8,Math.min(Number(dimensionsRaw)||0,8192)):undefined;
  return {mode:"openai-compatible",apiKey,baseUrl,model:configuredModel,dimensions,timeoutMs:serverAiTimeoutMs()};
}

export function capabilityEmbeddingConfigured(){return Boolean(getCapabilityEmbeddingConfig());}
export type ServerAiConfig=
  | {mode:"vercel-gateway";model:string;timeoutMs:number}
  | {mode:"openai-compatible";apiKey:string;model:string;baseUrl:string;timeoutMs:number};

function serverAiTimeoutMs(){
  const timeoutRaw=value(process.env.EVOLUTION_AI_TIMEOUT_MS,process.env.OPENAI_TIMEOUT_MS);
  return Math.max(10_000,Math.min(Number(timeoutRaw||"90000")||90_000,300_000));
}

export function serverAiOidcAvailable(){
  return Boolean(
    value(process.env.VERCEL_OIDC_TOKEN)
    || value(process.env.VERCEL)
    || value(process.env.VERCEL_ENV),
  );
}

function serverAiGatewayEnabled(){
  return /^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_AI_GATEWAY_ENABLED)??"");
}

export function getServerAiConfig():ServerAiConfig|undefined{
  const timeoutMs=serverAiTimeoutMs();
  const oidcAvailable=serverAiOidcAvailable();
  if(oidcAvailable&&serverAiGatewayEnabled()){
    return {
      mode:"vercel-gateway",
      model:value(process.env.EVOLUTION_AI_GATEWAY_MODEL,process.env.EVOLUTION_AI_MODEL)??"openai/gpt-5.5",
      timeoutMs,
    };
  }

  const apiKey=value(process.env.EVOLUTION_AI_API_KEY,process.env.OPENAI_API_KEY);
  const model=value(process.env.EVOLUTION_AI_MODEL,process.env.OPENAI_MODEL);
  if(!apiKey||!model)return undefined;
  const rawBase=value(process.env.EVOLUTION_AI_BASE_URL,process.env.OPENAI_BASE_URL)??"https://api.openai.com/v1";
  const baseUrl=rawBase.replace(/\/+$/,"").replace(/\/(?:responses|chat\/completions)$/i,"");
  return {mode:"openai-compatible",apiKey,model,baseUrl,timeoutMs};
}

export type ServerVercelReleaseConfig={
  token?:string;
  projectId?:string;
  projectName?:string;
  productionUrl?:string;
  teamId?:string;
};

function localVercelLink(){
  if(process.env.VERCEL)return {};
  try{
    const file=path.join(process.cwd(),".vercel","project.json");
    const parsed=JSON.parse(fs.readFileSync(file,"utf8")) as {projectId?:string;orgId?:string;projectName?:string};
    return parsed;
  }catch{return {};}
}

function absoluteHttps(value: string|undefined){
  const trimmed=value?.trim();
  if(!trimmed)return undefined;
  return /^https?:\/\//i.test(trimmed)?trimmed:"https://"+trimmed;
}

export function getServerVercelReleaseConfig():ServerVercelReleaseConfig{
  const linked=localVercelLink();
  const projectName=value(process.env.EVOLUTION_VERCEL_PROJECT_NAME,process.env.VERCEL_PROJECT_NAME,linked.projectName);
  return {
    token:value(process.env.VERCEL_RELEASE_TOKEN,process.env.EVOLUTION_VERCEL_RELEASE_TOKEN),
    projectId:value(process.env.EVOLUTION_VERCEL_PROJECT_ID,process.env.VERCEL_PROJECT_ID,linked.projectId),
    projectName,
    productionUrl:absoluteHttps(value(
      process.env.EVOLUTION_VERCEL_PRODUCTION_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      projectName?projectName+".vercel.app":undefined,
    )),
    teamId:value(process.env.EVOLUTION_VERCEL_TEAM_ID,process.env.VERCEL_TEAM_ID,linked.orgId),
  };
}

export function vercelReleaseWriteConfigured(){
  const config=getServerVercelReleaseConfig();
  return Boolean(config.token&&config.projectId);
}

export type ServerGitHubConfig={
  token?:string;
  apiUrl:string;
  webhookSecret?:string;
  repoAllowlist:string[];
};

export function getServerGitHubConfig():ServerGitHubConfig{
  const allowlist=(value(process.env.EVOLUTION_GITHUB_REPO_ALLOWLIST)??"")
    .split(",").map((item)=>item.trim().toLowerCase()).filter(Boolean);
  return {
    token:value(process.env.EVOLUTION_GITHUB_TOKEN,process.env.GITHUB_TOKEN),
    apiUrl:(value(process.env.EVOLUTION_GITHUB_API_URL)??"https://api.github.com").replace(/\/+$/,""),
    webhookSecret:value(process.env.EVOLUTION_GITHUB_WEBHOOK_SECRET),
    repoAllowlist:allowlist,
  };
}

export function githubTargetConfigured(){
  const config=getServerGitHubConfig();
  return Boolean(config.token&&config.repoAllowlist.length);
}

export function githubWebhookConfigured(){
  return Boolean(getServerGitHubConfig().webhookSecret);
}

export type ServerTargetProxyConfig={
  runUrl?:string;
  releaseUrl?:string;
  observeUrl?:string;
  token?:string;
  timeoutMs:number;
};

export function getServerTargetProxyConfig():ServerTargetProxyConfig{
  return {
    runUrl:value(process.env.EVOLUTION_TARGET_RUN_URL,process.env.EVOLVE_TARGET_RUN_URL),
    releaseUrl:value(process.env.EVOLUTION_TARGET_RELEASE_URL,process.env.EVOLVE_TARGET_RELEASE_URL),
    observeUrl:value(process.env.EVOLUTION_TARGET_OBSERVE_URL,process.env.EVOLVE_TARGET_OBSERVE_URL),
    token:value(process.env.EVOLUTION_TARGET_BEARER_TOKEN,process.env.EVOLVE_TARGET_BEARER_TOKEN),
    timeoutMs:Math.max(5_000,Math.min(Number(value(process.env.EVOLUTION_TARGET_TIMEOUT_MS,process.env.EVOLVE_TARGET_TIMEOUT_MS)??"90000")||90_000,300_000)),
  };
}

export function targetProxyCapabilities(){
  const config=getServerTargetProxyConfig();
  return {
    codeReady:true,
    runConfigured:Boolean(config.runUrl),
    releaseConfigured:Boolean(config.releaseUrl),
    observeConfigured:Boolean(config.observeUrl),
    credentialConfigured:Boolean(config.token),
  };
}

export function serverAiConfigured(){return Boolean(getServerAiConfig());}
