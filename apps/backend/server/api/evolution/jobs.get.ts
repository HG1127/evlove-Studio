import {defineEventHandler,getQuery} from "nitro/h3";
import {getServerProductionRuntime,listServerJobPage} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";
import {collectionPageQuery} from "../../../src/services/collection-pagination";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  requireServerDataPlaneAvailable();
  const query=getQuery(event);
  const missionId=String(query.missionId??"").trim()||undefined;
  const page=collectionPageQuery(query);
  if(page)return listServerJobPage(missionId,page.cursor,page.pageLimit);
  return getServerProductionRuntime().jobs.list(missionId);
});
