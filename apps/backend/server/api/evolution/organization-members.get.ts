import {defineEventHandler} from "nitro/h3";
import {listOrganizationMembersForAdmin} from "../../../src/services/organization-member-directory";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=requireEvolutionPermission(event,"security.admin");
  return listOrganizationMembersForAdmin(actor);
});
