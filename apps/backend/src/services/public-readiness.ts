import {getVercelSandboxPolicyCapabilities} from "@evolution/adapters/sandbox";
import {PublicReadinessSnapshotSchema} from "@evolution/contracts";
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
} from "../server-env";
import {getServerConnectorManifests} from "./connector-registry";
import {getSecurityCapabilities} from "./security-policy";

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

  return PublicReadinessSnapshotSchema.parse({
    probeMode:"passive-config",
    checkedAt:new Date().toISOString(),
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
