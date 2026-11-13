import {createError,defineEventHandler} from "nitro/h3";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {inspectLabThreeGenerationReadiness} from "../../../src/services/lab-three-generation-readiness";

/** Admin-only read-only P3-T diagnostics. Does not arm/run any Mission or call MiniMax. */
export default defineEventHandler(async event=>{
  await requireGovernedEvolutionPermission(event,"security.admin");
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated"){
    throw createError({statusCode:404,statusMessage:"Lab experiment readiness is isolated-Lab only"});
  }
  try{return await inspectLabThreeGenerationReadiness();}
  catch{
    throw createError({statusCode:503,statusMessage:"Lab experiment readiness is unavailable"});
  }
});
