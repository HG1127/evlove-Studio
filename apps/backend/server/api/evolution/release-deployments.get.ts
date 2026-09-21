import { defineEventHandler } from "nitro/h3";
import { listVercelReleaseDeployments } from "../../../src/services/vercel-release";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return listVercelReleaseDeployments();
});
