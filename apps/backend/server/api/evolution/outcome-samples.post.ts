import {defineEventHandler,readBody} from "nitro/h3";
import {OutcomeMetricBatchRequestSchema} from "@evolution/contracts";
import {insertOutcomeSamples} from "../../../src/services/outcome-sample-store";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"outcome.write");
  const input=OutcomeMetricBatchRequestSchema.parse(await readBody(event));
  return insertOutcomeSamples(input);
});
