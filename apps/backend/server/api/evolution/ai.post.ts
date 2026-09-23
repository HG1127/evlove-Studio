import {createError,defineEventHandler,readBody} from "nitro/h3";
import {AiRequestSchema} from "@evolution/contracts";
import {runServerAi,serverAiUnavailableMessage,serverAiUnavailableReason} from "../../../src/services/ai-gateway";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"ai.execute");
  const input=AiRequestSchema.parse(await readBody(event));
  try{
    const result=await runServerAi(input.operation,input.payload);
    return {operation:input.operation,result};
  }catch(error){
    const reasonCode=serverAiUnavailableReason(error);
    if(reasonCode){
      throw createError({
        statusCode:503,
        statusMessage:serverAiUnavailableMessage(reasonCode),
        data:{code:"SERVER_AI_UNAVAILABLE",reasonCode},
      });
    }
    throw error;
  }
});
