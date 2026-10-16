import {CompatibleChatEnvelopeSchema,CompatibleResponsesEnvelopeSchema} from "@evolution/contracts";
import {readCompatibleSchemaToolOutput} from "@evolution/adapters";

type CompletionDiagnosticInput={protocol:"chat-completions"|"responses";phase:"initial"|"correction";envelope:unknown;expectedSchemaToolName?:string};
const statuses=new Set(["completed","failed","cancelled","incomplete","queued","in_progress"]);
const finishReasons=new Set(["stop","length","content_filter","tool_calls","function_call"]);
const retained=new WeakMap<object,string>();
function category(value:string|null|undefined,known:ReadonlySet<string>){
  return value==null?"missing":known.has(value)?value:"other";
}
function safeTokenCount(value:unknown):number|undefined{
  return typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000?value:undefined;
}
function textBytes(values:readonly string[]){return values.reduce((bytes,text)=>bytes+Buffer.byteLength(text,"utf8"),0);}

/** External values are schema-validated, then reduced to fixed categories and numeric counts only. */
export function directAiCompletionDiagnosticSuffix(args:CompletionDiagnosticInput):string{
  const parts=["completionPhase="+args.phase,"protocol="+args.protocol];
  if(args.protocol==="chat-completions"){
    const parsed=CompatibleChatEnvelopeSchema.safeParse(args.envelope);
    if(!parsed.success)return " ["+parts.concat("envelope=invalid").join("; ")+"]";
    const body=parsed.data,choice=body.choices?.[0],content=choice?.message?.content;
    const nativeText=typeof content==="string"?[content]:Array.isArray(content)
      ?content.filter(part=>!part.type||part.type==="text"||part.type==="output_text").map(part=>part.text??""):[];
    // Follow the same first-choice text precedence as the decoder; never use a later alternative.
    const hasContent=nativeText.some(text=>text.trim());
    let finalText=hasContent?nativeText:choice?.text?.trim()?[choice.text]:[];
    if(args.expectedSchemaToolName){
      try{const output=readCompatibleSchemaToolOutput(body,args.expectedSchemaToolName);if(output.carrier==="schema-tool"){finalText=[output.text];parts.push("carrier=schema-tool");}}catch{/* Counts never authorize correction or publish rejected tool contents. */}
    }
    parts.push("status="+category(body.status,statuses),"finish="+category(choice?.finish_reason,finishReasons),"contentBytes="+textBytes(finalText));
    const tokens=safeTokenCount(body.usage?.completion_tokens??body.usage?.output_tokens);
    if(tokens!==undefined)parts.push("outputTokens="+tokens);
  }else{
    const parsed=CompatibleResponsesEnvelopeSchema.safeParse(args.envelope);
    if(!parsed.success)return " ["+parts.concat("envelope=invalid").join("; ")+"]";
    const body=parsed.data;
    const finalText=body.output_text?.trim()?[body.output_text]:(body.output??[])
      .flatMap(item=>item.content??[]).filter(part=>part.type==="output_text").map(part=>part.text??"");
    parts.push("status="+category(body.status,statuses),"contentBytes="+textBytes(finalText));
    const usage=body.usage;
    if(usage&&typeof usage==="object"&&!Array.isArray(usage)){
      const tokens=safeTokenCount((usage as Record<string,unknown>).output_tokens);
      if(tokens!==undefined)parts.push("outputTokens="+tokens);
    }
  }
  return " ["+parts.join("; ")+"]";
}

/** Preserve local error identity: metadata must never grant a new structural-correction attempt. */
export function retainDirectAiCompletionDiagnostic(error:unknown,args:CompletionDiagnosticInput):unknown{
  if(!(error instanceof Error))return error;
  const suffix=directAiCompletionDiagnosticSuffix(args);
  retained.set(error,suffix);
  error.message+=suffix;
  return error;
}
/** Private correction wrappers may recover only metadata minted by this module, never remote fields. */
export function readDirectAiCompletionDiagnostic(error:unknown):string{
  return error&&typeof error==="object"?retained.get(error)??"":"";
}
