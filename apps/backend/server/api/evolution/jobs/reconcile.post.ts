import {createError,defineEventHandler,readBody} from "nitro/h3";
import {JobReconcileRequestSchema} from "@evolution/contracts";
import {reconcileWorkflowJobs} from "../../../../src/services/job-reconciliation";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";
import {assertLabReconciliationReady} from "../../../../src/services/lab-reconciliation-preflight";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const parsed=JobReconcileRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  if(parsed.data.repair&&process.env.EVOLUTION_EXPERIMENT_MODE==="isolated"){
    // Read is allowed by mission.execute, but mutating Lab repairs require
    // an additional admin decision and a complete Mission/Job inventory.
    await requireGovernedEvolutionPermission(event,"security.admin");
    try{await assertLabReconciliationReady();}
    catch{
      throw createError({statusCode:503,
        statusMessage:"Lab Mission integrity blocks Job repair"});
    }
  }
  return reconcileWorkflowJobs(parsed.data);
});
