type HtmlEdit = { targetId: string; operation: "prepend" | "append" | "replace"; content: string };

// Token offsets retain the original bytes; DOM serialization would rewrite untouched markup.
function elementRange(source: string, id: string) {
  const tokens = [...source.matchAll(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi)];
  const openings = tokens.filter((token) => {
    if (!/^<[a-z]/i.test(token[0]) || /^<(script|style)\b/i.test(token[0])) return false;
    const value = token[0].match(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return (value?.[1] ?? value?.[2] ?? value?.[3]) === id;
  });
  if (openings.length !== 1) throw new Error(`局部修改目标 ID 缺失或重复：${id}`);
  const opening = openings[0]!;
  const tag = opening[0].match(/^<([a-z][\w:-]*)/i)![1]!.toLowerCase();
  if (/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)) throw new Error(`局部修改目标不能是空元素：${id}`);
  let depth = 0;
  for (const token of tokens.slice(tokens.indexOf(opening))) {
    const match = token[0].match(/^<(\/)?([a-z][\w:-]*)\b/i);
    if (match?.[2]?.toLowerCase() !== tag) continue;
    depth += match[1] ? -1 : 1;
    if (depth === 0) return { start: opening.index!, innerStart: opening.index! + opening[0].length, innerEnd: token.index!, end: token.index! + token[0].length };
  }
  throw new Error(`局部修改目标没有闭合：${id}`);
}

export function applyHtmlLocalEdits(original: string, payload: string): string {
  const data = JSON.parse(payload) as { kind: string; edits: HtmlEdit[] };
  if (data.kind !== "html-edits" || !Array.isArray(data.edits) || !data.edits.length) throw new Error("缺少 HTML 局部修改");
  if (typeof DOMParser === "undefined") throw new Error("HTML 局部修改需要浏览器解析器");
  const ranges = data.edits.map((edit) => {
    if (!edit.targetId || typeof edit.content !== "string" || !["prepend", "append", "replace"].includes(edit.operation)) throw new Error("HTML 局部修改参数无效");
    if (/<\/?(?:html|head|body)\b/i.test(edit.content)) throw new Error("局部修改不能包含整页外壳");
    if (edit.operation === "replace") {
      const parsed = new DOMParser().parseFromString(edit.content, "text/html");
      if (parsed.body.children.length !== 1 || parsed.body.firstElementChild?.id !== edit.targetId) throw new Error("替换必须保留唯一目标元素及其 ID");
    }
    const range = elementRange(original, edit.targetId);
    // The operation owns only this explicit element. Its surrounding document is immutable.
    const start = edit.operation === "prepend" ? range.innerStart : edit.operation === "append" ? range.innerEnd : range.start;
    const end = edit.operation === "replace" ? range.end : start;
    return { start, end, content: edit.content };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]!.start < ranges[i - 1]!.end) throw new Error("HTML 局部修改范围重叠，请合并同一章节的修改");
  let result = original;
  for (const edit of ranges.reverse()) result = result.slice(0, edit.start) + edit.content + result.slice(edit.end);
  if (typeof DOMParser === "undefined") throw new Error("HTML 局部修改需要浏览器解析器");
  const counts = (html: string) => {
    const map = new Map<string, number>();
    new DOMParser().parseFromString(html, "text/html").querySelectorAll("[id]").forEach((element) => map.set(element.id, (map.get(element.id) ?? 0) + 1));
    return map;
  };
  const before = counts(original);
  for (const [id, count] of counts(result)) if (count > 1 && count > (before.get(id) ?? 0)) throw new Error(`局部修改新增重复 ID：${id}；请只返回待插入内容，不要重复目标章节外壳`);
  return result;
}
