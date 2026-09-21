import { defineEventHandler } from "nitro/h3";
import { checkVercelSandboxHealth } from "@evolution/adapters/sandbox";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return checkVercelSandboxHealth();
});
