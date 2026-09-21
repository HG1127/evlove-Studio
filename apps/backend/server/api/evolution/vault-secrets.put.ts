import {defineEventHandler,readBody} from "nitro/h3";
import {VaultSecretPutRequestSchema} from "@evolution/contracts";
import {putVaultSecret} from "../../../src/services/server-vault";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=requireEvolutionPermission(event,"security.admin");
  const input=VaultSecretPutRequestSchema.parse(await readBody(event));
  return putVaultSecret(input,actor);
});
