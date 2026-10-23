import {z} from "zod";
import {AiProviderTokenCountsSchema,AiProviderTokenUsageSchema,type AiProviderTokenUsage,type AiUsageProtocol} from "@evolution/contracts";

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const responseId=z.string().regex(/^[a-zA-Z0-9._:-]{1,200}$/);
const model=z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:/@-]+$/);

/** Keep only documented usage counters. Never retain content, headers or arbitrary provider metadata. */
export function observeAiProviderUsage(raw:unknown,protocol:AiUsageProtocol){
  const envelope=record(raw),usage=record(envelope.usage),sdk=protocol==="ai-sdk",responses=protocol==="responses";
  const inputDetails=record(usage[sdk?"inputTokenDetails":responses?"input_tokens_details":"prompt_tokens_details"]);
  const outputDetails=record(usage[sdk?"outputTokenDetails":responses?"output_tokens_details":"completion_tokens_details"]);
  const selected={input:usage[sdk?"inputTokens":responses?"input_tokens":"prompt_tokens"],
    output:usage[sdk?"outputTokens":responses?"output_tokens":"completion_tokens"],total:usage[sdk?"totalTokens":"total_tokens"],
    reasoning:outputDetails[sdk?"reasoningTokens":"reasoning_tokens"],cacheRead:inputDetails[sdk?"cacheReadTokens":"cached_tokens"]};
  const parsed=AiProviderTokenCountsSchema.safeParse(selected);
  let observed:AiProviderTokenUsage;
  if(!parsed.success)observed={status:"invalid",counts:{},reason:"invalid-fields"};
  else{
    const counts=parsed.data,values=Object.values(counts).filter(value=>value!==undefined);
    const inconsistent=counts.input!==undefined&&counts.output!==undefined&&counts.total!==undefined&&counts.input+counts.output!==counts.total
      ||counts.reasoning!==undefined&&counts.output!==undefined&&counts.reasoning>counts.output
      ||counts.cacheRead!==undefined&&counts.input!==undefined&&counts.cacheRead>counts.input;
    observed=inconsistent?{status:"invalid",counts,reason:"inconsistent-counts"}
      :!values.length?{status:"unavailable",counts:{},reason:"missing-usage"}
      :{status:counts.input!==undefined&&counts.output!==undefined&&counts.total!==undefined?"complete":"partial",counts};
  }
  const id=responseId.safeParse(envelope.id),returnedModel=model.safeParse(envelope.model);
  return {usage:AiProviderTokenUsageSchema.parse(observed),responseId:id.success?id.data:undefined,responseModel:returnedModel.success?returnedModel.data:undefined};
}
