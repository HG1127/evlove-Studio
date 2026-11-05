import {z} from "zod";
import type {AiOperation} from "@evolution/contracts";
import type {ServerAiConfig} from "../server-env";

const pairedTimeout=z.coerce.number().int().min(10_000).max(900_000);

/** Resource limit only: never extends a control Job's lifetime or retries an unknown outcome. */
export function serverAiRequestPolicy(operation:AiOperation,config:ServerAiConfig){
  if(operation!=="evaluate-paired")return {timeoutMs:config.timeoutMs,boundedPaired:false};
  const raw=process.env.EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS?.trim();
  if(!raw)return {timeoutMs:config.timeoutMs,boundedPaired:false};
  const parsed=pairedTimeout.safeParse(raw);
  if(!parsed.success)throw Object.assign(new Error("Invalid paired AI request timeout; expected integer milliseconds from 10000 to 900000"),{code:"AI_REQUEST_TIMEOUT_INVALID"});
  return {timeoutMs:parsed.data,boundedPaired:true};
}

export const serverAiRequestTimeoutMs=(operation:AiOperation,config:ServerAiConfig)=>serverAiRequestPolicy(operation,config).timeoutMs;
