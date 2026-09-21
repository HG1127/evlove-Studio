import {defineEventHandler,readBody} from "nitro/h3";
import {OutcomeMetricBatchRequestSchema} from "@evolution/contracts";
import {insertOutcomeSamples} from "../../../src/services/outcome-sample-store";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"outcome.write");
  const input=OutcomeMetricBatchRequestSchema.parse(await readBody(event));
  return insertOutcomeSamples(input);
});
