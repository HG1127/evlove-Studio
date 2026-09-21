import {createError,defineEventHandler,readBody} from "nitro/h3";
import {runHttpTarget} from "../../../src/services/http-target-gateway";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"target.execute");
  try{return await runHttpTarget(await readBody(event));}
  catch(error){
    if((error as {code?:string}).code==="TARGET_PROXY_NOT_CONFIGURED"){
      throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
    }
    throw error;
  }
});
