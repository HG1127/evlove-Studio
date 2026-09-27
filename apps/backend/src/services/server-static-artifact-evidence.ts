import JSZip, { type JSZipObject } from "jszip";
import * as XLSX from "xlsx";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { fastHash } from "@evolution/core";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { runServerFrozenCodebaseStaticEvidence } from "./server-static-codebase-evidence";

const MAX_FILE_BYTES = 12_000_000;
const MAX_XML_BYTES = 2_000_000;
const MAX_OUTPUT_CHARS = 28_000;
const TEXT_EXTENSION = /^(?:txt|md|markdown|mdx|csv|tsv|json|ya?ml|css|js|jsx|ts|tsx|html|htm|xml|svg)$/i;

function unavailable(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id, output: `UNVERIFIED：${detail}`, latencyMs: 0, cost: 0,
    verificationStatus: "unverified",
    trace: [{ id: `server-frozen-static-${testCase.id}`, stage: "server-frozen-static", summary: "冻结文件静态证据不可用", status: "warning", detail }],
  };
}

function xmlUnescape(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

async function officeText(bytes: Uint8Array, kind: "docx" | "pptx") {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files) as JSZipObject[];
  const paths = files.filter((entry) => !entry.dir && (kind === "docx"
    ? /^word\/(?:document|footnotes|endnotes|header\d*|footer\d*)\.xml$/i.test(entry.name)
    : /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!paths.length || paths.length > 200) throw new Error("OOXML 正文/页面缺失或超出索引范围。");
  const pattern = kind === "docx" ? /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g : /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  const blocks: string[] = [];
  let totalBytes = 0;
  for (const entry of paths) {
    const size = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size! < 0 || size! > MAX_XML_BYTES || totalBytes + size! > MAX_FILE_BYTES) throw new Error("OOXML 文本节点超出安全索引范围。");
    totalBytes += size!;
    const raw = await entry.async("uint8array");
    if (raw.byteLength !== size) throw new Error("OOXML 条目大小与索引元数据不一致。");
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const text = [...xml.matchAll(pattern)].map((match) => xmlUnescape(match[1] ?? "")).join(" ").trim();
    if (text) blocks.push(`${entry.name}: ${text}`);
  }
  return blocks.join("\n\n");
}

function spreadsheetText(bytes: Uint8Array) {
  const workbook = XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: true });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > 100) throw new Error("工作簿没有工作表或超出静态索引范围。");
  let cells = 0;
  const blocks: string[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const lines: string[] = [];
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      cells += 1;
      if (cells > 10_000) throw new Error("工作簿单元格超出静态索引范围。");
      const value = cell as XLSX.CellObject;
      lines.push(`${address}: ${value.f ? `=${value.f}` : String(value.v ?? "")}`);
    }
    blocks.push(`${name}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}

/** Static evidence from the same frozen bytes that Gate F may later accept. */
export async function runServerFrozenArtifactStaticEvidence(args: {
  project: EvolveProject; candidate: Candidate; testCase: TestCase;
}): Promise<TargetRunResult> {
  const { project, candidate, testCase } = args;
  const criterionIds = new Set(testCase.criterionIds);
  const scope = new Set(project.acceptanceRubric.filter((criterion) => criterionIds.has(criterion.id)).flatMap((criterion) => criterion.artifactIds));
  const targets = project.sourceArtifacts.filter((source) => source.role === "target" && (!scope.size || scope.has(source.id)));
  if (targets.length !== 1 || (scope.size && scope.size !== 1)) return unavailable(testCase, "静态验收题没有唯一的 Target 绑定；跨成果证据需单独验证。");
  const source = targets[0]!;
  if (source.artifactKind === "codebase" || source.extension.toLowerCase() === "zip") return runServerFrozenCodebaseStaticEvidence(args);
  const snapshots = candidate.artifactSnapshots.filter((snapshot) => snapshot.sourceArtifactId === source.id);
  if (snapshots.length !== 1) return unavailable(testCase, "Candidate 没有唯一的 Target Snapshot。");
  const snapshot = snapshots[0]!;
  const receipt = snapshot.frozenArtifact;
  if (!receipt || receipt.name !== source.name) return unavailable(testCase, "Candidate 冻结文件缺少对应 Target 的凭证。");
  try {
    if (!await verifyServerCandidateFrozenArtifact(snapshot)) return unavailable(testCase, "Candidate 冻结文件与 Snapshot 或存储字节不一致。");
    const blob = await getServerArtifactStore().get(receipt.blobId);
    if (!blob || blob.size !== receipt.size || blob.size > MAX_FILE_BYTES) return unavailable(testCase, "冻结文件缺失或超出静态索引范围。");
    const buffer = await blob.arrayBuffer();
    if (await serverArtifactSha256(buffer) !== receipt.sha256) return unavailable(testCase, "用于静态索引的冻结文件字节已变化。");
    const bytes = new Uint8Array(buffer);
    const extension = source.extension.toLowerCase();
    let actual = "";
    if (TEXT_EXTENSION.test(extension)) actual = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    else if (extension === "docx" || extension === "pptx") actual = await officeText(bytes, extension);
    else if (["xlsx", "xls", "ods"].includes(extension)) actual = spreadsheetText(bytes);
    else return unavailable(testCase, `${source.name} 尚无 Server 冻结文件静态解析器。`);
    if (!actual.trim()) return unavailable(testCase, "冻结文件没有可定位的静态文本/结构证据。");
    const complete = actual.length <= MAX_OUTPUT_CHARS;
    const status: TargetRunResult["verificationStatus"] = !complete || testCase.evidenceScope === "product-behavior" ? "partial" : "verified";
    return {
      testCaseId: testCase.id,
      output: `SERVER FROZEN ARTIFACT STATIC EVIDENCE · SHA-256 ${receipt.sha256}\n${source.name} · ${extension}\n${actual.slice(0, MAX_OUTPUT_CHARS)}\n${complete ? "已读取此格式受支持的冻结文件静态文本索引。" : "文本索引超过输出预算，仅展示前段；不得视为完整证据。"}\n静态证据不能证明真实交互、公式重算或视觉保真。`,
      latencyMs: 0, cost: 0, verificationStatus: status, artifactHash: receipt.sha256,
      trace: [{ id: `server-frozen-static-${testCase.id}`, stage: "server-frozen-static", summary: "已从冻结文件字节建立静态索引", status: "pass", detail: JSON.stringify([source.id, receipt.sha256, fastHash(snapshot.content)]) }],
    };
  } catch (error) {
    return unavailable(testCase, `冻结文件静态解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}