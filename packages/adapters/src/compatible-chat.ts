import {CompatibleChatEnvelopeSchema} from "@evolution/contracts";
import {readCompatibleResponsesOutput} from "./compatible-responses";

export const COMPATIBLE_CHAT_OUTPUT_VERSION="chat-output-v1";
export type CompatibleChatOutputOptions={allowResponsesShape?:boolean;apiKey?:string};

/** Decode the external envelope. JSON and task schemas remain the caller's responsibility. */
export function readCompatibleChatOutput(value:unknown,options:CompatibleChatOutputOptions={}):string{
  try{
    const parsed=CompatibleChatEnvelopeSchema.safeParse(value);
    if(!parsed.success)throw new Error("Chat 服务返回格式无效。");
    const body=parsed.data;
    if(body.error||body.message?.trim())throw new Error(body.error?.message||body.message||"模型服务返回错误正文。");
    if(["failed","cancelled","incomplete","queued","in_progress"].includes(body.status??""))throw new Error("模型未完成最终输出。");
    const choice=body.choices?.[0];
    const message=choice?.message;
    if(choice?.finish_reason==="length"){
      const tokens=body.usage?.completion_tokens??body.usage?.output_tokens;
      throw Object.assign(new Error("模型输出被截断（finish_reason=length"+(tokens===undefined?"":"，已用输出 tokens="+tokens)+"）。请缩小构造范围或切换模型。"),{code:"AI_OUTPUT_INCOMPLETE"});
    }
    if(["content_filter","tool_calls","function_call"].includes(choice?.finish_reason??"")||message?.tool_calls?.length||message?.function_call){
      throw new Error("模型未返回完整最终文本（finish_reason="+(choice?.finish_reason??"tool_calls")+"）。");
    }
    const content=message?.content;
    if(message?.refusal?.trim()||(Array.isArray(content)&&content.some(part=>part.type==="refusal"||part.refusal?.trim()))){
      throw new Error("模型拒绝了请求，未返回可用的最终结果。");
    }
    const text=typeof content==="string"?content:Array.isArray(content)
      ?content.filter(part=>!part.type||part.type==="text"||part.type==="output_text").map(part=>part.text??"").join(""):"";
    if(text.trim())return text;
    if(choice?.text?.trim())return choice.text;
    // Compatibility shim for gateways returning Responses objects at a Chat endpoint.
    if(options.allowResponsesShape&&(body.output_text!==undefined&&body.output_text!==null||body.output!==undefined&&body.output!==null))return readCompatibleResponsesOutput(body);
    if(message?.reasoning_content?.trim())throw new Error("回复内容为空：响应只有推理内容，没有最终 content；模型未完成结构化结果。请缩小构造范围或切换模型。");
    throw new Error("服务返回成功状态但回复内容为空：请核对模型 ID 和接口协议。");
  }catch(error){
    const original=error as {message?:string;code?:string};
    const detail=original.message??"Chat 服务返回格式无效。";
    const safe=options.apiKey?detail.split(options.apiKey).join("[redacted]"):detail;
    throw Object.assign(new Error(safe.slice(0,2048)),{code:original.code});
  }
}
