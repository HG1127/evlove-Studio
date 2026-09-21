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
import {organizationMemberDirectoryHealth} from "./organization-member-directory";
import {releaseApprovalStoreHealth} from "./release-approval-store";
import {getSecurityCapabilities} from "./security-policy";
import {serverVaultHealth} from "./server-vault";
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
    getConnectorRegistryCapabilities(),
    serverVaultHealth(),
    releaseApprovalStoreHealth(),
    organizationMemberDirectoryHealth(),
  ] as const);
  const dataPlane=fulfilled(checks[0]);
  const sandbox=fulfilled(checks[1]);
  const browser=fulfilled(checks[2]);
  const release=fulfilled(checks[3]);
  const capability=fulfilled(checks[4]);
  const evidence=fulfilled(checks[5]);
  const outcome=fulfilled(checks[6]);
  const connectors=fulfilled(checks[7]);
  const vault=fulfilled(checks[8]);
  const approval=fulfilled(checks[9]);
  const members=fulfilled(checks[10]);
  const security=getSecurityCapabilities();
  const governanceProductionSafe=Boolean(
    security.productionSafe
    &&approval?.databaseReady
    &&members?.databaseReady
    &&members.activeAdmins>0
    &&(!vault?.configured||vault.databaseReady)
  );
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
      export:Boolean(evidence?.exportReady),
    },
    outcome:{
      database:Boolean(outcome?.databaseReady),
      ingestion:Boolean(outcome?.ingestionReady),
      analysis:Boolean(outcome?.analysisReady),
    },
    security:{
      configured:security.configured,
      enforced:security.enforced,
      productionSafe:governanceProductionSafe,
      vault:Boolean(vault?.configured&&vault.databaseReady),
      approvalStore:Boolean(approval?.configured&&approval.databaseReady),
      memberDirectory:Boolean(members?.databaseReady&&members.activeAdmins>0),
    },
    connectors:{
      configured:Boolean(connectors?.configured),
      fullLifecycle:Boolean(connectors?.fullLifecycleCount),
    },
    targetProxy:{run:targetProxy.runConfigured,release:targetProxy.releaseConfigured},
  });
}
