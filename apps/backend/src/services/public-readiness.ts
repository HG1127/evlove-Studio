import {getVercelSandboxPolicyCapabilities} from "@evolution/adapters/sandbox";
import {PublicReadinessSnapshotSchema,type PublicReadinessBlocker} from "@evolution/contracts";
import {
  getEvidenceLedgerSigningConfig,
  getEvidenceLedgerSigningVaultId,
  githubTargetConfigured,
  githubWebhookConfigured,
  serverAiConfigured,
  serverSupabaseConfigured,
  serverSupabaseConfigDiagnostics,
  serverSupabaseSecureConfigured,
  targetProxyCapabilities,
  vaultEncryptionConfigured,
  vercelReleaseWriteConfigured,
} from "../server-env";
import {getServerConnectorManifests} from "./connector-registry";
import {getSecurityCapabilities} from "./security-policy";

function readinessBlockers(input:{
  dataPlane:ReturnType<typeof serverSupabaseConfigDiagnostics>;
  security:ReturnType<typeof getSecurityCapabilities>;
  serverAi:boolean;
  releaseConfigured:boolean;
  gitConfigured:boolean;
  gitWebhook:boolean;
  connectorConfigured:boolean;
  targetProxy:ReturnType<typeof targetProxyCapabilities>;
}):PublicReadinessBlocker[]{
  const blockers:PublicReadinessBlocker[]=[];
  const add=(item:Omit<PublicReadinessBlocker,"configurationOnly">)=>blockers.push({...item,configurationOnly:true});

  if(!input.dataPlane.urlPresent){
    add({
      code:"SUPABASE_URL_MISSING",severity:"error",area:"data-plane",
      message:"生产数据面缺少 Supabase URL。",
      action:"在 Vercel Production 配置 SUPABASE_URL，并重新部署。",
    });
  }
  if(!input.dataPlane.secretPresent){
    add({
      code:"SUPABASE_SERVER_SECRET_MISSING",severity:"error",area:"data-plane",
      message:"Vercel Server Runtime 未检测到 Supabase server-only credential。",
      action:"重新确认/覆盖 SUPABASE_SECRET_KEY 或 SUPABASE_SERVICE_ROLE_KEY 的 Production 值，然后重新部署；不要放到 VITE_*。",
    });
  }
  if(!input.security.workspaceId){
    add({
      code:"WORKSPACE_ID_MISSING",severity:"error",area:"security",
      message:"缺少 EVOLUTION_WORKSPACE_ID，无法形成稳定的组织级数据与权限边界。",
      action:"配置 EVOLUTION_WORKSPACE_ID，并保持所有服务使用同一 workspace 标识。",
    });
  }
  if(!input.security.configured){
    add({
      code:"IDENTITY_NOT_CONFIGURED",severity:"error",area:"security",
      message:"Server Identity/RBAC 尚未配置。",
      action:"正式环境配置 32+ 字符 EVOLUTION_IDENTITY_HMAC_SECRET；内部 Demo 可显式启用受 Vercel Protection 限制的临时身份桥。",
    });
  }else if(input.security.protectedDeploymentInternal){
    add({
      code:"TEMPORARY_PROTECTED_DEPLOYMENT_AUTH",severity:"warning",area:"security",
      message:"当前使用临时 Vercel Protected Deployment operator 身份，仅适合内部功能验证。",
      action:"正式上线前替换为用户身份/Passport → server-signed actor，并关闭 EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH。",
    });
  }
  if(!input.serverAi){
    add({
      code:"SERVER_AI_NOT_CONFIGURED",severity:"error",area:"ai",
      message:"Server AI 未配置，Durable Agent 无法执行 AI 动作。",
      action:"启用 Vercel AI Gateway/OIDC，或配置 EVOLUTION_AI_API_KEY + EVOLUTION_AI_MODEL。",
    });
  }
  if(!input.releaseConfigured&&!input.targetProxy.releaseConfigured){
    add({
      code:"RELEASE_PROVIDER_NOT_CONFIGURED",severity:"warning",area:"release",
      message:"尚未配置真实 Production Release Provider。",
      action:"配置 VERCEL_RELEASE_TOKEN，或配置 HTTP Target Release/Observe，或接入 Full-Lifecycle Connector。",
    });
  }
  if(!input.gitConfigured){
    add({
      code:"GIT_TARGET_NOT_CONFIGURED",severity:"info",area:"git",
      message:"Git-native Target 尚未配置。",
      action:"需要代码工程真实变更时，配置 EVOLUTION_GITHUB_TOKEN + EVOLUTION_GITHUB_REPO_ALLOWLIST。",
    });
  }else if(!input.gitWebhook){
    add({
      code:"GIT_WEBHOOK_NOT_CONFIGURED",severity:"info",area:"git",
      message:"Git Target 已配置，但 Webhook 尚未接通。",
      action:"配置 EVOLUTION_GITHUB_WEBHOOK_SECRET，并把仓库 Webhook 指向 /api/evolution/git-webhook。",
    });
  }
  if(!input.connectorConfigured){
    add({
      code:"CONNECTOR_REGISTRY_EMPTY",severity:"info",area:"connectors",
      message:"External Connector Registry 尚未配置具体业务系统。",
      action:"按需配置 EVOLUTION_CONNECTORS_JSON；这不是文件/代码/Sandbox 主链的阻塞项。",
    });
  }
  if(!input.targetProxy.runConfigured&&!input.targetProxy.releaseConfigured&&!input.targetProxy.observeConfigured){
    add({
      code:"TARGET_PROXY_NOT_CONFIGURED",severity:"info",area:"target",
      message:"HTTP Target Proxy 尚未配置。",
      action:"仅在需要连接外部 Runner/业务系统时配置 EVOLUTION_TARGET_RUN_URL / RELEASE_URL / OBSERVE_URL。",
    });
  }
  return blockers;
}

/**
 * Public readiness is intentionally passive.
 * It must never create a Sandbox, start a Browser, call Vercel provider APIs,
 * query Supabase, resolve Vault secrets, or trigger any other metered/external I/O.
 * Authenticated health endpoints own active verification.
 */
export async function getPublicReadinessSnapshot(){
  const configured=serverSupabaseConfigured();
  const dataPlaneConfig=serverSupabaseConfigDiagnostics();
  const security=getSecurityCapabilities();
  const targetProxy=targetProxyCapabilities();
  let connectorConfigured=false;
  try{connectorConfigured=getServerConnectorManifests().length>0;}catch{/* invalid manifests are surfaced by authenticated capability checks */}

  const blockers=readinessBlockers({
    dataPlane:dataPlaneConfig,
    security,
    serverAi:serverAiConfigured(),
    releaseConfigured:vercelReleaseWriteConfigured(),
    gitConfigured:githubTargetConfigured(),
    gitWebhook:githubWebhookConfigured(),
    connectorConfigured,
    targetProxy,
  });

  return PublicReadinessSnapshotSchema.parse({
    probeMode:"passive-config",
    checkedAt:new Date().toISOString(),
    blockers,
    workflow:{durable:false},
    dataPlane:{
      configured,
      secureCredential:serverSupabaseSecureConfigured(),
      database:false,
      storage:false,
      coreTables:false,
      ...dataPlaneConfig,
    },
    sourceParse:false,
    artifactRenderer:false,
    serverAi:serverAiConfigured(),
    sandbox:false,
    sandboxPolicy:getVercelSandboxPolicyCapabilities().codeReady,
    browser:false,
    release:{read:false,write:false},
    git:{configured:githubTargetConfigured(),webhook:githubWebhookConfigured()},
    capability:{database:false,semantic:false,sharing:false},
    evidence:{
      database:false,
      signing:Boolean(getEvidenceLedgerSigningConfig()||(getEvidenceLedgerSigningVaultId()&&vaultEncryptionConfigured())),
      immutable:false,
      export:false,
    },
    outcome:{database:false,ingestion:false,analysis:false,telemetry:false},
    security:{
      configured:security.configured,
      enforced:security.enforced,
      productionSafe:false,
      vault:false,
      approvalStore:false,
      memberDirectory:false,
    },
    connectors:{configured:connectorConfigured,fullLifecycle:false},
    targetProxy:{run:targetProxy.runConfigured,release:targetProxy.releaseConfigured,observe:targetProxy.observeConfigured},
  });
}
