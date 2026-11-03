import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {ServerAiConnectionQuerySchema} from "@evolution/contracts";
import {getServerAiConnectionStatus} from "../../../src/services/server-ai-connection";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const query=ServerAiConnectionQuerySchema.safeParse(getQuery(event));
  if(!query.success)throw createError({statusCode:400,statusMessage:"Invalid model role"});
  return getServerAiConnectionStatus(query.data.role);
});
