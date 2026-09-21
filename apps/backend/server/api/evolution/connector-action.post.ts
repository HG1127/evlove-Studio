import {createError,defineEventHandler,readBody} from "nitro/h3";
import {ConnectorActionRequestSchema,type EvolutionPermission} from "@evolution/contracts";
import {executeConnectorAction} from "../../../src/services/connector-registry";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

function permission(operation:string):EvolutionPermission{
  if(operation==="mutate")return "target.write";
  if(operation==="deploy"||operation==="rollback")return "release.execute";
  return "data.read";
}

export default defineEventHandler(async(event)=>{
  const input=ConnectorActionRequestSchema.parse(await readBody(event));
  requireEvolutionPermission(event,permission(input.operation));
  try{return await executeConnectorAction(input);}
  catch(error){
    const code=(error as {code?:string}).code;
    if(code==="CONNECTOR_NOT_REGISTERED")throw createError({statusCode:404,statusMessage:error instanceof Error?error.message:String(error)});
    if(code==="CONNECTOR_OPERATION_UNSUPPORTED")throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});
    if(code==="CONNECTOR_CREDENTIAL_REQUIRED"||code==="CONNECTOR_REGISTRY_INVALID")throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
    throw error;
  }
});
