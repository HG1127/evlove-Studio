/** Whitelisted grammar metadata only; engine messages may contain private model text. */
function syntaxFeedback(body:string,cause:unknown):string{
  const message=cause instanceof Error?cause.message:"";
  const found=/\bposition (\d+)\b/.exec(message),position=found?Number(found[1]):/Unexpected end of JSON/i.test(message)?body.length:undefined;
  const offset=position!==undefined&&Number.isSafeInteger(position)&&position>=0&&position<=body.length?position:undefined;
  const tokens:Record<string,string>={"}":"closing brace","]":"closing square bracket","{":"opening brace","[":"opening square bracket",",":"comma",":":"colon",'"':"quotation mark"};
  const token=offset===body.length?"end of input":offset===undefined?undefined:tokens[body[offset]!]??"another token";
  const expected=message.includes("Expected ',' or ']'")?"comma or closing square bracket"
    :message.includes("Expected ',' or '}'")?"comma or closing brace"
    :/Expected (?:property name|double-quoted property name)/.test(message)?"a quoted object property name"
    :message.includes("Expected ':'")?"a colon after the property name"
    :/Unexpected end of JSON/i.test(message)?"a complete JSON value and matched containers"
    :/Unexpected non-whitespace character after JSON/.test(message)?"end of input after one JSON value"
    :/escape|control character/i.test(message)?"a valid escaped JSON string":"valid JSON grammar";
  const nesting=expected==="comma or closing square bracket"&&token==="closing brace"
    ?" Close each array item object once; check object and array nesting before closing the array.":" Check quotes, separators and matching object/array boundaries.";
  return `JSON syntax${offset===undefined?"":` at UTF-16 offset ${offset}`}: expected ${expected}${token?`; got ${token}`:""}.${nesting}`;
}

/** Extract final transport text without reasoning; this does not parse or validate its JSON. */
export function structuredAiFinalText(text: string): string {
  let body = text.trim();
  let hadReasoning = false;
  while (/^<think>/i.test(body)) {
    const end = /<\/think>/i.exec(body);
    if (!end) {
      throw Object.assign(new Error("模型推理尚未结束，未返回完整结果。请重试或切换模型。"), {
        code: "AI_OUTPUT_INCOMPLETE",
      });
    }
    body = body.slice(end.index + end[0].length).trim();
    hadReasoning = true;
  }
  if (!body) {
    throw Object.assign(new Error(hadReasoning
      ? "模型只返回了推理内容，没有最终 JSON 结果。请重试或切换模型。"
      : "模型未返回最终 JSON 结果。请重试或检查模型配置。"), {
      code: "AI_OUTPUT_MISSING_FINAL",
    });
  }
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(body);
  if (fenced) body = fenced[1]!.trim();
  return body;
}

/** Remove transport presentation wrappers only; the caller must validate the task schema. */
export function parseStructuredAiOutput(text: string): unknown {
  const body=structuredAiFinalText(text);
  try {
    return JSON.parse(body) as unknown;
  } catch(cause) {
    throw Object.assign(new Error("模型最终回复不是完整、有效的 JSON。请检查 JSON 输出方式或切换支持结构化输出的模型。"), {
      code: "AI_OUTPUT_INVALID_JSON",
      validationIssues:[syntaxFeedback(body,cause)],
    });
  }
}
