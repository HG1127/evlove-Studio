import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { indexServerCodebaseZip, rankServerCodebaseFiles, type ServerCodebaseZipIndex } from "./server-codebase-zip-index";

function unavailable(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id, output: `UNVERIFIED：${detail}`, latencyMs: 0, cost: 0,
    verificationStatus: "unverified",
    trace: [{ id: `candidate-zip-static-${testCase.id}`, stage: "candidate-static-evidence", summary: "Server 冻结代码包静态证据不可用", status: "warning", detail }],
  };
}

export function buildServerCodebaseStaticRun(args: {
  index: ServerCodebaseZipIndex; project: EvolveProject; testCase: TestCase; sha256: string; currentSource?: boolean;
}): TargetRunResult {
  const { index, project, testCase, sha256, currentSource = false } = args;
  const criterionIds = new Set(testCase.criterionIds);
  const query = [project.evolutionCommand, testCase.title, testCase.input, ...testCase.expected,
    ...project.acceptanceRubric.filter((criterion) => criterionIds.has(criterion.id)).map((criterion) => criterion.requirement)].join(" ");
  const matched = rankServerCodebaseFiles(index, query).filter((entry) => entry.score >= 2 && entry.code);
  const relevant = matched.slice(0, 12);
  const clipped = matched.length > relevant.length || relevant.some((entry) => entry.content.length > 3_600);
  const status: TargetRunResult["verificationStatus"] = relevant.length < 2 ? "unverified"
    : testCase.evidenceScope === "product-behavior" || clipped ? "partial" : "verified";
  const stage = currentSource ? "static-evidence" : "candidate-static-evidence";
  const traceId = currentSource ? `server-current-file-${testCase.id}` : `candidate-zip-static-${testCase.id}`;
  const output = [
    `${currentSource ? "CURRENT SOURCE" : "CANDIDATE FROZEN"} CODEBASE STATIC EVIDENCE · SHA-256 ${sha256}`,
    `验收目标：${testCase.title}`,
    `已从实际 ZIP 枚举 ${index.fileCount} 个条目，完整索引 ${index.textFiles.length} 个受支持文本文件；其中 ${relevant.length} 个相关实现文件纳入证据。`,
    ...relevant.map((entry) => `--- ${entry.path} · relevance=${entry.score} ---\n${entry.content.slice(0, 3_600)}`),
    status === "unverified" ? "未定位到至少两个相关实现文件，保持 UNVERIFIED。"
      : clipped ? "相关文件摘录已截断，仅能作为部分静态证据。" : "静态证据只证明实现/结构存在；产品交互仍需真实 Runner。",
  ].join("\n\n");
  return {
    testCaseId: testCase.id, output, latencyMs: 0, cost: 0, verificationStatus: status,
    artifactHash: sha256,
    trace: [{ id: traceId, stage, summary: "Server 已索引实际 ZIP 的源码", status: status === "unverified" ? "warning" : "pass", detail: sha256 }],
  };
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
    const index = await indexServerCodebaseZip(bytes);
    return buildServerCodebaseStaticRun({ index, project, testCase, sha256: receipt.sha256 });
  } catch (error) {
    return unavailable(testCase, `冻结代码包静态索引失败：${error instanceof Error ? error.message : String(error)}`);
  }
}