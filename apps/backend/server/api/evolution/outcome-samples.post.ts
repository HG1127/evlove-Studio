import {createError,defineEventHandler,readBody} from "nitro/h3";
import {OutcomeMetricBatchRequestSchema} from "@evolution/contracts";
import {bindOutcomeMetricBatchToMission} from "../../../src/services/outcome-ingestion";
import {insertOutcomeSamples,OutcomeSampleIdConflictError} from "../../../src/services/outcome-sample-store";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"outcome.write");
  const input=OutcomeMetricBatchRequestSchema.parse(await readBody(event));
  const mission=await getServerProductionRuntime().missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Outcome Mission not found"});
  let bound;
  try{bound=bindOutcomeMetricBatchToMission(mission,input);}
  catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});}
  try{return await insertOutcomeSamples(bound);}
  catch(error){
    if(error instanceof OutcomeSampleIdConflictError){
      throw createError({statusCode:409,statusMessage:error.message});
    }
    throw error;
  }
});
