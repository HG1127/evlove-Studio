function normalizedTokens(value: string) {
  const normalized = value.toLowerCase();
  const tokens = normalized.match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) ?? [];
  // Chinese words are not separated by spaces. Keep exact phrases, segmented
  // words and character bigrams so recall does not depend on identical sentences.
  const segmented = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter("zh", { granularity: "word" }).segment(normalized)].filter((s) => s.isWordLike).map((s) => s.segment)
    : [];
  const grams = tokens.filter((s) => /[\u4e00-\u9fff]/.test(s)).flatMap((s) => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const related = [["等待", "超时", "时限"], ["异常", "失败", "错误"], ["交接", "转交", "接手"], ["来源", "引用", "证据"], ["重复", "冗余", "去重"]]
    .flatMap((group) => group.some((word) => normalized.includes(word)) ? group : []);
  return [...new Set([...tokens, ...segmented, ...grams, ...related])].filter((token) => token.length >= 2).slice(0, 256);
}

const chunkCache = new Map<string, Map<number, Array<{ index: number; start: number; text: string }>>>();
let cachedChars = 0;

function chunks(text: string, size = 4000) {
  const cached = chunkCache.get(text)?.get(size);
  if (cached) return cached;
  const out: Array<{ index: number; start: number; text: string }> = [];
  // Keep original offsets but omit embedded image/font bytes from language context.
  // The actual source is untouched, so exact edits preserve all embedded resources.
  let cursor=0;
  const append=(end:number)=>{for(let start=cursor;start<end;start+=size)out.push({index:out.length,start,text:text.slice(start,Math.min(start+size,end))});};
  for(const match of text.matchAll(/data:[^\s"'<>]{1,120};base64,[A-Za-z0-9+/=\r\n]{256,}/g)){
    append(match.index);cursor=match.index+match[0].length;
  }
  append(text.length);
  // Exact source identity prevents stale offsets after an edit; bounded memory avoids retaining
  // every historical artifact during a long campaign. Huge artifacts are deliberately not cached.
  if (text.length <= 2_000_000) {
    while (cachedChars + text.length > 8_000_000 && chunkCache.size) {
      const oldest = chunkCache.keys().next().value!;
      cachedChars -= oldest.length * chunkCache.get(oldest)!.size;
      chunkCache.delete(oldest);
    }
    const versions = chunkCache.get(text) ?? new Map();
    versions.set(size, out); chunkCache.set(text, versions); cachedChars += text.length;
  }
  return out;
}

export function sourceRelevance(text: string | undefined, query: string) {
  if (!text) return 0;
  const tokens = normalizedTokens(query);
  return chunks(text).reduce((best, chunk) => Math.max(best, scoreChunk(chunk.text, tokens)), 0);
}

function scoreChunk(text: string, queryTokens: string[]) {
  const lower = text.toLowerCase();
  return queryTokens.reduce((score, token) => score + (lower.includes(token) ? Math.min(8, token.length) * Math.min(2, 1 + (lower.split(token).length - 1) * 0.15) : 0), 0);
}

/**
 * Long-context retrieval for repeated eval/acceptance calls. It keeps head/tail context
 * plus lexically relevant chunks from the whole artifact, so latency scales sub-linearly
 * instead of resending 100k chars for every test/candidate.
 */
export function retrieveTextContext(text: string | undefined, query: string, options?: { maxChars?: number; chunkSize?: number; maxChunks?: number }) {
  if (!text) return "";
  const maxChars = Math.max(0, Math.floor(options?.maxChars ?? 24000));
  if (!maxChars) return "";
  if (text.length <= maxChars) return text;
  const maxChunks = Math.max(1, Math.floor(options?.maxChunks ?? Math.max(3, Math.floor(maxChars / 4000))));
  // Reserve space for source offsets; never truncate a selected relevant block
  // merely because an earlier block consumed the entire budget.
  const chunkSize = Math.max(1, Math.min(options?.chunkSize ?? 4000, Math.floor(maxChars / maxChunks) - 70));
  const all = chunks(text, chunkSize);
  const queryTokens = normalizedTokens(query);
  const ranked = all.map((chunk) => ({ ...chunk, score: scoreChunk(chunk.text, queryTokens) })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Map<number, typeof ranked[number]>();
  for (const item of ranked.filter((item) => item.score > 0)) {
    if (selected.size >= maxChunks) break;
    selected.set(item.index, item);
  }
  // Head/tail are fallback context, never a replacement for matched evidence.
  for (const item of [all[0], all[all.length - 1], ...all]) {
    if (selected.size >= maxChunks) break;
    if (item && !selected.has(item.index)) selected.set(item.index, { ...item, score: 0 });
  }
  return [...selected.values()].sort((a, b) => a.index - b.index).map((item) => `[chunk ${item.index + 1}/${all.length} @${item.start}]\n${item.text}`).join("\n\n---\n\n").slice(0, maxChars);
}

export function outlineFromText(text: string | undefined, max = 80) {
  if (!text) return [];
  const headings = [...text.matchAll(/^\s{0,3}(#{1,6})\s+(.+)$/gm)].map((match) => match[2]!.trim());
  return headings.slice(0, max);
}

export function integritySignals(original: string | undefined, evolved: string | undefined) {
  const source = original ?? "";
  const target = evolved ?? "";
  const pattern = /\b(TODO|TBD|PLACEHOLDER|FIXME)\b|\[\.\.\.truncated|middle omitted|省略中间/gi;
  const sourceMarkers = source.match(pattern)?.length ?? 0;
  const targetMarkers = target.match(pattern)?.length ?? 0;
  return {
    originalLength: source.length,
    evolvedLength: target.length,
    lengthRatio: source.length ? Number((target.length / source.length).toFixed(3)) : 1,
    originalHeadings: outlineFromText(source).length,
    evolvedHeadings: outlineFromText(target).length,
    newPlaceholderMarkers: Math.max(0, targetMarkers - sourceMarkers),
    suspiciouslyShort: source.length > 1000 && target.length < source.length * 0.6,
    empty: target.trim().length < 20,
  };
}
