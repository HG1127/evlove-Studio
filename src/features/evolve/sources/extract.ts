// 浏览器版附件解析。原 Next 版依赖 Node Buffer 与 pdf-parse（仅 Node 可用）；
// 这里在 Vite/浏览器下等价实现：Buffer → Uint8Array，PDF 改用 pdfjs-dist（worker 文件
// 已按同版本复制到 public/pdf.worker.min.mjs，用相对路径加载以适配预览代理）。
//
// 教训记录：旧版用 `mime.includes("xml")` 判断文本，而 docx/xlsx/pptx 的标准 MIME
// （application/vnd.openxmlformats-…）本身含 "xml" 子串，导致 Office 文件被当纯文本
// 解码成乱码、专用解析器永远不生效。现在改为「二进制扩展名白名单排除 + 魔数嗅探」，
// 以文件真实内容为准。
import type { JSZipObject } from "jszip";
import type * as XLSX from "xlsx";
import { describeArtifact } from "../runtime/artifact-strategy";
import { analyzeCodeFile } from "./code-analysis";
import { buildRepositoryIntelligence } from "./repository-intelligence";
import { parseWithExternalGateway, type ParserGatewayConfig } from "./parser-gateway";
import type { ParsingProfile } from "../schemas";

// Office/压缩包解析库体积较大。它们属于“用户真的上传对应格式后才需要”的能力，
// 因此不随项目工作台和普通文本上传一起下载。
type JSZipConstructor = typeof import("jszip");
let zipModule: Promise<JSZipConstructor> | undefined;
let mammothModule: Promise<typeof import("mammoth")> | undefined;
let spreadsheetModule: Promise<typeof import("xlsx")> | undefined;
function loadZip() {
  return zipModule ??= import("jszip").then((module) => {
    const compatible = module as unknown as { default?: JSZipConstructor };
    return (compatible.default ?? module) as JSZipConstructor;
  });
}
function loadMammoth() { return mammothModule ??= import("mammoth"); }
async function loadSpreadsheet() { return await (spreadsheetModule ??= import("xlsx")); }

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "mdx", "json", "jsonl", "csv", "tsv", "html", "htm", "xml", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "go", "java", "kt", "kts", "rs", "rb", "php", "css", "scss", "less",
  "sql", "graphql", "gql", "sh", "bash", "zsh", "env", "toml", "ini", "conf", "log", "vue", "svelte", "svg", "rtf",
]);
// 必须走专用解析器（或无法解析）的二进制格式，优先级高于 MIME 子串猜测。
const BINARY_EXTENSIONS = new Set([
  "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp", "zip", "pdf",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "heic", "avif", "tiff",
  "mp3", "wav", "ogg", "m4a", "mp4", "mov", "avi", "webm",
  "exe", "dmg", "bin", "ttf", "otf", "woff", "woff2", "class", "jar", "so", "dll", "pyc",
]);
const MAX_EXTRACTED_CHARS = 120000;
// V2.7 separates "deep repository index" from the short context sent to an LLM.
// A large repo can therefore be fully indexed without pretending that a 100k prompt == 100% parsing coverage.
const MAX_ZIP_INDEX_FILES = 600;
const MAX_ZIP_INDEX_TOTAL_CHARS = 4_000_000;
const MAX_ZIP_INDEX_FILE_CHARS = 120_000;
const MAX_ZIP_SUMMARY_FILES = 28;
const MAX_ZIP_SUMMARY_CHARS = 105_000;
const MAX_ZIP_OFFICE_FILES = 24;

export type SourceBuffer = Uint8Array;

function ext(name: string) {
  const value = name.split(".").pop()?.toLowerCase();
  return value && value !== name.toLowerCase() ? value : "";
}

function truncate(text: string, max = MAX_EXTRACTED_CHARS) {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n\n[...truncated by Evolve Studio...]`, truncated: true };
}

function looksText(name: string, mime: string) {
  const extension = ext(name);
  // 扩展名声明是已知二进制格式时，绝不能按文本解码（docx 的 MIME 含 "xml" 就是历史踩坑点）。
  if (BINARY_EXTENSIONS.has(extension)) return false;
  if (TEXT_EXTENSIONS.has(extension)) return true;
  if (mime.startsWith("text/")) return true;
  // 精确的 JSON/XML MIME；不用 includes，避免 openxmlformats 这类误判。
  if (mime === "application/json" || mime.endsWith("+json")) return true;
  if (mime === "application/xml" || mime === "text/xml" || mime.endsWith("+xml")) return true;
  if (mime === "application/javascript" || mime === "text/javascript" || mime === "application/ecmascript") return true;
  return false;
}

function toArrayBuffer(buffer: SourceBuffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** 读取文件头部字节做魔数嗅探，扩展名骗不了它。 */
function magicOf(buffer: SourceBuffer) {
  const head = buffer.slice(0, Math.min(8, buffer.length));
  const hex = Array.from(head, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex.startsWith("504b0304") || hex.startsWith("504b0506")) return "zip";
  if (hex.startsWith("d0cf11e0")) return "ole";
  if (hex.startsWith("25504446")) return "pdf";
  if (hex.startsWith("ffd8ff")) return "image";
  if (hex.startsWith("89504e47")) return "image";
  if (hex.startsWith("47494638")) return "image";
  return "unknown";
}

function headText(buffer: SourceBuffer, bytes = 256) {
  // 只嗅探文本时按 latin1 读头部再剥 BOM/空白，避免全量解码。
  return new TextDecoder("windows-1252")
    .decode(buffer.slice(0, bytes))
    .replace(/^\uFEFF+/, "")
    .trimStart()
    .toLowerCase();
}

/** 老版 Office（.doc/.xls/.ppt）是 OLE 复合文档，浏览器无法可靠还原排版；做保守的可打印片段抽取兜底。 */
function heuristicOleText(buffer: SourceBuffer) {
  const runs: string[] = [];
  const decoders: Array<[string, TextDecoder]> = [
    ["cp1252", new TextDecoder("windows-1252")],
    ["utf16le", new TextDecoder("utf-16le")],
  ];
  for (const [, decoder] of decoders) {
    const decoded = decoder.decode(buffer);
    for (const match of decoded.matchAll(/[\x20-\x7e]{12,}/g)) runs.push(match[0].trim());
  }
  const unique = [...new Set(runs)].filter((run) => /[a-z]{3}/i.test(run) && !/^(Times New Roman|Calibri|Arial|Normal|Microsoft|Root Entry|WordDocument|SummaryInformation|DataStream|WpsCustomData)/i.test(run));
  return unique.join("\n").slice(0, 20000);
}

/** 从 WordprocessingML 正文里抽纯文本（mammoth 失败或不可用时的兜底路径）。 */
function wordXmlToText(xml: string) {
  return xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

let pdfWorkerConfigured = false;
let sourceBaseUrl: string | undefined;
let pdfTextBridge: ((buffer: SourceBuffer) => Promise<string>) | undefined;
export function setPdfTextBridge(bridge: (buffer: SourceBuffer) => Promise<string>) { pdfTextBridge = bridge; }
async function extractPdf(buffer: SourceBuffer) {
  return pdfTextBridge ? pdfTextBridge(buffer) : extractPdfText(buffer);
}
export async function extractPdfText(buffer: SourceBuffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfWorkerConfigured) {
    // 相对当前页面解析（随预览前缀走），避免根绝对路径跳出应用作用域。
    // 升级 pdfjs-dist 时需同步复制 public/pdf.worker.min.mjs，保持与主库同版本。
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", sourceBaseUrl ?? document.baseURI).href;
    pdfWorkerConfigured = true;
  }
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n");
}

function xmlUnescape(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))).replace(/&amp;/g, "&");
}

function artifactKindFrom(name: string, mime: string, structure: string[] = [], text = "") {
  const extension = ext(name);
  const sample = text.slice(0, 24000);
  if (["ppt", "pptx", "odp"].includes(extension) || mime.includes("presentation")) return "presentation" as const;
  if (["xls", "xlsx", "ods", "csv", "tsv"].includes(extension) || mime.includes("spreadsheet") || mime.includes("excel")) return "spreadsheet" as const;
  if (extension === "zip") {
    const lowerPaths = structure.map((item)=>item.toLowerCase());
    const hasManifest = lowerPaths.some((item)=>/(^|\/)(package\.json|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml)$/.test(item));
    const hasSourceTree = lowerPaths.some((item)=>/(^|\/)(src|app|lib)\//.test(item));
    const codeFiles = lowerPaths.filter((item)=>/\.(ts|tsx|js|jsx|py|go|rs|java|kt|php|vue|svelte|sql)$/.test(item)).length;
    // A ZIP is only a physical container. Never call it a codebase because it merely has a
    // folder named “components”. Require a real project manifest or a meaningful source tree.
    if (hasManifest || (hasSourceTree && codeFiles >= 3) || codeFiles >= 12) return "codebase" as const;
  }
  if (["js","jsx","ts","tsx","py","go","rs","java","kt","php","sql","vue","svelte"].includes(extension)) return "codebase" as const;
  if (["json","yaml","yml"].includes(extension) && (/workflow|dag|node|edge|pipeline|state/i.test(name) || /["']?(nodes|edges|steps|states|transitions|workflow|pipeline|retry|fallback)["']?\s*[:=]/i.test(sample))) return "workflow" as const;
  if (/prompt|system[-_ ]?instruction|assistant[-_ ]?instruction/i.test(name) || (["txt","md","json","yaml","yml"].includes(extension) && /(?:^|\n)\s*(system|role|instructions?|输出格式|禁止事项|你是|you are)\s*[:：]/i.test(sample))) return "prompt" as const;
  if (/knowledge|knowledgebase|knowledge-base|kb|corpus|语料|知识库/i.test(name)) return "knowledge" as const;
  if (["doc","docx","odt","pdf","rtf","md","mdx","txt","html","htm"].includes(extension)) return "document" as const;
  if (mime.startsWith("image/")) return "image" as const;
  if (mime.startsWith("audio/") || mime.startsWith("video/") || ["mp3","wav","ogg","m4a","mp4","mov","avi","webm"].includes(extension)) return "media" as const;
  return "generic" as const;
}

function zipEntryFamily(path: string) {
  const extension = ext(path);
  if (["pptx","ppt","odp"].includes(extension)) return "presentation";
  if (["xlsx","xls","ods","csv","tsv"].includes(extension)) return "spreadsheet";
  if (["docx","doc","odt","pdf","rtf","md","txt"].includes(extension)) return "document";
  if (["ts","tsx","js","jsx","py","go","rs","java","kt","php","vue","svelte","sql"].includes(extension)) return "code";
  if (["json","yaml","yml"].includes(extension)) return "structured-data";
  if (["png","jpg","jpeg","gif","webp","svg"].includes(extension)) return "image";
  if (["mp4","mov","avi","webm","mp3","wav","m4a"].includes(extension)) return "media";
  if (extension === "zip") return "package";
  return "file";
}

function zipEntryRole(path: string) {
  const lower = path.toLowerCase();
  if (/(^|\/)(tests?|e2e|fixtures?|__tests__)(\/|$)|\.(test|spec)\.[^.]+$|test-results|playwright-report/.test(lower)) return "test-evidence";
  if (/(^|\/)docs?\/(release|reference|examples?|fixtures?)(\/|$)/.test(lower)) return "reference-evidence";
  if (/(^|\/)(readme(?:\.[^/]+)?|package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml)$/.test(lower)) return "configuration";
  if (/(^|\/)(src|app|lib|components|features|pages|routes)(\/|$)/.test(lower)) return "implementation";
  if (/(^|\/)docs?\//.test(lower)) return "documentation";
  return "content";
}

async function extractZipContainer(buffer: SourceBuffer) {
  const JSZip = await loadZip();
  const zip = await JSZip.loadAsync(buffer);
  const allEntries = (Object.values(zip.files) as JSZipObject[]).filter((entry) => !entry.dir);
  const manifest = allEntries.slice(0, 5000).map((entry) => entry.name);
  const ignored = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|vendor|target|\.cache|__pycache__)\//;
  const priority = (path: string) => {
    const lower = path.toLowerCase();
    let score = 0;
    if (/(^|\/)(package\.json|readme(?:\.[^/]+)?|tsconfig[^/]*\.json|vite\.config\.|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml)/.test(lower)) score += 90;
    if (/(^|\/)(src|app|lib|components|features|pages|routes)\//.test(lower)) score += 55;
    if (/semantic|workflow|artifact|schema|runtime|adapter|router|acceptance|eval|source|parser|input|composer|stage|project-studio|provider|model/i.test(lower)) score += 35;
    if (/docs?\//.test(lower)) score += 8;
    // Tests/fixtures stay indexed as evidence, but should not define the business object or dominate LLM context.
    if (/(^|\/)(tests?|e2e|fixtures?|__tests__)(\/|$)|\.test\.|\.spec\.|test-results|playwright-report/i.test(lower)) score -= 18;
    if (/(^|\/)docs?\/(release|reference|examples?|fixtures?)(\/|$)/.test(lower)) score -= 12;
    if (ignored.test(path)) score -= 200;
    if (/\.(map|min\.js|lock|png|jpg|jpeg|gif|woff2?|ttf|otf)$/i.test(lower)) score -= 30;
    return score;
  };
  const sorted = [...allEntries].filter((entry) => !ignored.test(entry.name)).sort((a,b)=>priority(b.name)-priority(a.name) || a.name.localeCompare(b.name));

  // Deep index: read many text/code files into a structured repository index. This content is NOT
  // concatenated into one huge prompt; later retrieval selects only requirement-relevant modules.
  const textEntries = sorted.filter((entry) => looksText(entry.name, "")).slice(0, MAX_ZIP_INDEX_FILES);
  const structuredFiles: Array<{ path: string; content: string; priority: number; role: string; family: string; analysis?: ReturnType<typeof analyzeCodeFile> }> = [];
  let indexedChars = 0;
  for (const entry of textEntries) {
    if (indexedChars >= MAX_ZIP_INDEX_TOTAL_CHARS) break;
    try {
      const raw = await entry.async("string");
      const allowance = Math.min(MAX_ZIP_INDEX_FILE_CHARS, MAX_ZIP_INDEX_TOTAL_CHARS - indexedChars);
      const content = raw.slice(0, allowance);
      indexedChars += content.length;
      const family = zipEntryFamily(entry.name);
      const analysis = family === "code" ? analyzeCodeFile(entry.name, content) : undefined;
      structuredFiles.push({ path: entry.name, content, priority: priority(entry.name), role: zipEntryRole(entry.name), family, analysis });
    } catch {
      // A single corrupt text entry must not collapse the repository index.
    }
  }

  // A ZIP may be a financing package, training package, policy bundle, etc. Parse embedded Office/PDF
  // documents as semantic children instead of letting filenames alone define the package.
  const nestedDocs: Array<{ path: string; family: string; text?: string; structure?: string[]; structuredContent?: unknown; error?: string }> = [];
  const officeEntries = sorted.filter((entry) => ["presentation","spreadsheet","document"].includes(zipEntryFamily(entry.name))).slice(0, MAX_ZIP_OFFICE_FILES);
  for (const entry of officeEntries) {
    const extension = ext(entry.name);
    try {
      const bytes = new Uint8Array(await entry.async("uint8array"));
      if (extension === "pptx") {
        const parsed = await extractPptx(bytes); nestedDocs.push({ path: entry.name, family: "presentation", text: parsed.text.slice(0,50000), structure: parsed.structure, structuredContent: parsed.structuredContent });
      } else if (extension === "docx") {
        const parsed = await extractDocx(bytes); nestedDocs.push({ path: entry.name, family: "document", text: parsed.text.slice(0,50000), structure: parsed.structure, structuredContent: parsed.structuredContent });
      } else if (["xlsx","xls"].includes(extension)) {
        const parsed = await extractSpreadsheet(bytes); nestedDocs.push({ path: entry.name, family: "spreadsheet", text: parsed.text.slice(0,50000), structure: parsed.structure, structuredContent: parsed.structuredContent });
      } else if (extension === "pdf") {
        const parsed = await extractPdf(bytes); nestedDocs.push({ path: entry.name, family: "document", text: parsed.slice(0,50000), structure: [] });
      }
    } catch (error) {
      nestedDocs.push({ path: entry.name, family: zipEntryFamily(entry.name), error: error instanceof Error ? error.message : String(error) });
    }
  }

  const contentByPath = new Map(structuredFiles.map((entry) => [entry.path, entry.content]));
  const nestedByPath = new Map(nestedDocs.map((entry) => [entry.path, entry]));
  const entries = manifest.map((path) => {
    const nested = nestedByPath.get(path);
    const indexed = structuredFiles.find((entry) => entry.path === path);
    return {
      path,
      family: zipEntryFamily(path),
      role: zipEntryRole(path),
      content: contentByPath.get(path) ?? nested?.text,
      sizeChars: contentByPath.get(path)?.length ?? nested?.text?.length,
      priority: indexed?.priority ?? priority(path),
      nestedStructure: nested?.structure,
    };
  });
  const inventory = entries.reduce<Record<string, number>>((acc, entry) => { acc[entry.family] = (acc[entry.family] ?? 0) + 1; return acc; }, {});
  const codeAnalyses = structuredFiles.flatMap((entry)=>entry.analysis ? [entry.analysis] : []);
  const intelligence = buildRepositoryIntelligence({ entries, codeAnalyses, totalEntries: allEntries.length });
  const parseOk = codeAnalyses.filter((analysis)=>analysis.parseOk).length;

  // Initial LLM context is only a digest. Full indexed content stays in structuredContent and is
  // retrieved per user requirement / eval case by Repository Intelligence.
  const summaryChunks: string[] = [];
  let summaryChars = 0;
  const semanticCandidates = structuredFiles.filter((entry) => !["test-evidence","reference-evidence"].includes(entry.role));
  const summaryPaths = new Set<string>([
    ...intelligence.criticalModules.slice(0, 18).map((item) => item.path),
    ...semanticCandidates.slice(0, MAX_ZIP_SUMMARY_FILES).map((item) => item.path),
  ]);
  for (const path of summaryPaths) {
    if (summaryChars >= MAX_ZIP_SUMMARY_CHARS) break;
    const indexed = structuredFiles.find((entry) => entry.path === path);
    if (!indexed?.content) continue;
    const allowance = Math.min(7000, MAX_ZIP_SUMMARY_CHARS - summaryChars);
    const content = indexed.content.slice(0, allowance);
    summaryChars += content.length;
    summaryChunks.push(`\n===== SEMANTIC FILE: ${path} =====\n${content}`);
  }
  for (const nested of nestedDocs.slice(0, 8)) {
    if (!nested.text || summaryChars >= MAX_ZIP_SUMMARY_CHARS) continue;
    const content = nested.text.slice(0, Math.min(7000, MAX_ZIP_SUMMARY_CHARS - summaryChars));
    summaryChars += content.length;
    summaryChunks.push(`\n===== EMBEDDED ${nested.family.toUpperCase()}: ${nested.path} =====\n${content}`);
  }

  const repositoryDigest = {
    totalEntries: intelligence.totalEntries,
    deepIndexedEntries: intelligence.deepIndexedEntries,
    codeFiles: intelligence.codeFiles,
    parsedCodeFiles: intelligence.parsedCodeFiles,
    indexedSymbols: intelligence.indexedSymbols,
    internalImports: intelligence.internalImports,
    resolvedInternalImports: intelligence.resolvedInternalImports,
    entrypoints: intelligence.entrypoints.slice(0,12),
    criticalModules: intelligence.criticalModules.slice(0,16).map((item) => ({ path:item.path, score:item.score, reasons:item.reasons.slice(0,3) })),
    featureClusters: intelligence.featureClusters.slice(0,12).map((item)=>({ id:item.id, files:item.paths.length })),
  };
  return {
    text: `ZIP PACKAGE MANIFEST (${allEntries.length} files):\n${manifest.join("\n")}\n\nREPOSITORY INTELLIGENCE:\n${JSON.stringify(repositoryDigest, null, 2)}\n\nRETRIEVABLE SEMANTIC DIGEST:${summaryChunks.join("\n")}`,
    structure: manifest,
    structuredContent: {
      kind: "package",
      manifest,
      entries,
      inventory,
      selectedTextFiles: structuredFiles.length,
      selectedTextChars: indexedChars,
      semanticPrimaryPaths: structuredFiles.filter((entry)=>["implementation","configuration","content","documentation"].includes(entry.role)).map((entry)=>entry.path),
      evidenceOnlyPaths: structuredFiles.filter((entry)=>["test-evidence","reference-evidence"].includes(entry.role)).map((entry)=>entry.path),
      nestedDocuments: nestedDocs,
      codeIndex: {
        files: codeAnalyses,
        importEdges: intelligence.dependencyEdges.map((edge)=>({ from:edge.from, to:edge.to ?? edge.importSpec, kind:edge.kind })),
        parseOk,
        parseFailed: codeAnalyses.length - parseOk,
      },
      repositoryIntelligence: intelligence,
      parserPolicy: "deep-index + AST/symbol/dependency graph + semantic/evidence role split + requirement-driven retrieval + nested-office",
    },
    parseStats: {
      totalEntries: allEntries.length,
      indexedEntries: manifest.length,
      parsedEntries: structuredFiles.length + nestedDocs.filter((x)=>x.text).length,
      eligibleEntries: intelligence.eligibleEntries,
      deepIndexedEntries: intelligence.deepIndexedEntries,
      codeFiles: inventory.code ?? 0,
      documentFiles: inventory.document ?? 0,
      officeFiles: (inventory.presentation ?? 0) + (inventory.spreadsheet ?? 0) + nestedDocs.filter((x)=>["presentation","spreadsheet","document"].includes(x.family)).length,
      imageFiles: inventory.image ?? 0,
      parseOkCode: parseOk,
      indexedSymbols: intelligence.indexedSymbols,
      internalImports: intelligence.internalImports,
      resolvedInternalImports: intelligence.resolvedInternalImports,
      criticalEntries: intelligence.criticalModules.length,
      inspectedCriticalEntries: intelligence.criticalModules.filter((item)=>Boolean(contentByPath.get(item.path))).length,
      selectedChars: indexedChars,
      summaryChars,
    },
  };
}

/** .docx：同时抽取可读文本与 OOXML 文本 run，后续可在原 DOCX package 上同格式物化。 */
async function extractDocx(buffer: SourceBuffer) {
  let mammothText = "";
  try { mammothText = (await (await loadMammoth()).extractRawText({ arrayBuffer: toArrayBuffer(buffer) })).value; } catch { /* OOXML 仍可继续解析 */ }
  const JSZip = await loadZip();
  const zip = await JSZip.loadAsync(buffer);
  const paths = ["word/document.xml", ...Object.keys(zip.files).filter((name) => /^word\/(footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name))];
  const parts: Array<{ path: string; textRuns: Array<{ index: number; text: string }> }> = [];
  const chunks: string[] = [];
  for (const path of paths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = await entry.async("string");
    const runs = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match, index) => ({ index, text: xmlUnescape(match[1] ?? "") }));
    if (runs.length) parts.push({ path, textRuns: runs });
    const text = path === "word/document.xml" ? wordXmlToText(xml) : runs.map((run) => run.text).join(" ").trim();
    if (text) chunks.push(`${path === "word/document.xml" ? "===== DOCUMENT =====" : `===== ${path} =====`}\n${text}`);
  }
  const fallback = chunks.join("\n\n");
  const text = mammothText.trim() || fallback;
  if (!text.trim()) throw new Error("docx 中未找到可解析的正文内容");
  return { text, structure: parts.map((part) => part.path), structuredContent: { kind: "document", subtype: "docx", parts }, viaFallback: !mammothText.trim() };
}

/** .pptx：逐页抽取文字，同时保留 slide path 与 a:t run 顺序，后续可在原 PPTX 上物化新文本。 */
async function extractPptx(buffer: SourceBuffer) {
  const JSZip = await loadZip();
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const chunks: string[] = [];
  const structuredSlides: Array<{ number: number; path: string; textRuns: Array<{ index: number; text: string }> }> = [];
  for (const name of slides) {
    const xml = await zip.file(name)!.async("string");
    const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match,index)=>({ index, text: xmlUnescape(match[1] ?? "") }));
    const number = Number(name.match(/slide(\d+)/)?.[1] ?? structuredSlides.length+1);
    structuredSlides.push({ number, path: name, textRuns: runs });
    const text = runs.map((run)=>run.text).filter(Boolean).join("\n").trim();
    if (text) chunks.push(`===== SLIDE ${number} =====\n${text}`);
  }
  return { text: chunks.join("\n\n"), structure: slides, structuredContent: { kind: "presentation", slides: structuredSlides } };
}

/** .odt/.ods/.odp：按 mimetype 区分，统一从 content.xml 抽文本。 */
async function extractOpenDocument(buffer: SourceBuffer) {
  const JSZip = await loadZip();
  const zip = await JSZip.loadAsync(buffer);
  const content = await zip.file("content.xml")?.async("string");
  if (!content) throw new Error("OpenDocument 中未找到 content.xml");
  const text = content
    .replace(/<\/text:(p|h\d|list-item|span)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text };
}

async function extractSpreadsheet(buffer: SourceBuffer) {
  const XLSX = await loadSpreadsheet();
  const workbook = XLSX.read(toArrayBuffer(buffer), { type: "array", cellFormula: true, cellStyles: true, cellDates: true, bookVBA: true });
  const sheets = workbook.SheetNames.slice(0, 20).map((name) => {
    const sheet = workbook.Sheets[name];
    const csv = sheet ? XLSX.utils.sheet_to_csv(sheet).slice(0, 24000) : "";
    const rows = sheet ? XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(sheet, { header: 1, defval: null, raw: true }).slice(0, 400) : [];
    const cells = sheet ? Object.entries(sheet)
      .filter(([address]) => !address.startsWith("!"))
      .slice(0, 5000)
      .map(([address, cell]) => {
        const value = cell as XLSX.CellObject;
        return { address, value: value.v ?? null, formula: value.f, type: value.t, format: value.z };
      }) : [];
    return { name, csv, rows, cells };
  });
  return { text: sheets.map((sheet)=>`===== SHEET: ${sheet.name} =====\n${sheet.csv}`).join("\n\n"), structure: workbook.SheetNames, structuredContent: { kind: "spreadsheet", sheets } };
}

/** RTF：控制字大量存在，剥掉 {\...} 组与控制字后剩余正文仍可读。 */
function extractRtf(text: string) {
  return text
    .replace(/\{\\\*?\\[^{}]*\}/g, " ")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?\d?/g, "\n")
    .replace(/\\[a-z]+-?\d* ?/gi, " ")
    .replace(/[{}]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 对未识别内容尝试文本解码：乱码占比过高则判定为二进制，避免把垃圾喂给 AI。 */
function tryDecodeText(buffer: SourceBuffer) {
  // 先按 UTF-8：乱码表现为 U+FFFD 替换符，中文等文本走这条能保住原文。
  const utf8 = new TextDecoder().decode(buffer);
  const sample = utf8.slice(0, 4000);
  // eslint-disable-next-line no-control-regex -- 刻意用控制字符占比判断二进制内容
  const bad = (sample.match(/[\uFFFD]|[\x00-\x08\x0B\x0C\x0E-\x1F]/g) ?? []).length;
  if (sample && bad / sample.length <= 0.1) return utf8;
  // 再按 latin1：无 BOM 的 latin1 文本控制字符少；控制字符多则是二进制。
  const latin = new TextDecoder("windows-1252").decode(buffer);
  const latinSample = latin.slice(0, 4000);
  // eslint-disable-next-line no-control-regex -- 同上：控制字符占比即二进制信号
  const control = (latinSample.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) ?? []).length;
  if (!latinSample || control / latinSample.length > 0.15) return undefined;
  return latin;
}

/** 上传前按扩展名/MIME 预判能否解析，让用户在选择文件时就看到风险，而不是解析完才知道。 */
export function assessFileReadiness(name: string, mime: string): { level: "ok" | "caution" | "blocked"; note: string } {
  const extension = ext(name);
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].includes(extension)) {
    return { level: "ok", note: "图片可进入视觉理解；同格式视觉重绘需要图像 Renderer 插件" };
  }
  if (mime.startsWith("audio/") || mime.startsWith("video/") || ["mp3","wav","ogg","m4a","mp4","mov","avi","webm"].includes(extension)) {
    return { level: "caution", note: "已识别为音视频成果；可建立专属验收标准，但转写/剪辑/同格式导出需要媒体 Renderer 插件" };
  }
  if (extension === "doc" || extension === "ppt" || extension === "xls") {
    return { level: "caution", note: "老版 Office 二进制格式，只能尽量抽取文字，建议先另存为 docx / pptx / xlsx" };
  }
  if (looksText(name, mime)) return { level: "ok", note: "" };
  if (["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "zip"].includes(extension) || mime.includes("openxmlformats") || mime.includes("opendocument") || mime === "application/pdf") {
    return { level: "ok", note: "" };
  }
  if (BINARY_EXTENSIONS.has(extension)) return { level: "blocked", note: "该格式无法读取内容，只会保存文件信息；可补充文字说明或转成文本格式" };
  return { level: "ok", note: "" };
}

export async function extractSource(args: { name: string; mimeType: string; buffer: SourceBuffer; baseUrl?: string; parserConfig?: ParserGatewayConfig }) {
  sourceBaseUrl = args.baseUrl;
  const { name, mimeType, buffer } = args;
  const extension = ext(name);
  const warnings: string[] = [];
  // Start optional remote enrichment immediately, but do not make the local parser wait for the
  // network before it can begin. Both paths run in parallel and are merged after native parsing.
  const externalPromise = parseWithExternalGateway({ name, mimeType, buffer }, args.parserConfig);
  let text = "";
  let structure: string[] = [];
  let structuredContent: unknown;
  let zipParseStats: { totalEntries:number; indexedEntries:number; parsedEntries:number; eligibleEntries:number; deepIndexedEntries:number; codeFiles:number; documentFiles:number; officeFiles:number; imageFiles:number; parseOkCode:number; indexedSymbols:number; internalImports:number; resolvedInternalImports:number; criticalEntries:number; inspectedCriticalEntries:number; selectedChars:number; summaryChars:number } | undefined;
  const magic = magicOf(buffer);
  const isOfficeByExt = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(extension);
  const looksOfficeMime = mimeType.includes("openxmlformats") || mimeType === "application/msword" || mimeType.includes("excel") || mimeType.includes("presentationml") || mimeType.includes("msword");

  if (isOfficeByExt || looksOfficeMime) {
    // 以扩展名/MIME 声明为入口，再以魔数核实真实格式，两边不符时给出可操作的提示。
    const docxLike = extension === "docx" || mimeType.includes("wordprocessingml");
    const xlsxLike = extension === "xlsx" || mimeType.includes("spreadsheet") || mimeType.includes("excel");
    const pptxLike = extension === "pptx" || mimeType.includes("presentationml");
    try {
      if (docxLike || (!xlsxLike && !pptxLike && magic === "zip")) {
        const result = await extractDocx(buffer);
        text = result.text;
        structure = result.structure;
        structuredContent = result.structuredContent;
        if (result.viaFallback) warnings.push("Word 标准解析器未能完整解析，已改从 DOCX OOXML 文本 run 读取正文；图片/复杂排版只保留原包，不做语义重建。");
      } else if (xlsxLike || extension === "xls") {
        const sheet = await extractSpreadsheet(buffer);
        text = sheet.text;
        structure = sheet.structure;
        structuredContent = sheet.structuredContent;
      } else if (pptxLike) {
        const result = await extractPptx(buffer);
        text = result.text;
        structure = result.structure;
        structuredContent = result.structuredContent;
      } else if (magic === "ole" || extension === "doc" || extension === "ppt") {
        // 老版 .doc/.ppt：OLE 复合文档，抛给 catch 走启发式片段抽取 + 明确建议另存为 docx。
        throw new Error("老版 Office 二进制格式（OLE 复合文档）");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (magic === "ole" || [".doc", ".xls", ".ppt"].includes(`.${extension}`)) {
        text = heuristicOleText(buffer);
        warnings.push(`识别到老版 Office 二进制格式（${extension ? `.${extension}` : "未知扩展名"}），浏览器无法完整还原；已尽量抽取可读文本片段${text ? "（可能有遗漏/噪声）" : "，未抽取到内容"}。建议在 Word/WPS 中「另存为」.docx/.xlsx/.pptx 后重新上传。原始解析报错：${message}`);
      } else if (magic === "zip") {
        warnings.push(`Office 文件解析失败（${message}），文件可能已损坏或被改名为 Office 扩展名的其他格式。`);
      } else {
        warnings.push(`该文件被声明为 Office 格式但真实内容不是（${message}）；将按真实内容类型继续识别。`);
      }
    }
  }

  if (!text && magic === "zip" && !isOfficeByExt && extension !== "zip" && !mimeType.includes("openxmlformats") && !mimeType.includes("opendocument")) {
    try {
      const zip = await extractZipContainer(buffer);
      text = zip.text;
      structure = zip.structure;
      structuredContent = zip.structuredContent;
      zipParseStats = zip.parseStats;
      if (zip.parseStats.totalEntries > zip.parseStats.indexedEntries) warnings.push(`ZIP 共 ${zip.parseStats.totalEntries} 个文件；结构索引已保留 ${zip.parseStats.indexedEntries} 个路径，并按相关度抽取 ${zip.parseStats.parsedEntries} 个内容节点。`);
    } catch (error) {
      warnings.push(`ZIP 解析失败：${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (!text && extension === "zip" && magic === "zip") {
    const zip = await extractZipContainer(buffer);
    text = zip.text;
    structure = zip.structure;
    structuredContent = zip.structuredContent;
    zipParseStats = zip.parseStats;
    if (zip.parseStats.totalEntries > zip.parseStats.indexedEntries) warnings.push(`ZIP 共 ${zip.parseStats.totalEntries} 个文件；结构索引已保留 ${zip.parseStats.indexedEntries} 个路径，并按相关度抽取 ${zip.parseStats.parsedEntries} 个内容节点。`);
  }

  if (!text && (extension === "odt" || extension === "ods" || extension === "odp" || mimeType.includes("opendocument"))) {
    try {
      const result = await extractOpenDocument(buffer);
      text = result.text;
    } catch (error) {
      warnings.push(`OpenDocument 解析失败：${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  if (!text && (mimeType === "application/pdf" || extension === "pdf" || magic === "pdf")) {
    try {
      text = await extractPdf(buffer);
    } catch (error) {
      warnings.push(`PDF 解析失败：${error instanceof Error ? error.message : "unknown error"}。扫描版 PDF 没有文本层，需要 OCR 或转成文字后再上传。`);
    }
  }

  if (!text) {
    const head = headText(buffer);
    if (head.startsWith("{\\rtf")) {
      text = extractRtf(new TextDecoder("windows-1252").decode(buffer));
      warnings.push("RTF 已按纯文本近似抽取，样式信息不保留。");
    } else if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<?xml")) {
      text = new TextDecoder().decode(buffer);
      if (extension && !["html", "htm", "xml", "svg", "md"].includes(extension)) warnings.push(`文件扩展名是 .${extension}，真实内容是 HTML/XML，已按文本解析。`);
    } else if (looksText(name, mimeType)) {
      text = new TextDecoder().decode(buffer);
    } else if (magic === "image" || mimeType.startsWith("image/")) {
      warnings.push("图片已上传；视觉内容将在配置 OpenAI 后由 AI 视觉通道理解。当前不做 OCR 替代视觉理解。");
    } else {
      const decoded = tryDecodeText(buffer);
      if (decoded !== undefined) {
        text = decoded;
        warnings.push("未识别到专用格式，按纯文本抽取成功；如内容异常请改用 .txt / .md 上传。");
      } else {
        warnings.push("该文件类型目前只保存元数据，尚未配置专用解析器。可补充文本说明，或在 Source Adapter 中新增解析器。");
      }
    }
  }

  const external = await externalPromise;
  if (external?.warnings?.length) warnings.push(...external.warnings);

  if (external?.text && (!text || external.text.length > text.length * 1.15)) {
    text = external.text;
    warnings.push(`已使用 ${external.profile?.engineLabel ?? "外部解析引擎"} 的结构化抽取结果增强内容理解；本地原生结构仍用于同格式回写。`);
  }
  if (external?.structuredContent && !structuredContent) structuredContent = external.structuredContent;

  const result = zipParseStats ? truncate(text) : {text,truncated:false};
  if (result.truncated) warnings.push(zipParseStats
    ? `初始 AI 摘要窗口超过 ${MAX_EXTRACTED_CHARS.toLocaleString()} 字符，已截断摘要；完整 Repository Deep Index 仍保留并会按用户目标/测试题动态检索，这不代表只解析了前 ${MAX_EXTRACTED_CHARS.toLocaleString()} 字符。`
    : `解析文本超过 ${MAX_EXTRACTED_CHARS.toLocaleString()} 字符，Studio 已截断进入 AI 上下文；原文件仍保留为 Source Asset。`);
  const artifactKind = artifactKindFrom(name, mimeType, structure, result.text);
  const artifactDescriptor = describeArtifact({ name, mimeType, extension, artifactKind, structure, structuredContent });
  const totalEntries = zipParseStats?.totalEntries ?? (structure.length || (result.text ? 1 : 0));
  const indexedEntries = zipParseStats?.indexedEntries ?? structure.length;
  const parsedEntries = zipParseStats?.parsedEntries ?? (result.text ? Math.max(1, structure.length) : 0);
  const eligibleEntries = zipParseStats?.eligibleEntries ?? (result.text ? Math.max(1, parsedEntries) : 0);
  const deepIndexedEntries = zipParseStats?.deepIndexedEntries ?? parsedEntries;
  const deepIndexCoverage = eligibleEntries ? Math.min(1, deepIndexedEntries / Math.max(1, eligibleEntries)) : (result.text ? 0.8 : 0.15);
  const structuralCoverage = totalEntries ? Math.min(1, indexedEntries / Math.max(1,totalEntries)) : (structuredContent ? 0.9 : structure.length ? 0.68 : 0.35);
  const criticalEntries = zipParseStats?.criticalEntries ?? 0;
  const inspectedCriticalEntries = zipParseStats?.inspectedCriticalEntries ?? 0;
  const criticalModuleCoverage = criticalEntries ? Math.min(1, inspectedCriticalEntries / criticalEntries) : deepIndexCoverage;
  const dependencyCoverage = zipParseStats?.internalImports ? Math.min(1, (zipParseStats.resolvedInternalImports ?? 0) / zipParseStats.internalImports) : (artifactKind === "codebase" ? 0 : 1);
  const parsingProfile: ParsingProfile = {
    engine: external?.profile?.engine ?? (artifactKind === "codebase" || zipParseStats?.codeFiles ? "code-ast" : "browser-local"),
    engineLabel: external?.profile?.engineLabel ?? (artifactKind === "codebase" || zipParseStats?.codeFiles ? "本地 ZIP + Repository Intelligence + Babel AST" : "浏览器原生解析"),
    confidence: external?.profile?.confidence ?? Math.min(0.98, result.text ? 0.72 + (structuredContent ? 0.15 : 0) + (zipParseStats?.parseOkCode ? 0.08 : 0) : 0.28),
    // V2.7: completeness means deep index coverage among parseable semantic entries, not raw ZIP-entry ratio.
    completeness: external?.profile?.completeness ?? deepIndexCoverage,
    structuralCoverage: external?.profile?.structuralCoverage ?? structuralCoverage,
    totalEntries, indexedEntries, parsedEntries,
    codeFiles: zipParseStats?.codeFiles ?? (artifactKind === "codebase" ? 1 : 0),
    documentFiles: zipParseStats?.documentFiles ?? (artifactKind === "document" ? 1 : 0),
    officeFiles: zipParseStats?.officeFiles ?? (["presentation","spreadsheet"].includes(artifactKind) ? 1 : 0),
    imageFiles: zipParseStats?.imageFiles ?? (artifactKind === "image" ? 1 : 0),
    eligibleEntries,
    deepIndexedEntries,
    deepIndexCoverage,
    criticalEntries,
    inspectedCriticalEntries,
    criticalModuleCoverage,
    indexedSymbols: zipParseStats?.indexedSymbols ?? 0,
    internalImports: zipParseStats?.internalImports ?? 0,
    resolvedInternalImports: zipParseStats?.resolvedInternalImports ?? 0,
    dependencyCoverage,
    contextWindowChars: zipParseStats?.summaryChars ?? Math.min(24000,result.text.length),
    executableEvidence: false,
    visualEvidence: mimeType.startsWith("image/") && Boolean(external?.profile),
    limitations: [...warnings.filter((w)=>/无法|仅|截断|失败|需要|未/.test(w) && !w.includes("初始 AI 摘要窗口")).slice(0,6)],
    recommendations: artifactKind === "codebase" ? ["代码工程已建立深度 Repository Index；用户目标会按需检索关键模块与一阶依赖。如需证明真实 UI/E2E/构建结果，请连接外部 Code Runner/Browser Runner。"] : external ? [] : ["复杂 PDF/Office 可在设置中接入 Parser Router（Docling / Unstructured / Apache Tika），提高布局、表格和结构解析质量。"],
    generatedAt: new Date().toISOString(),
  };
  return { extractedText: result.text || undefined, excerpt: result.text ? result.text.slice(0, 1600) : undefined, structure, structuredContent, artifactKind, artifactDescriptor, parsingProfile, warnings, extension };
}
