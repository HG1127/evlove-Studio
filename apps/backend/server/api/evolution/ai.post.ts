import {createError,defineEventHandler,readBody} from "nitro/h3";
import {AiRequestSchema} from "@evolution/contracts";
import {isServerAiUnavailable,runServerAi} from "../../../src/services/ai-gateway";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"ai.execute");
  const input=AiRequestSchema.parse(await readBody(event));
  try{
    const result=await runServerAi(input.operation,input.payload);
    return {operation:input.operation,result};
  }catch(error){
    if(isServerAiUnavailable(error)){
      throw createError({statusCode:503,statusMessage:"Server AI 未配置",data:{code:"SERVER_AI_UNAVAILABLE"}});
    }
    throw error;
  }
});
