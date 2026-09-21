import {defineEventHandler} from "nitro/h3";
import {missionEnvelope} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const projects=await getServerProductionRuntime().missions.list();
  return projects.map((project)=>missionEnvelope(project));
});
