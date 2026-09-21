import {defineEventHandler,getQuery} from "nitro/h3";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  const query=getQuery(event);
  const missionId=String(query.missionId??"").trim()||undefined;
  const limit=Math.max(1,Math.min(Number(query.limit??200)||200,1000));
  return getServerProductionRuntime().events.list(missionId,limit);
});
