import {defineEventHandler} from "nitro/h3";
import {getOutcomeAnalyticsHealth} from "../../../src/services/outcome-analytics";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  return getOutcomeAnalyticsHealth();
});
