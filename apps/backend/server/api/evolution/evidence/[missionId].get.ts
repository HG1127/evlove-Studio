import {defineEventHandler,getRouterParam} from "nitro/h3";
import {getMissionEvidence,verifyMissionEvidence} from "../../../../src/services/evidence-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const missionId=getRouterParam(event,"missionId");
  if(!missionId)return {error:"missionId required"};

  return {
    entries:await getMissionEvidence(missionId),
    verification:await verifyMissionEvidence(missionId),
  };
});
