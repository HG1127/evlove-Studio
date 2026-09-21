import { defineEventHandler } from "nitro/h3";
import { getVercelReleaseCapabilities } from "../../../src/services/vercel-release";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  return getVercelReleaseCapabilities();
});
