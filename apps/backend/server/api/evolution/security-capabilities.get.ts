import {defineEventHandler} from "nitro/h3";
import {getSecurityCapabilities,requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return getSecurityCapabilities();
});
