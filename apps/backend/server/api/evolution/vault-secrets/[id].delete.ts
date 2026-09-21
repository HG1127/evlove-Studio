import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {deleteVaultSecret} from "../../../../src/services/server-vault";
import {requireEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"security.admin");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"Vault secret id is required"});
  return deleteVaultSecret(id);
});
