import {createError,defineEventHandler,readBody} from "nitro/h3";
import {JobReconcileRequestSchema} from "@evolution/contracts";
import {reconcileWorkflowJobs} from "../../../../src/services/job-reconciliation";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=JobReconcileRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  return reconcileWorkflowJobs(parsed.data);
});
