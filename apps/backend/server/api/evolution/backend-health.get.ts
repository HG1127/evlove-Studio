import {defineEventHandler} from "nitro/h3";
import {checkSupabaseBackendHealth} from "@evolution/adapters";
import {EvolutionBackendHealthSchema} from "@evolution/contracts";
import {
  getServerSupabaseConfig,
  githubTargetConfigured,
  githubWebhookConfigured,
  serverAiConfigured,
  serverSupabaseConfigured,
  serverSupabaseCredentialMode,
  serverSupabaseSecureConfigured,
  targetProxyCapabilities,
  vercelReleaseWriteConfigured,
} from "../../../src/server-env";
import {getSecurityCapabilities} from "../../../src/services/security-policy";
import {requireEvolutionPermission} from "../../../src/services/security-policy";
import {releaseApprovalStoreHealth} from "../../../src/services/release-approval-store";
import {serverVaultHealth} from "../../../src/services/server-vault";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  const configured=serverSupabaseConfigured();
  let dataPlane={
    configured,
    secureCredential:serverSupabaseSecureConfigured(),
    credentialMode:serverSupabaseCredentialMode(),
    database:false,
    storage:false,
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
        tables:{missions:false,jobs:false,events:false,artifacts:false},
        message:`Server Data Plane 健康检查失败：${error instanceof Error?error.message:String(error)}`,
      };
    }
  }
  const [vault,approval]=await Promise.all([serverVaultHealth(),releaseApprovalStoreHealth()]);
  const security=getSecurityCapabilities();
  const governanceProductionSafe=security.productionSafe
    &&approval.databaseReady
    &&(!vault.configured||vault.databaseReady);
  return EvolutionBackendHealthSchema.parse({
    checkedAt:new Date().toISOString(),
    dataPlane,
    httpDataPlane:{codeReady:true},
    sourceParse:{codeReady:true,configured,durable:true},
    artifactRenderer:{codeReady:true,configured:Boolean(configured&&dataPlane.storage)},
    serverAi:{codeReady:true,configured:serverAiConfigured()},
    sandbox:{codeReady:true},
    browser:{codeReady:true},
    release:{codeReady:true,writeConfigured:vercelReleaseWriteConfigured()},
    git:{codeReady:true,configured:githubTargetConfigured(),webhookConfigured:githubWebhookConfigured()},
    targetProxy:targetProxyCapabilities(),
    security,
    securityGovernance:{
      codeReady:true,
      identityConfigured:security.configured,
      identityEnforced:security.enforced,
      secureDataPlane:serverSupabaseSecureConfigured(),
      vaultConfigured:vault.configured,
      vaultDatabaseReady:vault.databaseReady,
      approvalStoreReady:approval.databaseReady,
      productionSafe:governanceProductionSafe,
      workspaceId:security.workspaceId,
      checkedAt:new Date().toISOString(),
      message:governanceProductionSafe?"Governance healthy.":"Governance requires Vault/data-plane/approval configuration.",
    },
  });
});
