import {createError,defineEventHandler,readBody} from "nitro/h3";
import {OrganizationCapabilitySyncRequestSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {syncMissionCapabilities} from "../../../src/services/organization-capability";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"capability.write");
  const {missionId}=OrganizationCapabilitySyncRequestSchema.parse(await readBody(event));
  const mission=await getServerProductionRuntime().missions.get(missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  return syncMissionCapabilities(mission);
});
