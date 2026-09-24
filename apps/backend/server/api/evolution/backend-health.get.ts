import {defineEventHandler} from "nitro/h3";
import {checkSupabaseBackendHealth} from "@evolution/adapters";
import {EvolutionBackendHealthSchema} from "@evolution/contracts";
import {
  getServerSupabaseConfig,
  githubTargetConfigured,
  githubWebhookConfigured,
  serverSupabaseConfigured,
  serverSupabaseCredentialMode,
  serverSupabaseSecureConfigured,
  targetProxyCapabilities,
  vercelReleaseWriteConfigured,
} from "../../../src/server-env";
import {getSecurityCapabilities} from "../../../src/services/security-policy";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {releaseApprovalStoreHealth} from "../../../src/services/release-approval-store";
import {organizationMemberDirectoryHealth} from "../../../src/services/organization-member-directory";
import {serverVaultHealth} from "../../../src/services/server-vault";
import {getConnectorRegistryCapabilities} from "../../../src/services/connector-registry";
import {getPassiveServerAiHealth} from "../../../src/services/server-ai-health";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const configured=serverSupabaseConfigured();
  let dataPlane={
    configured,
    secureCredential:serverSupabaseSecureConfigured(),
    credentialMode:serverSupabaseCredentialMode(),
    database:false,
    storage:false,
    artifactCleanup:false,
    tables:{missions:false,jobs:false,events:false,artifacts:false},
    message:"Server Supabase Data Plane 未配置",
  };
  if(configured){
    try{
      const health=await checkSupabaseBackendHealth(getServerSupabaseConfig());
      dataPlane={
        configured:true,
        secureCredential:serverSupabaseSecureConfigured(),
        credentialMode:serverSupabaseCredentialMode(),
        database:health.database,
        storage:health.storage,
        artifactCleanup:health.artifactCleanup,
        tables:health.tables,
        message:health.message,
      };
    }catch(error){
      dataPlane={
        configured:true,
        secureCredential:serverSupabaseSecureConfigured(),
        credentialMode:serverSupabaseCredentialMode(),
        database:false,
        storage:false,
        artifactCleanup:false,
        tables:{missions:false,jobs:false,events:false,artifacts:false},
        message:`Server Data Plane 健康检查失败：${error instanceof Error?error.message:String(error)}`,
      };
    }
  }
  const [vault,approval,members]=await Promise.all([
    serverVaultHealth(),
    releaseApprovalStoreHealth(),
    organizationMemberDirectoryHealth(),
  ]);
  const security=getSecurityCapabilities();
  const governanceProductionSafe=security.productionSafe
    &&approval.databaseReady
    &&members.databaseReady
    &&members.activeAdmins>0
    &&(!vault.configured||vault.databaseReady);
  const targetProxy=targetProxyCapabilities();
  const connectorRegistry=await getConnectorRegistryCapabilities().catch(()=>undefined);
  const connectorRelease=Boolean(connectorRegistry?.connectors.some((connector)=>connector.credentialConfigured&&Object.values(connector.lifecycle).every(Boolean)));
  const serverAiHealth=getPassiveServerAiHealth();
  return EvolutionBackendHealthSchema.parse({
    checkedAt:new Date().toISOString(),
    dataPlane,
    httpDataPlane:{codeReady:true},
    sourceParse:{codeReady:true,configured,durable:true},
    artifactRenderer:{codeReady:true,configured:Boolean(configured&&dataPlane.storage)},
    serverAi:{
      codeReady:true,
      configured:serverAiHealth.configured,
      mode:serverAiHealth.mode,
      model:serverAiHealth.model,
      runtimeVerified:false,
      runtimeStatus:serverAiHealth.status,
      message:serverAiHealth.message,
    },
    sandbox:{codeReady:true},
    browser:{codeReady:true},
    release:{codeReady:true,writeConfigured:vercelReleaseWriteConfigured()||targetProxy.releaseConfigured||connectorRelease},
    git:{codeReady:true,configured:githubTargetConfigured(),webhookConfigured:githubWebhookConfigured()},
    targetProxy,
    security,
    securityGovernance:{
      codeReady:true,
      identityConfigured:security.configured,
      identityEnforced:security.enforced,
      secureDataPlane:serverSupabaseSecureConfigured(),
      vaultConfigured:vault.configured,
      vaultDatabaseReady:vault.databaseReady,
      approvalStoreReady:approval.databaseReady,
      memberDirectoryReady:Boolean(members.databaseReady&&members.activeAdmins>0),
      productionSafe:governanceProductionSafe,
      workspaceId:security.workspaceId,
      checkedAt:new Date().toISOString(),
      message:governanceProductionSafe?"Governance healthy.":"Governance requires active member directory + Vault/data-plane/approval configuration.",
    },
  });
});
