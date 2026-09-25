import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {ValidationDiscoveryQuerySchema} from "@evolution/contracts";
import {discoverValidations} from "../../../src/services/validation-discovery";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=ValidationDiscoveryQuerySchema.safeParse(getQuery(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Validation discovery query",data:parsed.error.flatten()});
  return discoverValidations(parsed.data);
});
