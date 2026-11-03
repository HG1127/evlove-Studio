import {assertBodySize,createError,defineEventHandler,readBody} from "nitro/h3";
import {ServerAiConnectionPutSchema} from "@evolution/contracts";
import {saveServerAiConnection} from "../../../src/services/server-ai-connection";
import {resetServerAiRuntimeProbeCache} from "../../../src/services/server-ai-health";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"security.admin");
  await assertBodySize(event,32*1024);
  const input=ServerAiConnectionPutSchema.safeParse(await readBody(event));
  if(!input.success)throw createError({statusCode:400,statusMessage:"Invalid AI connection"});
  const result=await saveServerAiConnection(input.data,actor,"judge");
  resetServerAiRuntimeProbeCache();
  return result;
});
