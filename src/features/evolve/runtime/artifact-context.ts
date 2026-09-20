import JSZip from "jszip";
import type { SourceArtifact } from "../schemas";
import { getArtifactBlob } from "./artifact-blob-store";
import { retrieveTextContext } from "./context-retrieval";
import { describeArtifact } from "./artifact-strategy";
import { buildRepositoryIntelligence, retrieveRepositoryEvidence, type RepositoryEntry, type RepositoryIntelligence } from "../sources/repository-intelligence";
import type { CodeFileAnalysis } from "../sources/code-analysis";

function words(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_\-./]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [])].slice(0, 80);
}
function fileScore(path: string, content: string, query: string) {
  const q = words(query);
  const hay = `${path}\n${content.slice(0, 6000)}`.toLowerCase();
  let score = q.reduce((sum, token) => sum + (hay.includes(token) ? (path.toLowerCase().includes(token) ? 5 : 1) : 0), 0);
  if (/(^|\/)(package\.json|vite\.config|tsconfig|readme|schema|contract|router|app\.|main\.|index\.)/i.test(path)) score += 4;
  if (/test|spec|e2e|playwright|vitest/i.test(path)) score += 2;
  return score;
}

async function retrieveCodebase(artifact: SourceArtifact, query: string, maxChars: number) {
  // Prefer the deep repository index produced at upload time. It contains far more files than the
  // short LLM digest and carries AST/symbol/dependency metadata.
  const structured = artifact.structuredContent as { entries?: RepositoryEntry[]; codeIndex?: { files?: CodeFileAnalysis[] }; repositoryIntelligence?: RepositoryIntelligence } | undefined;
  const indexedEntries = structured?.entries ?? [];
  const codeAnalyses = structured?.codeIndex?.files ?? [];
  if (indexedEntries.some((entry)=>Boolean(entry.content))) {
    const intelligence = structured?.repositoryIntelligence ?? buildRepositoryIntelligence({ entries:indexedEntries, codeAnalyses, totalEntries:artifact.structure.length });
    const relevant = retrieveRepositoryEvidence({ entries:indexedEntries, codeAnalyses, intelligence, query, limit:18 });
    let used=0;
    const files: Array<{ path:string; content:string; role?:string; score:number; ast?:unknown }> = [];
    for(const item of relevant){
      if(!item.content || used>=maxChars) continue;
      const budget=Math.min(10000,maxChars-used);
      const content=retrieveTextContext(item.content,query,{maxChars:budget,maxChunks:3});
      used+=content.length;
      files.push({path:item.path,content,role:item.role,score:item.score,ast:item.analysis?{imports:item.analysis.imports.slice(0,12),exports:item.analysis.exports.slice(0,12),functions:item.analysis.functions.slice(0,12),classes:item.analysis.classes.slice(0,8),jsxTags:item.analysis.jsxTags.slice(0,12),routeHints:item.analysis.routeHints.slice(0,8)}:undefined});
    }
    return { kind:"repository-context", manifest:artifact.structure.slice(0,1000), files, omittedTextFiles:Math.max(0,intelligence.deepIndexedEntries-files.length), repository:{entrypoints:intelligence.entrypoints,criticalModules:intelligence.criticalModules.slice(0,20),featureClusters:intelligence.featureClusters.slice(0,16),dependencyCoverage:intelligence.internalImports?intelligence.resolvedInternalImports/intelligence.internalImports:1,indexedSymbols:intelligence.indexedSymbols} };
  }

  // Legacy project fallback: retrieve directly from original ZIP blob when a deep index does not exist.
  const blob = await getArtifactBlob(artifact.id).catch(() => undefined);
  if (!blob) return undefined;
  const zip = await JSZip.loadAsync(blob);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !/(^|\/)(node_modules|\.git|dist|build|\.next|coverage|vendor)\//.test(entry.name));
  const manifest = entries.map((entry) => entry.name).slice(0, 1000);
  const textLike = entries.filter((entry) => /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|vue|svelte|py|go|rs|java|kt|php|sql|yaml|yml|toml|ini|sh)$/i.test(entry.name) || /(^|\/)(package\.json|tsconfig.*\.json|vite\.config\.[^.]+|README[^/]*)$/i.test(entry.name));
  const preselected = textLike.slice(0, 260);
  const loaded = await Promise.all(preselected.map(async (entry) => ({ path: entry.name, content: (await entry.async("string")).slice(0, 50000) })));
  const ranked = loaded.sort((a, b) => fileScore(b.path, b.content, query) - fileScore(a.path, a.content, query));
  const chosen: typeof ranked = [];
  let used = 0;
  for (const file of ranked) {
    const budget = Math.min(12000, maxChars - used);
    if (budget <= 0) break;
    chosen.push({ path: file.path, content: retrieveTextContext(file.content,query,{maxChars:budget,maxChunks:3}) });
    used += chosen[chosen.length-1]!.content.length;
    if (chosen.length >= 24) break;
  }
  return { kind: "legacy-codebase-context", manifest, files: chosen, omittedTextFiles: Math.max(0, textLike.length - chosen.length) };
}

export async function retrieveArtifactContext(artifact: SourceArtifact, query: string, maxChars = 32000) {
  const descriptor = artifact.artifactDescriptor ?? describeArtifact(artifact);
  if (descriptor.family === "codebase" && descriptor.subtype === "zip-repository") {
    const code = await retrieveCodebase(artifact, query, maxChars);
    if (code) return { ...code, descriptor };
  }
  const text = artifact.textContent || artifact.textExcerpt || "";
  if (descriptor.family === "presentation") {
    const slides = ((artifact.structuredContent as { slides?: Array<{ number: number; path?: string; textRuns?: Array<{ index: number; text: string }> }> } | undefined)?.slides ?? []);
    const q = words(query);
    const ranked = slides.map((slide) => ({ slide, score: q.reduce((sum, token) => sum + (slide.textRuns?.some((run) => run.text.toLowerCase().includes(token)) ? 1 : 0), 0) }))
      .sort((a, b) => b.score - a.score);
    const chosen = slides.length <= 60 ? slides : ranked.slice(0, 30).map((item) => item.slide).sort((a, b) => a.number - b.number);
    return { descriptor, kind: "presentation-context", totalSlides: slides.length, slides: chosen, overview: retrieveTextContext(text, query, { maxChars: Math.min(maxChars, 12000), maxChunks: 4 }) };
  }
  if (descriptor.family === "spreadsheet") {
    const sheets = ((artifact.structuredContent as { sheets?: Array<{ name: string; csv?: string; rows?: unknown[][]; cells?: Array<{address:string;value:unknown;formula?:string;type?:string;format?:string}> }> } | undefined)?.sheets ?? []);
    const q = words(query);
    const ranked = sheets.map((sheet) => ({ sheet, score: q.reduce((sum, token) => sum + (`${sheet.name}\n${sheet.csv ?? ""}`.toLowerCase().includes(token) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score);
    const chosen = sheets.length <= 10 ? sheets : ranked.slice(0, 8).map((item) => item.sheet);
    return { descriptor, kind: "spreadsheet-context", allSheetNames: sheets.map((sheet) => sheet.name), sheets: chosen.map((sheet) => ({ name: sheet.name, rows: sheet.rows?.slice(0, 160), cells: sheet.cells?.slice(0, 1200), csv: sheet.csv?.slice(0, 12000) })) };
  }
  if (descriptor.adapterId === "document-docx-ooxml") {
    const parts = ((artifact.structuredContent as { parts?: Array<{ path: string; textRuns?: Array<{ index: number; text: string }> }> } | undefined)?.parts ?? []);
    return { descriptor, kind: "docx-context", parts, overview: retrieveTextContext(text, query, { maxChars: Math.min(maxChars, 18000), maxChunks: 5 }) };
  }
  return { descriptor, kind: "text-context", structure: artifact.structure.slice(0, 160), context: retrieveTextContext(text, query, { maxChars, maxChunks: 8 }) };
}
