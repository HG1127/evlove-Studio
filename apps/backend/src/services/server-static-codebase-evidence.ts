import JSZip, { type JSZipObject } from "jszip";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";

const MAX_ARCHIVE_FILES = 2000;
const MAX_TEXT_FILE_BYTES = 250_000;
const MAX_INDEX_BYTES = 8_000_000;
const TEXT_PATH = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|php|vue|svelte|sql|css|json|ya?ml|md|mdx)$/i;
const CODE_PATH = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|php|vue|svelte|sql)$/i;
const IGNORED_PATH = /(^|\/)(?:node_modules|\.git|dist|build|coverage|vendor|\.next)\//i;

function safePath(path: string) {
  return Boolean(path) && !path.startsWith("/") && !/[\\:]/.test(path)
    && [...path].every((char) => char.charCodeAt(0) >= 32)
    && path.split("/").every((part) => Boolean(part) && part !== "." && part !== "..");
}

function unavailable(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id, output: `UNVERIFIED：${detail}`, latencyMs: 0, cost: 0,
    verificationStatus: "unverified",
    trace: [{ id: `candidate-zip-static-${testCase.id}`, stage: "candidate-static-evidence", summary: "Server 冻结代码包静态证据不可用", status: "warning", detail }],
  };
}

function queryTerms(project: EvolveProject, testCase: TestCase) {
  const criterionIds = new Set(testCase.criterionIds);
  const query = [project.evolutionCommand, testCase.title, testCase.input, ...testCase.expected,
    ...project.acceptanceRubric.filter((criterion) => criterionIds.has(criterion.id)).map((criterion) => criterion.requirement)].join(" ").toLowerCase();
  return [...new Set(query.match(/[a-z][a-z0-9_-]{3,}|\p{Script=Han}{2,}/gu) ?? [])]
    .filter((term) => !["check", "implementation", "project", "source", "codebase", "candidate"].includes(term)).slice(0, 40);
}

/** Server-side static implementation evidence from the exact frozen Candidate ZIP. */
export async function runServerFrozenCodebaseStaticEvidence(args: {
  project: EvolveProject; candidate: Candidate; testCase: TestCase;
}): Promise<TargetRunResult> {
  const { project, candidate, testCase } = args;
  const criterionIds = new Set(testCase.criterionIds);
  const scope = new Set(project.acceptanceRubric.filter((criterion) => criterionIds.has(criterion.id)).flatMap((criterion) => criterion.artifactIds));
  const targets = project.sourceArtifacts.filter((source) => source.role === "target"
    && (source.artifactKind === "codebase" || source.extension.toLowerCase() === "zip")
    && (!scope.size || scope.has(source.id)));
  if (targets.length !== 1) return unavailable(testCase, "静态验收题没有唯一的代码库 Target 绑定。");
  const source = targets[0]!;
  const allTargets = project.sourceArtifacts.filter((item) => item.role === "target");
  if (scope.size ? scope.size !== 1 || !scope.has(source.id) : allTargets.length !== 1) {
    return unavailable(testCase, "静态验收题跨越多个 Target，不能只凭一个代码包判定。");
  }
  const snapshots = candidate.artifactSnapshots.filter((snapshot) => snapshot.sourceArtifactId === source.id);
  if (snapshots.length !== 1) return unavailable(testCase, "Candidate 没有唯一的代码库 Snapshot。");
  const snapshot = snapshots[0]!;
  const receipt = snapshot.frozenArtifact;
  if (!receipt || !/\.zip$/i.test(receipt.name)) return unavailable(testCase, "Candidate ZIP 缺少实际冻结凭证。");
  try {
    if (!await verifyServerCandidateFrozenArtifact(snapshot)) return unavailable(testCase, "Candidate ZIP 冻结凭证或实际 Blob 校验失败。");
    const blob = await getServerArtifactStore().get(receipt.blobId);
    if (!blob) return unavailable(testCase, "Candidate ZIP Blob 缺失。");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength !== receipt.size || await serverArtifactSha256(bytes) !== receipt.sha256) {
      return unavailable(testCase, "用于静态索引的 Candidate ZIP 字节已变化。");
    }
    const zip = await JSZip.loadAsync(bytes);
    const files = (Object.values(zip.files) as JSZipObject[]).filter((entry) => !entry.dir);
    if (!files.length || files.length > MAX_ARCHIVE_FILES) return unavailable(testCase, "代码包文件数量超出静态索引范围。");
    const terms = queryTerms(project, testCase);
    const indexed: Array<{ path: string; content: string; score: number; code: boolean }> = [];
    let totalBytes = 0;
    for (const entry of files) {
      const path = entry.name;
      const unsafeOriginalName = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
      if (!safePath(path) || (unsafeOriginalName && !safePath(unsafeOriginalName))) return unavailable(testCase, "代码包含不安全的文件路径。");
      if (IGNORED_PATH.test(path) || !TEXT_PATH.test(path)) continue;
      const size = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (!Number.isSafeInteger(size) || size! < 0 || size! > MAX_TEXT_FILE_BYTES || totalBytes + size! > MAX_INDEX_BYTES) {
        return unavailable(testCase, "代码包文本索引超过安全大小上限，不能声称已检查完整源码。");
      }
      totalBytes += size!;
      const extracted = await entry.async("uint8array");
      if (extracted.byteLength !== size) return unavailable(testCase, "代码包条目解压大小与索引元数据不一致。");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(extracted);
      const lower = content.toLowerCase();
      const lowerPath = path.toLowerCase();
      const score = terms.reduce((value, term) => value + (lowerPath.includes(term) ? 3 : 0) + (lower.includes(term) ? 1 : 0), 0);
      indexed.push({ path, content, score, code: CODE_PATH.test(path) && !/(^|\/)(?:test|tests|e2e|fixtures|__tests__)(\/|$)|\.(?:test|spec)\.[^.]+$/i.test(path) });
    }
    const relevant = indexed.filter((entry) => entry.score >= 2 && entry.code).sort((a, b) => b.score - a.score).slice(0, 12);
    const status: TargetRunResult["verificationStatus"] = relevant.length < 2 ? "unverified"
      : testCase.evidenceScope === "product-behavior" ? "partial" : "verified";
    const output = [
      `CANDIDATE FROZEN CODEBASE STATIC EVIDENCE · SHA-256 ${receipt.sha256}`,
      `验收目标：${testCase.title}`,
      `已从冻结 ZIP 完整读取 ${indexed.length} 个受支持文本文件；其中 ${relevant.length} 个相关实现文件纳入证据。`,
      ...relevant.map((entry) => `--- ${entry.path} · relevance=${entry.score} ---\n${entry.content.slice(0, 3600)}`),
      status === "unverified" ? "未定位到至少两个相关实现文件，保持 UNVERIFIED。" : "静态证据只证明实现/结构存在；产品交互仍需真实 Runner。",
    ].join("\n\n");
    return {
      testCaseId: testCase.id, output, latencyMs: 0, cost: 0, verificationStatus: status,
      artifactHash: receipt.sha256,
      trace: [{ id: `candidate-zip-static-${testCase.id}`, stage: "candidate-static-evidence", summary: "Server 已索引冻结 ZIP 的实际源码", status: status === "unverified" ? "warning" : "pass", detail: receipt.sha256 }],
    };
  } catch (error) {
    return unavailable(testCase, `冻结代码包静态索引失败：${error instanceof Error ? error.message : String(error)}`);
  }
}