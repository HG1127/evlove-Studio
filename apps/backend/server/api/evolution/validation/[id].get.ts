import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getValidation} from "../../../../src/services/validation-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"validation id required"});
  const result=await getValidation(id);
  if(!result)throw createError({statusCode:404,statusMessage:"validation not found"});
  return result;
});
