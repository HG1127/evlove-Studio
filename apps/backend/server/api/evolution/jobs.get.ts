import {defineEventHandler,getQuery} from "nitro/h3";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const missionId=String(getQuery(event).missionId??"").trim()||undefined;
  return getServerProductionRuntime().jobs.list(missionId);
});
