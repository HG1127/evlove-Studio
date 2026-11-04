import {z} from "zod";
import type {AiOperation} from "@evolution/contracts";
import type {ServerAiConfig} from "../server-env";

const configuredLimit=z.coerce.number().int().min(1024).max(65_536);
const minimaxHosts=new Set(["api.minimaxi.com","api.minimax.io","api.minimax.cn"]);
const miniMaxM3PairedLimit=32_768;

/** A prospective paired-Judge limit, shared by all transports. Never adds a request or repairs truncated output.
 * EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS accepts 1024..65536; blank retains provider defaults.
 * Official MiniMax-M3 pairs need more than the observed 16384 truncation ceiling; other routes retain their legacy limits.
 */
export function serverAiOutputTokenLimit(operation:AiOperation,config:ServerAiConfig,legacyLimit:number):number{
  if(operation!=="evaluate-paired")return legacyLimit;
  const raw=process.env.EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS?.trim();
  if(raw){
    const parsed=configuredLimit.safeParse(raw);
    if(!parsed.success)throw Object.assign(new Error("Invalid paired AI output token limit; expected an integer from1024 to65536"),{code:"AI_OUTPUT_BUDGET_INVALID"});
    return parsed.data;
  }
  return config.mode==="openai-compatible"&&config.model==="MiniMax-M3"
    &&minimaxHosts.has(new URL(config.baseUrl).hostname)?miniMaxM3PairedLimit:legacyLimit;
}

/** Preserve legacy identities when the effective request is unchanged; bind every changed effective token limit. */
export function serverAiPairedOutputBudgetIdentity(config:ServerAiConfig){
  // An implicit protocol can use Responses first and then Chat. Bind both effective request limits.
  if(config.mode==="openai-compatible"&&!config.protocol){
    const responsesMaxOutputTokens=serverAiOutputTokenLimit("evaluate-paired",config,10_000);
    const chatMaxTokens=serverAiOutputTokenLimit("evaluate-paired",config,16_384);
    return responsesMaxOutputTokens===10_000&&chatMaxTokens===16_384?undefined
      :{version:"paired-output-budget-v1",responsesMaxOutputTokens,chatMaxTokens};
  }
  const legacy=config.mode==="openai-compatible"&&config.protocol!=="responses"?16_384:10_000;
  const limit=serverAiOutputTokenLimit("evaluate-paired",config,legacy);
  return limit===legacy?undefined:{version:"paired-output-budget-v1",maxOutputTokens:limit};
}
