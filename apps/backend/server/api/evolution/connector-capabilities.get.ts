import {defineEventHandler} from "nitro/h3";
import {getConnectorRegistryCapabilities} from "../../../src/services/connector-registry";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return await getConnectorRegistryCapabilities();
});
