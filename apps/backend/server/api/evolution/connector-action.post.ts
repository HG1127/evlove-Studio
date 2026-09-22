import {createError,defineEventHandler,readBody} from "nitro/h3";
import {ConnectorActionRequestSchema} from "@evolution/contracts";
import {executeConnectorAction} from "../../../src/services/connector-registry";
import {connectorOperationPermission} from "../../../src/services/connector-permission";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const input=ConnectorActionRequestSchema.parse(await readBody(event));
  await requireGovernedEvolutionPermission(event,connectorOperationPermission(input.operation));
  try{return await executeConnectorAction(input);}
  catch(error){
    const code=(error as {code?:string}).code;
    if(code==="CONNECTOR_NOT_REGISTERED")throw createError({statusCode:404,statusMessage:error instanceof Error?error.message:String(error)});
    if(code==="CONNECTOR_OPERATION_UNSUPPORTED")throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});
    if(code==="CONNECTOR_CREDENTIAL_REQUIRED"||code==="CONNECTOR_REGISTRY_INVALID")throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
    throw error;
  }
});
