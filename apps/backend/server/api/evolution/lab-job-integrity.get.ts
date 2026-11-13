import {createError,defineEventHandler} from "nitro/h3";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {inspectLabJobIntegrity} from "../../../src/services/lab-job-integrity";

/** Admin-only, isolated-Lab-only, strictly read-only; no Job cancellation. */
export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"security.admin");
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated"){
    throw createError({statusCode:404,statusMessage:"Lab integrity inspection is not enabled."});
  }
  try{return await inspectLabJobIntegrity();}
  catch(error){
    // Do not leak upstream DB credentials, query text or internal errors.
    throw createError({statusCode:503,statusMessage:"Lab integrity inspection is unavailable.",
      data:{code:(error as {code?:string}).code==="LAB_INTEGRITY_NOT_ISOLATED"
        ?"LAB_INTEGRITY_NOT_ISOLATED":"LAB_INTEGRITY_UNAVAILABLE"}});
  }
});
