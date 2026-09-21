import {defineEventHandler} from "nitro/h3";
import {getOutcomeAnalyticsHealth} from "../../../src/services/outcome-analytics";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"data.read");
  return getOutcomeAnalyticsHealth();
});
