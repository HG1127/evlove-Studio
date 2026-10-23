/** Remove transport presentation wrappers only; the caller must validate the task schema. */
export function parseStructuredAiOutput(text: string): unknown {
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
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw Object.assign(new Error("模型最终回复不是完整、有效的 JSON。请检查 JSON 输出方式或切换支持结构化输出的模型。"), {
      code: "AI_OUTPUT_INVALID_JSON",
    });
  }
}
