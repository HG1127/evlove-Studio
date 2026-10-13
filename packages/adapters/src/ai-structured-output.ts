import { classifyStructuredAiJsonFailure, StructuredAiJsonError } from "./ai-json-error";

export const STRUCTURED_AI_FINAL_OUTPUT_VERSION="final-json-v2-safe-syntax-kind";

/** Remove outer transport presentation only, preserving literal artifact content inside JSON. */
export function readStructuredAiFinalText(text:string):string{
  let body=text.trim();let hadReasoning=false;
  while(/^<think>/i.test(body)){
    const end=/<\/think>/i.exec(body);
    if(!end)throw Object.assign(new Error("模型推理尚未结束，未返回完整结果。请重试或切换模型。"),{code:"AI_OUTPUT_INCOMPLETE"});
    body=body.slice(end.index+end[0].length).trim();hadReasoning=true;
  }
  const fenced=/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(body);
  if(fenced)body=fenced[1]!.trim();
  if(!body)throw Object.assign(new Error(hadReasoning?"模型只返回了推理内容，没有最终 JSON 结果。请重试或切换模型。":"模型未返回最终 JSON 结果。请重试或检查模型配置。"),{code:"AI_OUTPUT_MISSING_FINAL"});
  return body;
}

/** Parse final JSON only; the caller must still validate its task schema. */
export function parseStructuredAiOutput(text:string):unknown{
  const body=readStructuredAiFinalText(text);
  try{return JSON.parse(body) as unknown;}
  catch{throw new StructuredAiJsonError(classifyStructuredAiJsonFailure(body));}
}
