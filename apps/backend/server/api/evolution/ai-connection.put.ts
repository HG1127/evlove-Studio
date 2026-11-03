import {assertBodySize,createError,defineEventHandler,getQuery,readBody} from "nitro/h3";
import {ServerAiConnectionPutSchema,ServerAiConnectionQuerySchema} from "@evolution/contracts";
import {saveServerAiConnection} from "../../../src/services/server-ai-connection";
import {resetServerAiRuntimeProbeCache} from "../../../src/services/server-ai-health";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"security.admin");
  const query=ServerAiConnectionQuerySchema.safeParse(getQuery(event));
  if(!query.success)throw createError({statusCode:400,statusMessage:"Invalid model role"});
  await assertBodySize(event,32*1024);
  const input=ServerAiConnectionPutSchema.parse(await readBody(event));
  const result=await saveServerAiConnection(input,actor,query.data.role);
  resetServerAiRuntimeProbeCache();
  return result;
});
