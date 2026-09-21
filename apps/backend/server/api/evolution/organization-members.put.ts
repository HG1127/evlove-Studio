import {defineEventHandler,readBody} from "nitro/h3";
import {OrganizationMemberPutRequestSchema} from "@evolution/contracts";
import {upsertOrganizationMember} from "../../../src/services/organization-member-directory";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=requireEvolutionPermission(event,"security.admin");
  const input=OrganizationMemberPutRequestSchema.parse(await readBody(event));
  return upsertOrganizationMember(input,actor);
});
