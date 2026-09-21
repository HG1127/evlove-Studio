import {createError,defineEventHandler,readBody} from "nitro/h3";
import {OrganizationCapabilityAccessUpdateRequestSchema} from "@evolution/contracts";
import {updateOrganizationCapabilityAccess} from "../../../src/services/organization-capability";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"capability.write");
  const input=OrganizationCapabilityAccessUpdateRequestSchema.parse(await readBody(event));
  try{
    return await updateOrganizationCapabilityAccess(input,actor);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(/not found/i.test(message))throw createError({statusCode:404,statusMessage:message});
    if(/only be changed/i.test(message))throw createError({statusCode:403,statusMessage:message});
    throw error;
  }
});
