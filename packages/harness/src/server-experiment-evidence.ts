import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { citesHistoricalEvidence } from "@evolution/core";

import { compactServerSourceText, serverSemanticContextQuery } from "./server-source-context";

// CSV/TSV Candidate contents are Sheet/Cell JSON deltas, never literal file text.
const TEXT_ROUNDTRIP = /^(txt|md|markdown|mdx|css|js|jsx|ts|tsx|html|htm)$/i;

export function unavailableExperimentRun(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id,
    output: `UNVERIFIED：${detail}`,
    latencyMs: 0,
    cost: 0,
    verificationStatus: "unverified",
    trace: [{
      id: `server-experiment-unverified-${testCase.id}`,
      stage: testCase.executionMode,
      summary: "Server Experiment 当前缺少该证据能力",
      status: "warning",
      detail,
    }],
  };
}

export function serverExperimentSemanticStatus(output: string): TargetRunResult["verificationStatus"] {
  if (!output.trim() || /^\s*UNVERIFIED\b/i.test(output) || citesHistoricalEvidence(output)) return "unverified";
  if (/\bUNVERIFIED\b/i.test(output)) return "partial";
  return "verified";
}

export function snapshotsForTest(project: EvolveProject, candidate: Candidate, testCase: TestCase) {
  const criterionIds = new Set(testCase.criterionIds);
  const scoped = new Set(
    project.acceptanceRubric
      .filter((criterion) => criterionIds.has(criterion.id))
      .flatMap((criterion) => criterion.artifactIds),
  );
  const targetIds = new Set(project.sourceArtifacts.filter((artifact) => artifact.role === "target").map((artifact) => artifact.id));
  return candidate.artifactSnapshots.filter((snapshot) =>
    targetIds.has(snapshot.sourceArtifactId) && (!scoped.size || scoped.has(snapshot.sourceArtifactId)));
}

export function candidateLocalEvidence(
  project: EvolveProject,
  candidate: Candidate,
  testCase: TestCase,
): TargetRunResult | undefined {
  if (testCase.executionMode === "manual") {
    return unavailableExperimentRun(
      testCase,
      `Candidate ${candidate.id} 需要人工验收证据；Server Experiment 不会用 AI 文本替代。`,
    );
  }
  if (testCase.executionMode === "roundtrip") {
    const snapshots = snapshotsForTest(project, candidate, testCase);
    if (!snapshots.length) return unavailableExperimentRun(testCase, `Candidate ${candidate.id} 没有与本题绑定的实际 Artifact Snapshot。`);
    const sources = new Map(project.sourceArtifacts.map((artifact) => [artifact.id, artifact]));
    const allText = snapshots.every((snapshot) => {
      const source = sources.get(snapshot.sourceArtifactId);
      return Boolean(source && TEXT_ROUNDTRIP.test(source.extension || source.name.split(".").pop() || ""));
    });
    if (allText) {
      const details = snapshots.map((snapshot) => {
        const bytes = new TextEncoder().encode(snapshot.content);
        const restored = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { name: snapshot.name, bytes: bytes.length, preserved: restored === snapshot.content, contentHash: snapshot.contentHash };
      });
      const preserved = details.every((item) => item.preserved);
      return {
        testCaseId: testCase.id,
        output: `CANDIDATE TEXT FORMAT ROUNDTRIP PENDING BLOB\n${JSON.stringify(details)}\nServer 已对 Candidate Snapshot 执行 UTF-8 编码→解码；实际冻结文件仍需本轮回读逐字核对。`,
        latencyMs: 0,
        cost: 0,
        verificationStatus: preserved ? "partial" : "unverified",
        trace: [{
          id: `candidate-roundtrip-${candidate.id}-${testCase.id}`,
          stage: "format-roundtrip",
          summary: preserved ? "Candidate 文本实际编解码一致" : "Candidate 文本编解码不一致",
          status: "warning",
        }],
      };
    }
    const receipts = snapshots.map((snapshot) => snapshot.frozenArtifact).filter(Boolean);
    if (receipts.length === snapshots.length) {
      return {
        testCaseId: testCase.id,
        output: `CANDIDATE FROZEN ARTIFACT RECEIPTS PRESENT\n${JSON.stringify(receipts.map((receipt) => ({
          sourceArtifactId: receipt!.sourceArtifactId,
          sha256: receipt!.sha256,
          size: receipt!.size,
          checks: receipt!.checks,
          limitations: receipt!.limitations,
        })))}\nCandidate Snapshot 带有 Server Materializer 冻结凭证；本轮仍需回读实际 Blob 并验证绑定、大小及 SHA-256。`,
        latencyMs: 0,
        cost: 0,
        verificationStatus: "unverified",
        trace: [{
          id: `candidate-frozen-roundtrip-${candidate.id}-${testCase.id}`,
          stage: "format-roundtrip",
          summary: "Candidate 冻结凭证待本轮回读校验",
          status: "warning",
        }],
      };
    }
    return unavailableExperimentRun(testCase, `Candidate ${candidate.id} 的结构化成果尚未全部冻结为实际文件。`);
  }
  if (testCase.executionMode === "static-evidence") {
    return unavailableExperimentRun(testCase, "Server 静态证据必须由冻结 Artifact 端口读取实际文件；Candidate 修改蓝图不能证明最终文件内容。");
  }  return undefined;
}

export function candidateArtifactContext(project: EvolveProject, candidate: Candidate, budget = 64_000, testCases: TestCase[] = project.evalSuite) {
  const sourceById = new Map(project.sourceArtifacts.map((artifact) => [artifact.id, artifact]));
  const query = serverSemanticContextQuery(project, testCases);
  let remaining = budget;
  return candidate.artifactSnapshots.slice(0, 12).map((snapshot) => {
    const source = sourceById.get(snapshot.sourceArtifactId);
    const allowance = Math.max(0, Math.min(20_000, remaining));
    const html = /^(html|htm)$/i.test(source?.extension ?? "") || /^text\/html(?:;|$)/i.test(snapshot.mimeType);
    const content = compactServerSourceText(snapshot.content, query, allowance, html);
    remaining = Math.max(0, remaining - content.length);
    return {
      id: snapshot.sourceArtifactId,
      snapshotId: snapshot.id,
      name: snapshot.name,
      mimeType: snapshot.mimeType,
      artifactKind: source?.artifactKind,
      extension: source?.extension,
      content,
      originalChars: snapshot.content.length,
      truncated: content !== snapshot.content,
      contentHash: snapshot.contentHash,
      frozenSha256: snapshot.frozenArtifact?.sha256,
      buildMode: snapshot.buildMode,
    };
  });
}

export function compactExperimentRunOutput(text: string, query: string, maxChars = 6000) {
  if (text.length <= maxChars) return text;
  const lower = text.toLowerCase();
  const terms = query.toLowerCase().match(/[a-z0-9._/-]{4,}|\p{Script=Han}{2,}/gu) ?? [];
  const position = terms.map((term) => lower.indexOf(term)).find((index) => index >= 0) ?? Math.floor(text.length / 2);
  const middleBudget = Math.floor(maxChars * 0.5);
  const around = text.slice(Math.max(0, position - Math.floor(middleBudget / 2)), position + Math.ceil(middleBudget / 2));
  const edge = Math.floor((maxChars - around.length) / 2);
  return [text.slice(0, edge), around, text.slice(-edge)]
    .filter(Boolean)
    .join("\n\n--- server candidate evidence slice ---\n\n")
    .slice(0, maxChars);
}
