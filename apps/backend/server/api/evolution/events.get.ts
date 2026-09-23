import {defineEventHandler,getQuery} from "nitro/h3";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  requireServerDataPlaneAvailable();
  const query=getQuery(event);
  const missionId=String(query.missionId??"").trim()||undefined;
  const limit=Math.max(1,Math.min(Number(query.limit??200)||200,1000));
  return getServerProductionRuntime().events.list(missionId,limit);
});
