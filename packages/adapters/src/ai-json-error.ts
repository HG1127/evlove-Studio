export type StructuredAiJsonFailureKind = "non-json-envelope" | "trailing-content" | "unescaped-control" | "invalid-escape" | "unfinished-string" | "unfinished-root" | "invalid-syntax";

const descriptions: Record<StructuredAiJsonFailureKind, string> = {
  "non-json-envelope": "JSON 外有说明或其他非 JSON 内容",
  "trailing-content": "JSON 后仍有内容或多个根对象",
  "unescaped-control": "JSON 字符串包含未转义换行或控制字符",
  "invalid-escape": "JSON 字符串包含无效转义",
  "unfinished-string": "JSON 字符串尚未闭合",
  "unfinished-root": "JSON 根对象尚未闭合",
  "invalid-syntax": "JSON 语法无效",
};

/** A locally decoded syntax rejection; a remote error code alone cannot request correction. */
export class StructuredAiJsonError extends Error {
  readonly code = "AI_OUTPUT_INVALID_JSON";
  readonly kind: StructuredAiJsonFailureKind;
  constructor(kind: StructuredAiJsonFailureKind) {
    super("模型最终回复不是完整、有效的 JSON（" + descriptions[kind] + "）。请检查 JSON 输出方式或切换支持结构化输出的模型。");
    this.name = "StructuredAiJsonError";
    this.kind = kind;
  }
}

/** Classify already-rejected JSON without retaining text, positions, keys or native error excerpts. Never repairs output. */
export function classifyStructuredAiJsonFailure(body: string): StructuredAiJsonFailureKind {
  if (body[0] !== "{" && body[0] !== "[") return "non-json-envelope";
  const stack: string[] = [];
  let quoted = false;
  for (let index = 0; index < body.length; index++) {
    const character = body[index]!;
    if (quoted) {
      if (character.charCodeAt(0) < 32) return "unescaped-control";
      if (character === "\\") {
        const next = body[++index];
        if (next === undefined) return "unfinished-string";
        if (next === "u") {
          const unicode = body.slice(index + 1, index + 5);
          if (!/^[0-9a-f]{4}$/i.test(unicode)) return "invalid-escape";
          index += 4;
        } else if (!'"\\/bfnrt'.includes(next)) return "invalid-escape";
      } else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      if (stack.pop() !== (character === "}" ? "{" : "[")) return "invalid-syntax";
      if (!stack.length && body.slice(index + 1).trim()) return "trailing-content";
    }
  }
  return quoted ? "unfinished-string" : stack.length ? "unfinished-root" : "invalid-syntax";
}
