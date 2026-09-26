import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {ReadIdentitySchema} from "@evolution/contracts";
import {getMissionEvidence,verifyMissionEvidence} from "../../../../src/services/evidence-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=ReadIdentitySchema.safeParse(getRouterParam(event,"missionId"));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid missionId"});
  const missionId=parsed.data;

  return {
    entries:await getMissionEvidence(missionId),
    verification:await verifyMissionEvidence(missionId),
  };
});
