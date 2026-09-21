import {defineEventHandler} from "nitro/h3";
import {getConnectorRegistryCapabilities} from "../../../src/services/connector-registry";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  return await getConnectorRegistryCapabilities();
});
