import { defineEventHandler,setHeader } from "nitro/h3";
import { checkVercelSandboxHealth } from "@evolution/adapters/sandbox";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  // This GET starts a real, metered Sandbox; a reader-only permission is insufficient.
  await requireGovernedEvolutionPermission(event,"target.execute");
  // Re-check after operators renew Vercel credentials; never cache a stale READY/UNAVAILABLE.
  setHeader(event,"Cache-Control","private, no-store");
  return checkVercelSandboxHealth();
});
