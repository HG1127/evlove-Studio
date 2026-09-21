import {defineEventHandler} from "nitro/h3";
import {SourceParseCapabilitiesSchema} from "@evolution/contracts";
import {SERVER_SOURCE_PARSE_EXTENSIONS} from "../../../src/services/server-source-parser";
import {serverSupabaseConfigured} from "../../../src/server-env";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const dataPlane=serverSupabaseConfigured();
  return SourceParseCapabilitiesSchema.parse({
    available:dataPlane,
    durable:true,
    artifactStore:dataPlane,
    serverNative:true,
    supportedExtensions:SERVER_SOURCE_PARSE_EXTENSIONS,
    reason:dataPlane?undefined:"server-data-plane-not-configured",
  });
});
