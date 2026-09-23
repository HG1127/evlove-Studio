import {defineEventHandler,getQuery} from "nitro/h3";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  requireServerDataPlaneAvailable();
  const missionId=String(getQuery(event).missionId??"").trim()||undefined;
  return getServerProductionRuntime().jobs.list(missionId);
});
