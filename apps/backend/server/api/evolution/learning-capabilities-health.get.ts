import {defineEventHandler} from "nitro/h3";
import {getOrganizationCapabilityHealth} from "../../../src/services/organization-capability";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler((event)=>{
  requireEvolutionPermission(event,"data.read");
  return getOrganizationCapabilityHealth();
});
