import {defineEventHandler,getQuery} from "nitro/h3";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const query=getQuery(event);
  const missionId=String(query.missionId??"").trim()||undefined;
  const limit=Math.max(1,Math.min(Number(query.limit??200)||200,1000));
  return getServerProductionRuntime().events.list(missionId,limit);
});
