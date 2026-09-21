import {defineEventHandler} from "nitro/h3";
import {SecurityGovernanceHealthSchema} from "@evolution/contracts";
import {getEvolutionWorkspaceId,serverSupabaseSecureConfigured} from "../../../src/server-env";
import {releaseApprovalStoreHealth} from "../../../src/services/release-approval-store";
import {getSecurityCapabilities,requireEvolutionPermission} from "../../../src/services/security-policy";
import {serverVaultHealth} from "../../../src/services/server-vault";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  const [vault,approval]=await Promise.all([
    serverVaultHealth(),
    releaseApprovalStoreHealth(),
  ]);
  const security=getSecurityCapabilities();
  const productionSafe=security.productionSafe
    &&approval.databaseReady
    &&(!vault.configured||vault.databaseReady);
  const vaultLabel=vault.databaseReady?"READY":vault.configured?"DB-MISSING":"NOT-CONFIGURED";
  const approvalLabel=approval.databaseReady?"READY":"MISSING";
  return SecurityGovernanceHealthSchema.parse({
    codeReady:true,
    identityConfigured:security.configured,
    identityEnforced:security.enforced,
    secureDataPlane:serverSupabaseSecureConfigured(),
    vaultConfigured:vault.configured,
    vaultDatabaseReady:vault.databaseReady,
    approvalStoreReady:approval.databaseReady,
    productionSafe,
    workspaceId:getEvolutionWorkspaceId(),
    checkedAt:new Date().toISOString(),
    message:productionSafe
      ?"Trusted RBAC + durable approvals + configured Vault are healthy."
      :"Governance partial: Vault "+vaultLabel+" · Approval Store "+approvalLabel+".",
  });
});
