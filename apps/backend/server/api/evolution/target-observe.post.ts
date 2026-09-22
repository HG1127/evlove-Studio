import {createError,defineEventHandler,readBody} from "nitro/h3";
import {observeHttpTarget} from "../../../src/services/http-target-gateway";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  try{return await observeHttpTarget(await readBody(event));}
  catch(error){
    if((error as {code?:string}).code==="TARGET_PROXY_NOT_CONFIGURED"){
      throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
    }
    throw error;
  }
});
