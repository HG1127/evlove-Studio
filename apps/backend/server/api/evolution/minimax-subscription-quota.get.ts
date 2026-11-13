import {createError,defineEventHandler} from "nitro/h3";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {getServerAiConnectionStatus,resolveServerAiConfigForRole} from "../../../src/services/server-ai-connection";
import {assertMiniMaxSubscriptionQuotaSufficient,fetchMiniMaxSubscriptionQuota} from "../../../src/services/server-ai-minimax-subscription-quota";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"security.admin");
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated"){
    throw createError({statusCode:404,statusMessage:"MiniMax Lab subscription quota is available only in the isolated Lab."});
  }
  const [generationStatus,judgeStatus]=await Promise.all([
    getServerAiConnectionStatus("generation"),getServerAiConnectionStatus("judge"),
  ]);
  if(!generationStatus.configured||!judgeStatus.configured
    ||!generationStatus.connection||!judgeStatus.connection){
    throw createError({statusCode:409,statusMessage:"Both saved MiniMax generation and Judge connections are required."});
  }
  const [generationConfig,judgeConfig]=await Promise.all([
    resolveServerAiConfigForRole("generation"),resolveServerAiConfigForRole("judge"),
  ]);
  if(!generationConfig||!judgeConfig){
    throw createError({statusCode:409,statusMessage:"A saved MiniMax Vault connection could not be resolved."});
  }
  try{
    const [generationQuota,judgeQuota]=await Promise.all([
      fetchMiniMaxSubscriptionQuota(generationConfig),fetchMiniMaxSubscriptionQuota(judgeConfig),
    ]);
    assertMiniMaxSubscriptionQuotaSufficient(generationQuota);
    assertMiniMaxSubscriptionQuotaSufficient(judgeQuota);
    return {
      provider:"minimax-m-plan",status:"verified",checkedAt:new Date().toISOString(),
      minimumRemainingPercent:50,
      roles:{
        generation:{model:generationStatus.connection.model,baseUrl:generationStatus.connection.baseUrl,quota:generationQuota},
        judge:{model:judgeStatus.connection.model,baseUrl:judgeStatus.connection.baseUrl,quota:judgeQuota},
      },
      credentialsExposed:false,
    };
  }catch(error){
    const code=(error as {code?:string}).code??"LAB_MINIMAX_QUOTA_UNAVAILABLE";
    throw createError({statusCode:503,statusMessage:"MiniMax M Plan subscription quota verification failed.",data:{code}});
  }
});