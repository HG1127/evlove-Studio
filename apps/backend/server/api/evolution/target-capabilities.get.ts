import {defineEventHandler} from "nitro/h3";
import {getHttpTargetGatewayCapabilities} from "../../../src/services/http-target-gateway";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return getHttpTargetGatewayCapabilities();
});
