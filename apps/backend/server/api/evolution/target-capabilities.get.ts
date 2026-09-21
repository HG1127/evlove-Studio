import {defineEventHandler} from "nitro/h3";
import {getHttpTargetGatewayCapabilities} from "../../../src/services/http-target-gateway";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler((event)=>{
  requireEvolutionPermission(event,"data.read");
  return getHttpTargetGatewayCapabilities();
});
