import {defineEventHandler} from "nitro/h3";
import {listServerMissionEnvelopes} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return listServerMissionEnvelopes();
});
