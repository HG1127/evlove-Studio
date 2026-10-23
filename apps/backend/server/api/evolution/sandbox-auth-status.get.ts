import {defineEventHandler,setHeader} from "nitro/h3";
import {getVercelSandboxAuthorizationDiagnostic} from "@evolution/adapters/sandbox";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

/**
 * Passive, non-metered operator diagnostic: no cloud API, no bearer token,
 * no VM and no Browser is created by this GET.
 */
export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  setHeader(event,"Cache-Control","private, no-store");
  return getVercelSandboxAuthorizationDiagnostic();
});
