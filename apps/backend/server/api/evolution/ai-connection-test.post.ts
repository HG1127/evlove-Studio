import {assertBodySize,defineEventHandler,readBody} from "nitro/h3";
import {ServerAiConnectionPutSchema} from "@evolution/contracts";
import {withExplicitServerAiConnection} from "../../../src/services/server-ai-connection";
import {probeServerAiRuntime} from "../../../src/services/server-ai-health";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"security.admin");
  await assertBodySize(event,32*1024);
  const input=ServerAiConnectionPutSchema.parse(await readBody(event));
  return withExplicitServerAiConnection(input,()=>probeServerAiRuntime(undefined,{force:true,cacheMs:0,isolated:true}));
});
