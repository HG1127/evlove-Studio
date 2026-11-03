import type {AiOperation} from "@evolution/contracts";
import type {ServerAiConfig} from "../server-env";

const judged=new Set<AiOperation>(["evaluate","evaluate-paired","evaluate-population","artifact-acceptance","release-review","visual-judge"]);

export function serverAiJudgedOperation(operation:AiOperation){return judged.has(operation);}

/** Select only from the pinned connection; generation and evaluation share no mutable role override. */
export function serverAiConfigForOperation(config:ServerAiConfig,operation:AiOperation):ServerAiConfig{
  if(config.mode!=="openai-compatible"||!config.judgeReasoningEffort||!serverAiJudgedOperation(operation))return config;
  return {...config,reasoningEffort:config.judgeReasoningEffort};
}
