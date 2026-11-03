import {defineEventHandler,getQuery} from "nitro/h3";
import {missionJsonResponse} from "../../../src/services/mission-json-response";
import {listServerMissionEnvelopePage,listServerMissionEnvelopes} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";
import {collectionPageQuery} from "../../../src/services/collection-pagination";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  requireServerDataPlaneAvailable();
  const page=collectionPageQuery(getQuery(event));
  const value=page?await listServerMissionEnvelopePage(page.cursor,page.pageLimit):await listServerMissionEnvelopes();
  return missionJsonResponse(value);
});
