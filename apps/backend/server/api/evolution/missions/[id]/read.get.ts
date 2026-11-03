import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerMissionEnvelope} from "../../../../../src/services/production-runtime";
import {missionReadStream} from "../../../../../src/services/mission-read-stream";
import {requireGovernedEvolutionPermission} from "../../../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../../../src/services/data-plane-guard";
export default defineEventHandler(async event=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  requireServerDataPlaneAvailable();
  const id=getRouterParam(event,"id");if(!id)throw createError({statusCode:400,statusMessage:"缺少 Mission id"});
  return missionReadStream(signal=>getServerMissionEnvelope(id,signal));
});
