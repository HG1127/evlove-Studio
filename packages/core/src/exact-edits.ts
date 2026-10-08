import { TextArtifactEditsSchema, type TextArtifactEdit as TextEdit, type CandidatePatch } from "@evolution/contracts";

function preview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 54);
}

function exactRange(original: string, before: string) {
  const start = original.indexOf(before);
  return start >= 0 && original.indexOf(before, start + 1) < 0 ? { start, end: start + before.length } : undefined;
}

function normalizedLineRange(original: string, before: string) {
  const normalizedOriginal = original.replace(/\r\n?/g, "\n");
  const normalizedBefore = before.replace(/\r\n?/g, "\n");
  const start = normalizedOriginal.indexOf(normalizedBefore);
  if (start < 0 || normalizedOriginal.indexOf(normalizedBefore, start + 1) >= 0) return undefined;
  const toOriginal = (offset: number) => {
    let source = 0;
    let normalized = 0;
    while (source < original.length && normalized < offset) {
      if (original[source] === "\r" && original[source + 1] === "\n") source += 2;
      else source += 1;
      normalized += 1;
    }
    return source;
  };
  return { start: toOriginal(start), end: toOriginal(start + normalizedBefore.length) };
}

function whitespaceRange(original: string, before: string) {
  const nonWhitespaceLength = before.replace(/\s/g, "").length;
  if (nonWhitespaceLength < 16 || before.length > 8000 || !/\s/.test(before)) return undefined;
  const tokens = before.split(/\s+/).filter(Boolean);
  if (!tokens.length) return undefined;
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(escaped.join("\\s+"), "g");
  const first = pattern.exec(original);
  if (!first) return undefined;
  const second = pattern.exec(original);
  return second ? undefined : { start: first.index, end: first.index + first[0].length };
}

/**
 * Locate a unique block after removing formatting whitespace while retaining an index map
 * into the original text. This covers minified CSS/HTML anchors such as `body{margin:0}`
 * when the source is formatted as `body { margin: 0 }`. The older token matcher cannot
 * bridge whitespace added next to punctuation because the punctuation stays in the token.
 */
function compactWhitespaceRange(original: string, before: string) {
  const compactBefore = before.replace(/\s/g, "");
  if (compactBefore.length < 16 || before.length > 8000) return undefined;
  let compactOriginal = "";
  const sourceIndexes: number[] = [];
  for (let index = 0; index < original.length; index += 1) {
    if (/\s/.test(original[index]!)) continue;
    compactOriginal += original[index];
    sourceIndexes.push(index);
  }
  const start = compactOriginal.indexOf(compactBefore);
  if (start < 0 || compactOriginal.indexOf(compactBefore, start + 1) >= 0) return undefined;
  const last = sourceIndexes[start + compactBefore.length - 1];
  if (last === undefined) return undefined;
  return { start: sourceIndexes[start]!, end: last + 1 };
}

/**
 * A model often remembers the right CSS selector but rewrites the declarations while
 * describing the desired change. In that case the whole `before` rule is not an anchor.
 * Falling back to a unique selector keeps the edit deterministic and still fails closed
 * when the stylesheet contains more than one rule for that selector.
 */
function cssSelectorRange(original: string, before: string) {
  const rule = before.trim().match(/^([^{}]+)\{[^{}]*\}\s*$/s);
  if (!rule) return undefined;
  const selector = rule[1]!.trim();
  if (!selector || selector.length > 240 || /[;<>]/.test(selector)) return undefined;
  const selectorPattern = selector
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const pattern = new RegExp(`(^|}|<style\\b[^>]*>)(\\s*)(${selectorPattern}\\s*\\{[^{}]*\\})`, "gim");
  const matches = [...original.matchAll(pattern)];
  if (matches.length !== 1 || matches[0]?.index === undefined) return undefined;
  const prefixLength = (matches[0][1]?.length ?? 0) + (matches[0][2]?.length ?? 0);
  const matchedRule = matches[0][3];
  if (!matchedRule) return undefined;
  const start = matches[0].index + prefixLength;
  return { start, end: start + matchedRule.length };
}

function locateEdit(original: string, edit: TextEdit, index: number, strict: boolean) {
  if (typeof edit.before !== "string" || !edit.before || typeof edit.after !== "string") throw new Error(`第 ${index + 1} 处修改锚点为空`);
  if (Number.isInteger(edit.start) && Number.isInteger(edit.end) && edit.start! >= 0 && edit.end! > edit.start! && edit.end! <= original.length) {
    const selected = original.slice(edit.start, edit.end);
    if (selected === edit.before || selected.replace(/\r\n?/g, "\n") === edit.before.replace(/\r\n?/g, "\n")) return { start: edit.start!, end: edit.end! };
  }
  const range = exactRange(original, edit.before)
    ?? normalizedLineRange(original, edit.before)
    ?? (strict ? undefined : whitespaceRange(original, edit.before))
    ?? (strict ? undefined : compactWhitespaceRange(original, edit.before))
    ?? (strict ? undefined : cssSelectorRange(original, edit.before));
  if (!range) throw new Error(`第 ${index + 1} 处修改锚点缺失或不唯一：“${preview(edit.before)}”`);
  return range;
}

/**
 * Apply all edits against the same original. Exact matches remain preferred. A unique
 * line-ending/whitespace-equivalent match is accepted because structured-output models
 * commonly normalize CRLF or indentation while copying an otherwise exact source block.
 * Ambiguous and overlapping matches still fail closed.
 */
export function applyExactEdits(original: string, payload: string, options: { strict?: boolean } = {}): string {
  let raw: unknown;
  try { raw = JSON.parse(payload); }
  catch { throw new Error("候选修改不是有效的 text-edits JSON"); }
  const parsed = TextArtifactEditsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("缺少有效的可执行精确修改");
  const data = parsed.data;
  // Providers sometimes serialize a full HTML rewrite as one text edit and copy the whole
  // document into `before`. Attribute order, quote style or an omitted optional tag makes that
  // huge anchor brittle even though `after` is the intended complete artifact. Treat this one
  // unambiguous shape as a document replacement; artifact-quality validates the resulting HTML.
  const only = data.edits.length === 1 ? data.edits[0] : undefined;
  const originalIsHtmlDocument = /<!doctype\s+html|<html\b/i.test(original) && /<body\b/i.test(original) && /<\/html\s*>/i.test(original);
  const beforeTargetsDocument = Boolean(only && /^\s*(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(only.before));
  if (!options.strict && only && originalIsHtmlDocument && beforeTargetsDocument && only.after.trim()) return only.after;
  // A recovery response may narrow the same document edit to one complete CSS patch. Returning
  // that stylesheet lets repairHtmlEnvelope append it to the original document's cascade; it is
  // still rejected later if it is not valid CSS or the source is not a complete HTML document.
  const beforeTargetsStylesheet = Boolean(only && !/<(?:html|body|script)\b/i.test(only.before) && /[^{}]+\{[^{}]*\}/s.test(only.before));
  const afterIsStylesheet = Boolean(only && !/<(?:html|body|script)\b/i.test(only.after) && /[^{}]+\{[^{}]*\}/s.test(only.after));
  if (!options.strict && only && originalIsHtmlDocument && beforeTargetsStylesheet && afterIsStylesheet) return only.after;
  const edits = data.edits.map((edit, index) => {
    const range = locateEdit(original, edit, index, Boolean(options.strict));
    return {...range,after:edit.after};
  }).sort((a,b)=>a.start-b.start);
  for(let i=1;i<edits.length;i++) if(edits[i].start < edits[i-1].end) throw new Error("修改范围重叠");
  let result=original;
  for(const edit of edits.reverse()) result=result.slice(0,edit.start)+edit.after+result.slice(edit.end);
  return result;
}


/** Use a complete planned text mutation only when every patch has a unique current anchor. */
export function buildExactCandidateTextEdits(original: string, patches: CandidatePatch[]): string | undefined {
  if (!patches.length || new Set(patches.map((patch) => patch.id)).size !== patches.length
    || patches.some((patch) => ["tool", "memory", "model"].includes(patch.component)
      || !["update", "remove"].includes(patch.operation) || !patch.target)) return undefined;
  const payload = JSON.stringify({kind: "text-edits", edits: patches.map((patch) => ({
    before: patch.target, after: patch.operation === "remove" ? "" : patch.content,
  }))});
  try {
    const result = applyExactEdits(original, payload, {strict: true});
    return result.trim() !== original.trim() ? payload : undefined;
  } catch {
    return undefined;
  }
}
