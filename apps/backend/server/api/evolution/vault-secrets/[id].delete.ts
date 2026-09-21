import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {deleteVaultSecret} from "../../../../src/services/server-vault";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"security.admin");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"Vault secret id is required"});
  return deleteVaultSecret(id);
});
