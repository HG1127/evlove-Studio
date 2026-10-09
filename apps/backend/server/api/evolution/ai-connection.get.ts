import {defineEventHandler} from "nitro/h3";
import {getServerAiConnectionStatus} from "../../../src/services/server-ai-connection";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return getServerAiConnectionStatus();
});
