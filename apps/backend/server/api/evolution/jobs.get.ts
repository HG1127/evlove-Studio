import {defineEventHandler,getQuery} from "nitro/h3";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  const missionId=String(getQuery(event).missionId??"").trim()||undefined;
  return getServerProductionRuntime().jobs.list(missionId);
});
