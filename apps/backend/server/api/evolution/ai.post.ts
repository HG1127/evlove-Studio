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
        data:{code:"SERVER_AI_UNAVAILABLE",reasonCode,message:serverAiUnavailableMessage(reasonCode)},
      });
    }
    const code=(error as {code?:unknown})?.code;
    if(typeof code==="string"&&code.startsWith("AI_OUTPUT_")&&error instanceof Error){
      throw createError({statusCode:502,statusMessage:"Invalid model output",data:{code,message:error.message}});
    }
    throw createError({statusCode:500,statusMessage:"Server AI operation failed",data:{
      code:"SERVER_AI_EXECUTION_FAILED",message:"后端模型请求未完成，已保留当前任务。请重试或查看运行记录。",
    }});
  }
});
