import {createError,defineEventHandler,readBody} from "nitro/h3";
import {HarnessPrepareRequestSchema} from "@evolution/contracts";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {prepareHarnessExecution} from "../../../src/services/harness-runner";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");

  const parsed=HarnessPrepareRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Harness preparation request",data:parsed.error.flatten()});

  try{
    return await prepareHarnessExecution(parsed.data.missionId,parsed.data.jobId);
  }catch(error){
    throw createError({statusCode:500,statusMessage:"Harness execution preparation failed",cause:error});
  }
});
