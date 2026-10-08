import { fastHash } from "@evolution/core";

const EMBEDDED_BLOCK = /<(script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ENTITY = /&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi;

function decodeEntity(value: string) {
  return value.replace(ENTITY, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[entity.toLowerCase()] ?? match;
  });
}

/** Complete-file, non-executing projection for *textual* review of a standalone HTML snapshot. */
export function htmlSnapshotReview(content: string) {
  if (!/<html\b[^>]*>/i.test(content) || !/<\/html\s*>/i.test(content)
    || !/<body\b[^>]*>/i.test(content) || !/<\/body\s*>/i.test(content)) return undefined;
  const body = content.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1];
  if (body === undefined) return undefined;
  const embedded = [...content.matchAll(EMBEDDED_BLOCK)];
  const scripts = embedded.filter((match) => match[1]?.toLowerCase() === "script").map((match) => match[0]);
  const styles = embedded.filter((match) => match[1]?.toLowerCase() === "style").map((match) => match[0]);
  const bodyWithoutEmbedded = body.replace(EMBEDDED_BLOCK, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const text = decodeEntity(bodyWithoutEmbedded.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const openingTags = [...bodyWithoutEmbedded.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)];
  const tags = openingTags.map((match) => match[1]!.toLowerCase());
  const counts = new Map<string, number>();
  for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const headings = [...bodyWithoutEmbedded.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)]
    .map((match) => `H${match[1]} ${decodeEntity(match[2]!.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()}`);
  const ids = openingTags.flatMap((tag) => {
    const id = tag[2]!.match(/\sid\s*=\s*(["'])(.*?)\1/i);
    return id ? [id[2]!] : [];
  });
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const anchors = openingTags.filter((tag) => tag[1]!.toLowerCase() === "a").flatMap((tag) => {
    const href = tag[2]!.match(/\shref\s*=\s*(["'])#([^"']+)\1/i);
    return href ? [href[2]!] : [];
  });
  const brokenAnchors = [...new Set(anchors.filter((anchor) => !ids.includes(anchor)))];
  return {
    rawLength: content.length,
    rawHash: fastHash(content),
    text,
    scripts,
    styles,
    summary: `完整 HTML 源码 ${content.length} 字符 / hash ${fastHash(content)}；正文投影 ${text.length} 字符；标签 ${tags.length} 个（${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tag, count]) => `${tag}:${count}`).join("、")}）；标题 ${headings.length} 个；重复 ID ${duplicateIds.length} 个；失效页内锚点 ${brokenAnchors.length} 个；内嵌 script ${scripts.length} 段、style ${styles.length} 段。`,
    structuralIssues: [...duplicateIds.map((id) => `重复 ID: ${id}`), ...brokenAnchors.map((id) => `失效页内锚点: #${id}`)],
    headings,
  };
}
