import {AiProviderCompletionSchema,type AiProviderCompletion,type AiUsageProtocol} from "@evolution/contracts";

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function allowlisted<T extends string>(value:unknown,allowed:readonly T[]):T|"other"|undefined{
  return typeof value!=="string"||!value?undefined:allowed.includes(value as T)?value as T:"other";
}

/** Provider observations only. No output, reasoning text, headers or arbitrary metadata. */
export function observeAiProviderCompletion(raw:unknown,protocol:AiUsageProtocol):AiProviderCompletion|null{
  const envelope=record(raw);
  let selected:unknown;
  if(protocol==="responses"){
    selected={responseStatus:allowlisted(envelope.status,["completed","incomplete","failed","cancelled","in_progress","queued"]),
      incompleteReason:allowlisted(record(envelope.incomplete_details).reason,["max_output_tokens","content_filter"])};
  }else if(protocol==="ai-sdk"){
    selected={finishReason:allowlisted(envelope.finishReason,["stop","length","content-filter","tool-calls","error","other","unknown"])};
  }else{
    const choice=Array.isArray(envelope.choices)?record(envelope.choices[0]):{};
    selected={finishReason:allowlisted(choice.finish_reason,["stop","length","content_filter","tool_calls","function_call","error","other","unknown"])};
  }
  const parsed=AiProviderCompletionSchema.safeParse(selected);
  return parsed.success?parsed.data:null;
}
