import {defineEventHandler} from "nitro/h3";
import {missionEnvelope} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";

export default defineEventHandler(async()=>{
  const projects=await getServerProductionRuntime().missions.list();
  return projects.map((project)=>missionEnvelope(project));
});
