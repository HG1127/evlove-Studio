import {defineEventHandler,getQuery} from "nitro/h3";
import {OrganizationCapabilitySearchRequestSchema} from "@evolution/contracts";
import {searchOrganizationCapabilities} from "../../../src/services/organization-capability";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"data.read");
  const raw=getQuery(event);
  const statuses=typeof raw.statuses==="string"?raw.statuses.split(",").filter(Boolean):undefined;
  const input=OrganizationCapabilitySearchRequestSchema.parse({
    q:typeof raw.q==="string"?raw.q:"",
    limit:raw.limit,
    reusableOnly:raw.reusableOnly,
    statuses,
  });
  return searchOrganizationCapabilities(input,actor);
});
