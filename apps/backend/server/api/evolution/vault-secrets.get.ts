import {defineEventHandler} from "nitro/h3";
import {listVaultSecretMetadata} from "../../../src/services/server-vault";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"security.admin");
  return listVaultSecretMetadata();
});
