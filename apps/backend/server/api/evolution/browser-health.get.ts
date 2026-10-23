import { defineEventHandler,setHeader } from "nitro/h3";
import { checkVercelSandboxBrowserHealth } from "@evolution/adapters/sandbox";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  // This GET provisions a Sandbox/Chromium runtime; require execution privilege.
  await requireGovernedEvolutionPermission(event,"target.execute");
  setHeader(event,"Cache-Control","private, no-store");
  return checkVercelSandboxBrowserHealth();
});
