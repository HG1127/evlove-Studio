import {createError,defineEventHandler,readBody} from "nitro/h3";
import {releaseHttpTarget} from "../../../src/services/http-target-gateway";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"release.execute");
  try{return await releaseHttpTarget(await readBody(event));}
  catch(error){
    if((error as {code?:string}).code==="TARGET_PROXY_NOT_CONFIGURED"){
      throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
    }
    throw error;
  }
});
