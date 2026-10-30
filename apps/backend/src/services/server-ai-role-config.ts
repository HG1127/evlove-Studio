import type {AiOperation} from "@evolution/contracts";
import type {ServerAiConfig} from "../server-env";

const judged=new Set<AiOperation>(["evaluate","evaluate-paired","evaluate-population","artifact-acceptance","release-review","visual-judge"]);

/** Select only from the pinned connection; generation and evaluation share no mutable role override. */
export function serverAiConfigForOperation(config:ServerAiConfig,operation:AiOperation):ServerAiConfig{
  if(config.mode!=="openai-compatible"||!config.judgeReasoningEffort||!judged.has(operation))return config;
  return {...config,reasoningEffort:config.judgeReasoningEffort};
}
