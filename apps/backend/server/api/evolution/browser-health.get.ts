import { defineEventHandler } from "nitro/h3";
import { checkVercelSandboxBrowserHealth } from "@evolution/adapters/sandbox";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  return checkVercelSandboxBrowserHealth();
});
