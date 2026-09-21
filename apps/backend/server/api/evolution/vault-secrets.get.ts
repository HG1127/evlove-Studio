import {defineEventHandler} from "nitro/h3";
import {listVaultSecretMetadata} from "../../../src/services/server-vault";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"security.admin");
  return listVaultSecretMetadata();
});
