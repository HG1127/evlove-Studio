import {defineEventHandler} from "nitro/h3";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {probeServerAiRuntime} from "../../../src/services/server-ai-health";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"ai.execute");
  return probeServerAiRuntime();
});
