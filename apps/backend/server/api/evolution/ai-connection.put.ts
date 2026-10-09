import {assertBodySize,defineEventHandler,readBody} from "nitro/h3";
import {ServerAiConnectionPutSchema} from "@evolution/contracts";
import {saveServerAiConnection} from "../../../src/services/server-ai-connection";
import {resetServerAiRuntimeProbeCache} from "../../../src/services/server-ai-health";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"security.admin");
  await assertBodySize(event,32*1024);
  const input=ServerAiConnectionPutSchema.parse(await readBody(event));
  const result=await saveServerAiConnection(input,actor);
  resetServerAiRuntimeProbeCache();
  return result;
});
