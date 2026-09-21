import {defineEventHandler} from "nitro/h3";
import {githubTargetCapabilities} from "../../../src/services/github-target";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler((event)=>{
  requireEvolutionPermission(event,"data.read");
  return githubTargetCapabilities();
});
