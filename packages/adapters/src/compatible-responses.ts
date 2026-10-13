import {CompatibleResponsesEnvelopeSchema,type CompatibleResponsesEnvelope} from "@evolution/contracts";

export const COMPATIBLE_RESPONSES_OUTPUT_VERSION="responses-output-v2-refusal";

export type CompatibleResponsesFormat="json-schema"|"json-object"|"prompt-json";
export type CompatibleResponsesOptions={
  baseUrl:string;
  apiKey:string;
  model:string;
  system:string;
  user:string;
  schema:{name:string;schema:Record<string,unknown>};
  imageDataUrls?:string[];
  maxOutputTokens:number;
  promptCacheKey?:string;
  verbosity?:"medium";
  signal:AbortSignal;
  preferredFormat?:CompatibleResponsesFormat;
  request:(url:string,init:RequestInit)=>Promise<Response>;
  errorMessage:(status:number,body:unknown)=>string;
};

function formatUnsupported(body:CompatibleResponsesEnvelope){
  const error=body.error;
  return /^(?:text\.format(?:\.|$)|response_format(?:\.|$))/.test(error?.param??"")
    || /json[_ -]?schema|json[_ -]?object|response_format|text\.format|strict|structured.*output|unsupported.*format|format.*(?:support|allowed)/i.test(error?.message??"")
    || /unsupported.*format/.test(error?.code??"");
}

function failure(message:string,status:number,apiKey:string){
  const safe=apiKey?message.split(apiKey).join("[redacted]"):message;
  return Object.assign(new Error(safe.slice(0,2048)),{httpStatus:status});
}

function outputText(body:CompatibleResponsesEnvelope){
  if(body.output_text?.trim())return body.output_text;
  return (body.output??[]).flatMap(item=>item.content??[])
    .filter(part=>part.type==="output_text").map(part=>part.text??"").join("");
}

/** Decode the external envelope only; task schemas remain the caller's responsibility. */
export function readCompatibleResponsesOutput(value:unknown,options:{requireCompletedStatus?:boolean}={}):string{
  const parsed=CompatibleResponsesEnvelopeSchema.safeParse(value);
  if(!parsed.success)throw new Error("Responses 服务返回格式无效。");
  const body=parsed.data;
  const nonterminal=["failed","cancelled","incomplete","queued","in_progress"].includes(body.status??"");
  if(body.error||nonterminal||(options.requireCompletedStatus&&body.status&&body.status!=="completed")){
    throw new Error(body.error?.message??"Responses 模型未完成最终输出。");
  }
  if(body.refusal?.trim() || body.output?.some(item=>item.type==="refusal" || item.refusal?.trim() || item.content?.some(part=>part.type==="refusal" || part.refusal?.trim()))){
    throw new Error("模型拒绝了请求，未返回可用的最终结果。");
  }
  const text=outputText(body);
  if(!text.trim())throw new Error("Responses API 响应中没有 output_text");
  return text;
}

/** HTTP mechanics only: the caller still validates the returned JSON against its task contract. */
export async function callCompatibleResponses(args:CompatibleResponsesOptions):Promise<{text:string;format:CompatibleResponsesFormat}>{
  const formats:CompatibleResponsesFormat[]=["json-schema","json-object","prompt-json"];
  if(args.preferredFormat){
    const index=formats.indexOf(args.preferredFormat);
    if(index>=0){formats.splice(index,1);formats.unshift(args.preferredFormat);}
  }
  for(let index=0;index<formats.length;index+=1){
    args.signal.throwIfAborted();
    const format=formats[index]!;
    const wireFormat=format==="json-schema"?{type:"json_schema",name:args.schema.name,strict:true,schema:args.schema.schema}
      :format==="json-object"?{type:"json_object"}:undefined;
    const response=await args.request(args.baseUrl+"/responses",{
      method:"POST",signal:args.signal,
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+args.apiKey},
      body:JSON.stringify({
        model:args.model,store:false,
        ...(args.promptCacheKey?{prompt_cache_key:args.promptCacheKey}:{}),
        input:[
          {role:"developer",content:[{type:"input_text",text:args.system+"\n\nReturn ONLY one valid JSON object. No markdown fences. Match this exact JSON Schema:\n"+JSON.stringify(args.schema.schema)}]},
          {role:"user",content:[{type:"input_text",text:args.user},...(args.imageDataUrls??[]).map(url=>({type:"input_image",image_url:url,detail:"auto"}))]},
        ],
        ...((wireFormat||args.verbosity)?{text:{...(wireFormat?{format:wireFormat}:{}),...(args.verbosity?{verbosity:args.verbosity}:{})}}:{}),
        max_output_tokens:args.maxOutputTokens,
      }),
    });
    const parsed=CompatibleResponsesEnvelopeSchema.safeParse(await response.json().catch(()=>({})));
    if(!parsed.success)throw failure("Responses 服务返回格式无效。",response.status,args.apiKey);
    const body=parsed.data;
    if(!response.ok){
      if(response.status===400&&index<formats.length-1&&formatUnsupported(body))continue;
      throw failure(args.errorMessage(response.status,body),response.status,args.apiKey);
    }
    try{return {text:readCompatibleResponsesOutput(body),format};}
    catch(error){throw failure(error instanceof Error?error.message:String(error),response.status,args.apiKey);}
  }
  throw new Error("Responses 模型没有支持可用的 JSON 输出方式。");
}
