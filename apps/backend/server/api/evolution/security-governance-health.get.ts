import {defineEventHandler} from "nitro/h3";
import {SecurityGovernanceHealthSchema} from "@evolution/contracts";
import {getEvolutionWorkspaceId,serverSupabaseSecureConfigured} from "../../../src/server-env";
import {releaseApprovalStoreHealth} from "../../../src/services/release-approval-store";
import {organizationMemberDirectoryHealth} from "../../../src/services/organization-member-directory";
import {getSecurityCapabilities,requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {serverVaultHealth} from "../../../src/services/server-vault";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const [vault,approval,members]=await Promise.all([
    serverVaultHealth(),
    releaseApprovalStoreHealth(),
    organizationMemberDirectoryHealth(),
  ]);
  const security=getSecurityCapabilities();
  const productionSafe=security.productionSafe
    &&approval.databaseReady
    &&members.databaseReady
    &&members.activeAdmins>0
    &&(!vault.configured||vault.databaseReady);
  const vaultLabel=vault.databaseReady?"READY":vault.configured?"DB-MISSING":"NOT-CONFIGURED";
  const approvalLabel=approval.databaseReady?"READY":"MISSING";
  const memberLabel=members.databaseReady
    ?members.activeAdmins>0?"READY":"NO-ACTIVE-ADMIN"
    :"MISSING";
  return SecurityGovernanceHealthSchema.parse({
    codeReady:true,
    identityConfigured:security.configured,
    identityEnforced:security.enforced,
    secureDataPlane:serverSupabaseSecureConfigured(),
    vaultConfigured:vault.configured,
    vaultDatabaseReady:vault.databaseReady,
    approvalStoreReady:approval.databaseReady,
    memberDirectoryReady:Boolean(members.databaseReady&&members.activeAdmins>0),
    productionSafe,
    workspaceId:getEvolutionWorkspaceId(),
    checkedAt:new Date().toISOString(),
    message:productionSafe
      ?"Trusted RBAC + active member directory + durable approvals + configured Vault are healthy."
      :"Governance partial: Members "+memberLabel+" · Vault "+vaultLabel+" · Approval Store "+approvalLabel+".",
  });
});
