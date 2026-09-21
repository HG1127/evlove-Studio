import {checkSupabaseBackendHealth} from "@evolution/adapters";
import {checkVercelSandboxBrowserHealth,checkVercelSandboxHealth} from "@evolution/adapters/sandbox";
import {PublicReadinessSnapshotSchema} from "@evolution/contracts";
import {
  getServerSupabaseConfig,
  githubTargetConfigured,
  githubWebhookConfigured,
  serverAiConfigured,
  serverSupabaseConfigured,
  serverSupabaseConfigDiagnostics,
  serverSupabaseSecureConfigured,
  targetProxyCapabilities,
} from "../server-env";
import {getConnectorRegistryCapabilities} from "./connector-registry";
import {getEvidenceLedgerHealth} from "./evidence-ledger";
import {getOrganizationCapabilityHealth} from "./organization-capability";
import {getOutcomeAnalyticsHealth} from "./outcome-analytics";
import {getSecurityCapabilities} from "./security-policy";
import {getVercelReleaseCapabilities} from "./vercel-release";

function fulfilled<T>(result:PromiseSettledResult<T>):T|undefined{
  return result.status==="fulfilled"?result.value:undefined;
}

export async function getPublicReadinessSnapshot(){
  const configured=serverSupabaseConfigured();
  const dataPlaneConfig=serverSupabaseConfigDiagnostics();
  const checks=await Promise.allSettled([
    configured?checkSupabaseBackendHealth(getServerSupabaseConfig()):Promise.resolve(undefined),
    checkVercelSandboxHealth(),
    checkVercelSandboxBrowserHealth(),
    getVercelReleaseCapabilities(),
    getOrganizationCapabilityHealth(),
    getEvidenceLedgerHealth(),
    getOutcomeAnalyticsHealth(),
  ] as const);
  const dataPlane=fulfilled(checks[0]);
  const sandbox=fulfilled(checks[1]);
  const browser=fulfilled(checks[2]);
  const release=fulfilled(checks[3]);
  const capability=fulfilled(checks[4]);
  const evidence=fulfilled(checks[5]);
  const outcome=fulfilled(checks[6]);
  const security=getSecurityCapabilities();
  const connectors=getConnectorRegistryCapabilities();
  const targetProxy=targetProxyCapabilities();
  return PublicReadinessSnapshotSchema.parse({
    checkedAt:new Date().toISOString(),
    workflow:{durable:true},
    dataPlane:{
      configured,
      secureCredential:serverSupabaseSecureConfigured(),
      database:Boolean(dataPlane?.database),
      storage:Boolean(dataPlane?.storage),
      coreTables:Boolean(dataPlane&&Object.values(dataPlane.tables).every(Boolean)),
      ...dataPlaneConfig,
    },
    sourceParse:Boolean(configured&&dataPlane?.database&&dataPlane?.storage),
    artifactRenderer:Boolean(configured&&dataPlane?.storage),
    serverAi:serverAiConfigured(),
    sandbox:Boolean(sandbox?.ready),
    browser:Boolean(browser?.ready),
    release:{read:Boolean(release?.readEnabled),write:Boolean(release?.writeEnabled)},
    git:{configured:githubTargetConfigured(),webhook:githubWebhookConfigured()},
    capability:{
      database:Boolean(capability?.databaseReady),
      semantic:Boolean(capability?.vectorSearch),
      sharing:Boolean(capability?.sharingRbacReady),
    },
    evidence:{
      database:Boolean(evidence?.databaseReady),
      signing:Boolean(evidence?.signingConfigured),
      immutable:Boolean(evidence?.appendFunctionReady&&evidence?.immutableTriggerReady),
    },
    outcome:{
      database:Boolean(outcome?.databaseReady),
      ingestion:Boolean(outcome?.ingestionReady),
      analysis:Boolean(outcome?.analysisReady),
    },
    security:{
      configured:security.configured,
      enforced:security.enforced,
      productionSafe:security.productionSafe,
    },
    connectors:{
      configured:connectors.configured,
      fullLifecycle:connectors.fullLifecycleCount>0,
    },
    targetProxy:{run:targetProxy.runConfigured,release:targetProxy.releaseConfigured},
  });
}
