import {applyHtmlCandidatePatch,isTextArtifactExtension} from "@evolution/core";
import { applyHtmlLocalEdits } from "./html-local-edits";
import type { Candidate, CandidateArtifactSnapshot, CandidatePatch, SourceArtifact } from "../schemas";
import { applyExactEdits } from "./exact-edits";

function fingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function parsePatchValue(content: string) {
  try { return JSON.parse(content); } catch { return content; }
}

function jsonPathParts(target: string) {
  const normalized = target.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1");
  return normalized.split(".").map((item) => item.trim()).filter(Boolean);
}

function applyJsonPatch(source: string, patch: CandidatePatch) {
  let value: unknown;
  try { value = JSON.parse(source); } catch { return { text: source, applied: false, reason: "source is not JSON" }; }
  const parts = jsonPathParts(patch.target);
  if (!parts.length) return { text: source, applied: false, reason: "missing JSON path" };
  if (parts.some(part => ["__proto__", "constructor", "prototype"].includes(part))) return { text: source, applied: false, reason: "不允许修改对象原型路径" };
  let cursor: unknown = value;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const raw = parts[index]!;
    const key: string | number = /^\d+$/.test(raw) ? Number(raw) : raw;
    if (cursor == null || typeof cursor !== "object" || !Object.hasOwn(cursor, key)) return { text: source, applied: false, reason: `JSON path not found: ${patch.target}` };
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  const lastRaw = parts.at(-1)!;
  const last: string | number = /^\d+$/.test(lastRaw) ? Number(lastRaw) : lastRaw;
  if (cursor == null || typeof cursor !== "object") return { text: source, applied: false, reason: `JSON parent not found: ${patch.target}` };
  if (patch.operation === "remove") {
    if (Array.isArray(cursor) && typeof last === "number") cursor.splice(last, 1);
    else if (Object.hasOwn(cursor, last)) delete (cursor as Record<string | number, unknown>)[last];
    else return { text: source, applied: false, reason: `JSON path not found: ${patch.target}` };
  } else (cursor as Record<string | number, unknown>)[last] = parsePatchValue(patch.content);
  return { text: `${JSON.stringify(value, null, 2)}\n`, applied: true };
}

function applyExactTextPatch(source: string, patch: CandidatePatch) {
  if (patch.target === "__FULL_ARTIFACT__" && patch.operation === "update" && patch.content.trim()) return { text: `${patch.content.trim()}\n`, applied: true };
  const target = patch.target.trim();
  if (target.length < 4 || !source.includes(target)) return { text: source, applied: false, reason: `exact block not found: ${target}` };
  if (source.indexOf(target) !== source.lastIndexOf(target)) return { text: source, applied: false, reason: "修改位置不唯一，请提供更完整的原文定位" };
  if (patch.operation === "update") return { text: source.replace(target, patch.content.trim()), applied: true };
  if (patch.operation === "remove") return { text: source.replace(target, ""), applied: true };
  return { text: source, applied: false, reason: `unsupported exact operation: ${patch.operation}` };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Additive HTML evolution must preserve the original document shell. Previously every HTML
 * `add` fell through to an LLM full rewrite; providers often returned a valid fragment, which
 * was then rejected for lacking html/body. Injecting the addition before </body> is lossless,
 * deterministic and keeps scripts/styles/metadata that were outside the model context.
 */
function applyHtmlAddPatch(source: string, patch: CandidatePatch) {
  const anchored=applyHtmlCandidatePatch(source,patch);
  if(anchored!==undefined)return {text:anchored,applied:true};
  // A selector expresses a local boundary; never move a missing/ambiguous target to the body.
  if(patch.target.trim().startsWith("#"))return {text:source,applied:false,reason:"HTML target or complete replacement is not unique"};
  if (patch.operation !== "add") return { text: source, applied: false, reason: "not an HTML add" };
  if (!/<html\b/i.test(source) || !/<body\b/i.test(source) || !/<\/body\s*>/i.test(source) || !/<\/html\s*>/i.test(source)) {
    return { text: source, applied: false, reason: "source is not a complete HTML document" };
  }
  let content = patch.content.trim();
  if (!content) return { text: source, applied: false, reason: "empty HTML addition" };
  // Accept a full document from the planner as an addition, but insert only its body so the
  // original document remains the source of truth for head assets and protected behavior.
  const body = content.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1]?.trim();
  if (body) content = body;
  const looksMarkup = /^\s*<(?:!--|[a-z][\w:-]*\b)/i.test(content);
  const addition = looksMarkup
    ? content
    : `<section data-evolve-addition="true"><h2>${escapeHtml(patch.target || "新增内容")}</h2><div style="white-space:pre-wrap">${escapeHtml(content)}</div></section>`;
  if (source.includes(addition)) return { text: source, applied: false, reason: "HTML addition already exists" };
  return { text: source.replace(/<\/body\s*>/i, `\n${addition}\n</body>`), applied: true };
}

function appendCssToHtml(source: string, css: string) {
  if (!css.trim() || source.includes(css.trim())) return source;
  const addition = `\n/* Evolve targeted CSS repair */\n${css.trim()}\n`;
  const styleClosers = [...source.matchAll(/<\/style\s*>/gi)];
  const close = styleClosers.at(-1);
  if (close?.index !== undefined) return `${source.slice(0, close.index)}${addition}${source.slice(close.index)}`;
  if (/<\/head\s*>/i.test(source)) return source.replace(/<\/head\s*>/i, `<style>${addition}</style>\n</head>`);
  return source;
}

function replaceUniqueElement(source: string, fragment: string, tag: string, id?: string) {
  const idLookahead = id ? `(?=[^>]*\\bid=["']${escapeRegExp(id)}["'])` : "";
  const pattern = new RegExp(`<${tag}\\b${idLookahead}[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || matches[0]?.index === undefined) return undefined;
  const match = matches[0];
  return `${source.slice(0, match.index)}${fragment}${source.slice(match.index + match[0].length)}`;
}

/** Recover a runnable document while preserving untouched source structure. */
export function repairHtmlEnvelope(source: string, output: string) {
  let content = output.trim();
  const fenced = content.match(/^```(?:html?|css)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) content = fenced[1]!.trim();
  const hasHtml = /<html\b/i.test(content);
  const hasBody = /<body\b/i.test(content);
  if (hasHtml && hasBody) {
    if (!/<\/body\s*>/i.test(content)) content = /<\/html\s*>/i.test(content) ? content.replace(/<\/html\s*>/i, "</body></html>") : `${content}</body>`;
    if (!/<\/html\s*>/i.test(content)) content += "</html>";
    return content;
  }
  if (!hasBody) {
    // A targeted recovery may correctly return only the repaired stylesheet. Keep the
    // original runnable document and append the CSS at the end of its style cascade.
    // Markup fragments are handled below with structure-aware replacement/merge.
    const styleWrapped = content.match(/^<style\b[^>]*>([\s\S]*?)<\/style\s*>$/i)?.[1]?.trim();
    const css = styleWrapped ?? content;
    const looksLikeCss = css.length >= 8
      && /[^{}]+\{[^{}]*\}/s.test(css)
      && (styleWrapped !== undefined || !/<[a-z][\w:-]*\b/i.test(content))
      && !/<\/?(?:html|head|body|script|iframe|object)\b/i.test(css);
    const sourceIsComplete = /<html\b/i.test(source) && /<body\b/i.test(source) && /<\/body\s*>/i.test(source) && /<\/html\s*>/i.test(source);
    if (looksLikeCss && sourceIsComplete) {
      return appendCssToHtml(source, css);
    }
    if (!sourceIsComplete || !/<[a-z][\w:-]*\b[^>]*>/i.test(content)) return output;

    // Keep the original head as the source of truth. Styles returned with a fragment are
    // appended last so they can implement the intended visual change without dropping assets.
    const styleBlocks = [...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
    const merged = styleBlocks.reduce((html, match) => appendCssToHtml(html, match[1] ?? ""), source);
    const fragment = content
      .replace(/<!doctype\s+html[^>]*>/gi, "")
      .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
      .replace(/<\/?html\b[^>]*>/gi, "")
      .trim();
    if (!fragment) return merged;

    // A returned <main> is a clear replacement boundary and avoids duplicating the page.
    const main = fragment.match(/<main\b[^>]*>[\s\S]*?<\/main\s*>/i)?.[0];
    if (main) {
      const replaced = replaceUniqueElement(merged, main, "main");
      if (replaced) return replaced;
    }
    // A fragment carrying an id can replace that exact source block when it is unique.
    const identified = fragment.match(/^\s*<([a-z][\w:-]*)\b[^>]*\bid=["']([^"']+)["'][^>]*>[\s\S]*<\/\1\s*>\s*$/i);
    if (identified) {
      const replaced = replaceUniqueElement(merged, identified[0].trim(), identified[1]!, identified[2]!);
      if (replaced) return replaced;
    }
    // Header/nav/main/footer together represent a complete body proposal; otherwise preserve
    // the existing body and merge the local fragment as an additive improvement.
    const landmarks = ["header", "nav", "main", "footer"].filter((tag) => new RegExp(`<${tag}\\b`, "i").test(fragment)).length;
    if (landmarks >= 2) return merged.replace(/(<body\b[^>]*>)[\s\S]*?(<\/body\s*>)/i, `$1\n${fragment}\n$2`);
    return merged.replace(/<\/body\s*>/i, `\n${fragment}\n</body>`);
  }
  const bodyMatch = content.match(/(<body\b[^>]*>)([\s\S]*?)(?:<\/body\s*>)?$/i);
  if (!bodyMatch) return output;
  const originalDoctype = source.match(/<!doctype\s+html[^>]*>/i)?.[0] ?? "<!doctype html>";
  const originalHtml = source.match(/<html\b[^>]*>/i)?.[0] ?? "<html>";
  const head = content.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0]
    ?? source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0]
    ?? "<head></head>";
  return `${originalDoctype}\n${originalHtml}${head}${bodyMatch[1]}${bodyMatch[2]}</body></html>`;
}

type CandidateArtifactOutput = Pick<CandidateArtifactSnapshot, "sourceArtifactId" | "name" | "mimeType" | "content" | "buildMode" | "notes">;

function normalizedArtifactName(value: string) {
  return value.replace(/\\/g, "/").split("/").at(-1)?.trim().toLowerCase() ?? "";
}

function applyCandidateOutput(source: SourceArtifact, current: string, output: CandidateArtifactOutput) {
  const isText = isTextArtifactExtension(source.extension)||source.extension.toLowerCase()==="xhtml";
  let content = output.content;
  if (isText && /^\s*\{/.test(content)) {
    let kind: unknown;
    try { kind = (JSON.parse(content) as { kind?: unknown }).kind; } catch { /* complete text */ }
    if (kind === "text-edits") content = applyExactEdits(current, content);
    if (kind === "html-edits" && /^(html?|xhtml)$/i.test(source.extension)) content = applyHtmlLocalEdits(current, content);
  }
  if (/^(html?|xhtml)$/i.test(source.extension)) content = repairHtmlEnvelope(current, content);
  return content;
}

/**
 * Providers sometimes return several local edits for one target, or echo a display name
 * instead of its source id. Convert that variable output into exactly one complete snapshot
 * per target before the strict artifact gate runs. Unchanged targets are retained so a
 * partial multi-file proposal can still be evaluated honestly rather than being fabricated.
 */
export function normalizeCandidateArtifactOutputs(targets: SourceArtifact[], outputs: CandidateArtifactOutput[]): CandidateArtifactOutput[] {
  const grouped = new Map<string, CandidateArtifactOutput[]>();
  const targetNames = new Map(targets.map((target) => [normalizedArtifactName(target.name), target]));
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]!;
    let target = targets.find((item) => item.id === output.sourceArtifactId);
    if (!target) target = targetNames.get(normalizedArtifactName(output.name));
    if (!target && targets.length === 1) target = targets[0];
    if (!target && outputs.length === targets.length) target = targets[index];
    if (!target) throw new Error(`生成结果“${output.name || output.sourceArtifactId}”无法对应任何进化对象。`);
    grouped.set(target.id, [...(grouped.get(target.id) ?? []), output]);
  }

  return targets.map((target) => {
    const parts = grouped.get(target.id) ?? [];
    if (!parts.length) {
      if (target.textContent === undefined) throw new Error(`${target.name} 没有生成结果，且原始内容不可用于完整保留。`);
      return {
        sourceArtifactId: target.id,
        name: target.name,
        mimeType: target.mimeType,
        content: target.textContent,
        buildMode: "deterministic",
        notes: ["本轮没有针对该文件的有效修改；完整保留原文件，交由对照评测判断。"],
      };
    }
    let content = target.textContent ?? parts[0]!.content;
    for (const part of parts) content = applyCandidateOutput(target, content, part);
    const last = parts.at(-1)!;
    return {
      ...last,
      sourceArtifactId: target.id,
      name: target.name,
      mimeType: target.mimeType,
      content,
      notes: [
        ...parts.flatMap((part) => part.notes),
        ...(parts.length > 1 ? [`已将模型返回的 ${parts.length} 段局部修改按顺序归并为一份完整成果。`] : []),
      ],
    };
  });
}


function applyHeadingPatch(source: string, patch: CandidatePatch) {
  const target = patch.target.trim();
  const content = patch.content.trim();
  if (!target && patch.operation !== "add") return { text: source, applied: false, reason: "missing target" };
  const headingPattern = new RegExp(`(^|\\n)(#{1,6}\\s+${escapeRegExp(target)}\\s*\\n)([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`, "i");
  if (patch.operation === "update") {
    if (!headingPattern.test(source)) return { text: source, applied: false, reason: `heading not found: ${target}` };
    return { text: source.replace(headingPattern, (_match, prefix, heading) => `${prefix}${heading}${content}\n`), applied: true };
  }
  if (patch.operation === "remove") {
    if (!headingPattern.test(source)) return { text: source, applied: false, reason: `heading not found: ${target}` };
    return { text: source.replace(headingPattern, "$1"), applied: true };
  }
  if (patch.operation === "add") {
    const level = source.match(/^#{1,6}\s+/m)?.[0]?.trim().length ?? 2;
    const heading = `${"#".repeat(Math.min(6, Math.max(1, level)))} ${target || "Evolve Enhancement"}`;
    return { text: `${source.replace(/\s+$/, "")}\n\n${heading}\n\n${content}\n`, applied: true };
  }
  return { text: source, applied: false, reason: `unsupported operation: ${patch.operation}` };
}


function normalizePatchPath(target: string) {
  return target.trim().replace(/^`|`$/g, "").replace(/^file:\/\//i, "").replace(/^\.\//, "").replace(/^path\s*[:=]\s*/i, "");
}

function buildStructuredZipOverlay(candidate: Candidate, artifact: SourceArtifact) {
  const adapter = artifact.artifactDescriptor?.adapterId ?? "";
  if (!["codebase-zip-repository", "package-zip-generic"].includes(adapter)) return undefined;
  const structured = artifact.structuredContent as { manifest?: string[]; entries?: Array<{ path?: string; content?: string }> } | undefined;
  const manifest = structured?.manifest ?? artifact.structure ?? [];
  if (!manifest.length) return undefined;
  const manifestSet = new Set(manifest);
  const byBasename = new Map<string, string[]>();
  for (const path of manifest) {
    const base = path.split("/").pop() ?? path;
    byBasename.set(base, [...(byBasename.get(base) ?? []), path]);
  }
  const changedFiles: Array<{ path: string; content: string }> = [];
  const notes: string[] = [];
  const patches = candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === artifact.id);
  for (const patch of patches) {
    if (["tool", "memory", "model"].includes(patch.component)) { notes.push(`${patch.component}: ${patch.target} 作为 runtime mutation 保留`); continue; }
    if (patch.operation !== "update" && patch.operation !== "add") return undefined;
    let path = normalizePatchPath(patch.target);
    if (!manifestSet.has(path)) {
      const matches = byBasename.get(path) ?? manifest.filter((item) => item.endsWith(`/${path}`));
      if (matches.length === 1) path = matches[0]!;
      else return undefined;
    }
    if (!patch.content.trim() || patch.content.trim().length < 12) return undefined;
    changedFiles.push({ path, content: patch.content });
  }
  if (!changedFiles.length) return undefined;
  const kind = adapter === "codebase-zip-repository" ? "codebase" : "package";
  const content = JSON.stringify({ kind, overlay: true, files: changedFiles }, null, 2);
  return {
    snapshot: {
      id: `candidate-overlay-${candidate.id}-${artifact.id}-${Date.now()}`,
      sourceArtifactId: artifact.id,
      name: artifact.name,
      mimeType: artifact.mimeType,
      content,
      contentHash: fingerprint(content),
      buildMode: "deterministic" as const,
      notes: ["V2.8 ZIP overlay fast-path：只保存真正修改的文件；运行/交付时以原 ZIP 为基底合并这些文件，未修改条目保持原样。", ...notes],
      createdAt: new Date().toISOString(),
    },
    summary: `${artifact.name}: 本地构建 ${changedFiles.length} 个文件级 overlay，跳过 AI 全工程重写。`,
  };
}

/**
 * Fast path: plans are instructed to target exact Markdown headings and provide FULL
 * replacement section bodies. Applying those patches locally is both faster and safer
 * than asking an LLM to rewrite the whole artifact for every candidate.
 */
export function buildCandidateDeterministically(candidate: Candidate, targets: SourceArtifact[]): { snapshots: CandidateArtifactSnapshot[]; summary: string } | undefined {
  if (!targets.length) return undefined;
  const snapshots: CandidateArtifactSnapshot[] = [];
  const notes: string[] = [];
  for (const artifact of targets) {
    const zipOverlay = buildStructuredZipOverlay(candidate, artifact);
    if (zipOverlay) { snapshots.push(zipOverlay.snapshot); notes.push(zipOverlay.summary); continue; }
    if (!artifact.textContent) return undefined;
    // Other structured/binary artifacts must keep their editable structure. Flattened extracted text
    // is only diagnostic context; do not create a fake text artifact for PPTX/DOCX/XLSX.
    const adapter = artifact.artifactDescriptor?.adapterId ?? "";
    if (adapter === "presentation-pptx-ooxml" || adapter === "document-docx-ooxml" || artifact.artifactDescriptor?.preservationMode === "external-required" || artifact.artifactKind === "spreadsheet") return undefined;
    let text = artifact.textContent!;
    const patches = candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === artifact.id);
    for (const patch of patches) {
      const isJson = /json/i.test(artifact.mimeType) || /\.json$/i.test(artifact.name);
      const jsonResult = isJson ? applyJsonPatch(text, patch) : { text, applied: false, reason: "not JSON" };
      const isHtml = /^(html?|xhtml)$/i.test(artifact.extension) || /html/i.test(artifact.mimeType);
      // An ID selector can also appear in a navigation href; replacing that occurrence corrupts markup.
      const exactResult = !jsonResult.applied && !(isHtml && patch.target.trim().startsWith("#")) ? applyExactTextPatch(text, patch) : jsonResult;
      const htmlResult = !jsonResult.applied && !exactResult.applied && isHtml ? applyHtmlAddPatch(text, patch) : exactResult;
      const isMarkdown = /\.(md|markdown)$/i.test(artifact.name) || /markdown/i.test(artifact.mimeType);
      const headingResult = !jsonResult.applied && !exactResult.applied && !htmlResult.applied && isMarkdown ? applyHeadingPatch(text, patch) : htmlResult;
      const result = jsonResult.applied ? jsonResult : exactResult.applied ? exactResult : htmlResult.applied ? htmlResult : headingResult;
      if (!result.applied) {
        // Structural tool/model/memory patches may intentionally not map into a text body.
        if (["tool", "memory", "model"].includes(patch.component)) { notes.push(`${artifact.name}: ${patch.component} patch kept as runtime mutation (${result.reason})`); continue; }
        return undefined;
      }
      text = result.text;
    }
    snapshots.push({
      id: `candidate-fast-${candidate.id}-${artifact.id}-${Date.now()}`,
      sourceArtifactId: artifact.id,
      name: artifact.name,
      mimeType: artifact.mimeType,
      content: text,
      contentHash: fingerprint(text),
      buildMode: "deterministic",
      notes: ["Deterministic fast-path：优先使用 JSON path / exact block / HTML additive merge / Markdown heading patch 在本地生成完整 Artifact，避免重复 LLM 全文重写。", ...notes],
      createdAt: new Date().toISOString(),
    });
  }
  if (snapshots.every(snapshot => snapshot.content.trim() === targets.find(target => target.id === snapshot.sourceArtifactId)?.textContent?.trim())) return undefined;
  return { snapshots, summary: `Deterministic/Overlay Artifact Builder 已生成 ${snapshots.length} 个 Candidate Snapshot；AI full rewrite 未调用。${notes.length ? ` ${notes.join("；")}` : ""}` };
}
