import {z} from "zod";
import {CompatibleChatEnvelopeSchema} from "@evolution/contracts";
import {readCompatibleChatOutput} from "./compatible-chat";

const MAX_ARGUMENT_BYTES=2*1024*1024;
const SchemaResultCall=z.object({
  id:z.string().min(1).max(256),type:z.literal("function"),
  function:z.object({name:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),arguments:z.string().min(1).max(MAX_ARGUMENT_BYTES)}),
});
/** Validate only the requested final result carrier. No function is ever executed. */
export function readCompatibleSchemaToolOutput(value:unknown,expectedName:string):{text:string;carrier:"schema-tool"|"text"}{
  const invalid=()=>Object.assign(new Error("模型未返回唯一、完整的指定结构化结果。"),{code:"AI_OUTPUT_MISSING_FINAL"});
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(expectedName))throw invalid();
  const parsed=CompatibleChatEnvelopeSchema.safeParse(value);
  if(!parsed.success)throw invalid();
  const body=parsed.data,choice=body.choices?.[0],message=choice?.message;
  if(body.error||body.message?.trim()||body.status!=null&&body.status!=="completed"||body.choices?.length!==1||!message
    ||message.role!==undefined&&message.role!=="assistant"||message.refusal?.trim()||message.function_call
    ||body.output_text?.trim()||body.output?.length)throw invalid();
  if(choice?.finish_reason==="length")throw Object.assign(new Error("模型输出被截断，未取得完整结构化结果。"),{code:"AI_OUTPUT_INCOMPLETE"});
  const calls=message.tool_calls??[];
  if(calls.length===0){
    const content=message.content;
    const hasNativeText=typeof content==="string"?Boolean(content.trim()):Array.isArray(content)&&content.some(part=>part.text?.trim());
    if(choice?.finish_reason!=="stop"||hasNativeText&&choice.text?.trim()
      ||Array.isArray(content)&&content.some(part=>part.type&&part.type!=="text"&&part.type!=="output_text"))throw invalid();
    return{text:readCompatibleChatOutput(body),carrier:"text"};
  }
  const content=message.content;
  const emptyContent=content==null||typeof content==="string"&&!content.trim()
    ||Array.isArray(content)&&content.every(part=>(!part.type||part.type==="text"||part.type==="output_text")&&!part.text?.trim()&&!part.refusal?.trim());
  if(choice?.finish_reason!=="tool_calls"||calls.length!==1||!emptyContent||choice.text?.trim())throw invalid();
  const call=SchemaResultCall.safeParse(calls[0]);
  if(!call.success||call.data.function.name!==expectedName)throw invalid();
  const text=call.data.function.arguments;
  if(new TextEncoder().encode(text).byteLength>MAX_ARGUMENT_BYTES)throw invalid();
  return{text,carrier:"schema-tool"};
}
