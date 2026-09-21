import {defineEventHandler} from "nitro/h3";
import {missionEnvelope} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  const projects=await getServerProductionRuntime().missions.list();
  return projects.map((project)=>missionEnvelope(project));
});
