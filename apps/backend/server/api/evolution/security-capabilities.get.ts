import {defineEventHandler} from "nitro/h3";
import {getSecurityCapabilities,requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler((event)=>{
  requireEvolutionPermission(event,"data.read");
  return getSecurityCapabilities();
});
