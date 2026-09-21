import {defineEventHandler} from "nitro/h3";
import {githubTargetCapabilities} from "../../../src/services/github-target";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return githubTargetCapabilities();
});
