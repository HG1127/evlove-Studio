/** 把内容按 ```mermaid 围栏切成段：普通文本段照原样展示，mermaid 段渲染成图。 */
export type ContentSegment = { type: "text" | "mermaid"; value: string };

export function splitMermaidSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const fence = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  for (const match of content.matchAll(fence)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ type: "text", value: content.slice(last, at) });
    segments.push({ type: "mermaid", value: match[1]! });
    last = at + match[0].length;
  }
  if (last < content.length) segments.push({ type: "text", value: content.slice(last) });
  return segments;
}
