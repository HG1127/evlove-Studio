import type {
  Candidate,
  CandidateArtifactSnapshot,
  EvaluateAiResult,
  ExecuteArtifactBatchAiResult,
  EvaluationResult,
  EvolveProject,
  TargetRunResult,
  TestCase,
} from "@evolution/contracts";
import {
  criteriaRequiringJudge,
  settleDeterministicEvaluation,
  fastHash,
  settleAiEvaluation,
} from "@evolution/core";
import {
  candidateArtifactContext,
  candidateLocalEvidence,
  snapshotsForTest,
  compactExperimentRunOutput,
  serverExperimentSemanticStatus,
  unavailableExperimentRun,
} from "./server-experiment-evidence";
import { normalizeLocallyVerifiableCandidateRuns } from "./candidate-snapshot-evidence";
import { indexUniqueBatchResults } from "./server-batch-results";

export type ServerExperimentExecutionPorts = {
  executeSemanticBatch(args: {
    project: EvolveProject;
    candidate: Candidate;
    testCases: TestCase[];
    artifactContext: Array<Record<string, unknown>>;
  }): Promise<ExecuteArtifactBatchAiResult>;
  verifyFrozenArtifact?(snapshot: CandidateArtifactSnapshot): Promise<boolean>;
  executeFrozenStatic?(args: { project: EvolveProject; candidate: Candidate; testCase: TestCase }): Promise<TargetRunResult>;
  executeExternalBatch?(args: {
    project: EvolveProject;
    candidate: Candidate;
    testCases: TestCase[];
  }): Promise<TargetRunResult[]>;
  judge(payload: unknown): Promise<EvaluateAiResult>;
};

function unavailableFrozenStatic(testCase: TestCase, detail: string): TargetRunResult {
  const result = unavailableExperimentRun(testCase, detail);
  return { ...result, trace: [...result.trace, { id: `candidate-zip-static-${testCase.id}`, stage: "candidate-static-evidence", summary: "冻结代码包静态证据未完成", status: "warning", detail }] };
}
function unavailableFrozenDocumentStatic(testCase: TestCase, detail: string): TargetRunResult {
  const result = unavailableExperimentRun(testCase, detail);
  return { ...result, trace: [...result.trace, { id: `server-frozen-static-${testCase.id}`, stage: "server-frozen-static", summary: "冻结文件静态证据未完成", status: "warning", detail }] };
}
function unavailableFrozenRoundtrip(testCase: TestCase, detail: string): TargetRunResult {
  const result = unavailableExperimentRun(testCase, detail);
  return { ...result, trace: [...result.trace, { id: `server-frozen-roundtrip-${testCase.id}`, stage: "format-roundtrip", summary: "Server 冻结文件往返证据未完成", status: "warning", detail }] };
}

function frozenRoundtripSignature(snapshots: CandidateArtifactSnapshot[]) {
  return JSON.stringify(snapshots.map((snapshot) => [snapshot.sourceArtifactId, snapshot.frozenArtifact?.sha256, fastHash(snapshot.content)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
function deterministicOnlyEvaluation(
  project: EvolveProject,
  testCases: TestCase[],
  runs: TargetRunResult[],
): EvaluationResult {
  return settleDeterministicEvaluation({
    criteria: project.acceptanceRubric, testCases, runs,
    notes: ["本轮没有需要 AI Judge 的可执行语义标准；仅结算确定性证据。通用质量维度未测量，因此保持 0，不代表产品失败。"],
  });
}

export async function executeServerExperimentCandidate(
  project: EvolveProject,
  candidate: Candidate,
  ports: ServerExperimentExecutionPorts,
  testCases: TestCase[] = project.evalSuite,
): Promise<TargetRunResult[]> {
  const ordered = new Map<string, TargetRunResult>();
  const semanticCases: TestCase[] = [];
  const externalCases: TestCase[] = [];
  for (const testCase of testCases) {
    const criterionIds = new Set(testCase.criterionIds);
    const staticScope = new Set(project.acceptanceRubric.filter((criterion) => criterionIds.has(criterion.id)).flatMap((criterion) => criterion.artifactIds));
    const codebaseStaticCase = testCase.executionMode === "static-evidence"
      && project.sourceArtifacts.some((source) => source.role === "target"
        && (source.artifactKind === "codebase" || source.extension.toLowerCase() === "zip")
        && (!staticScope.size || staticScope.has(source.id)));
    if (testCase.executionMode === "static-evidence") {
      const unavailableStatic = codebaseStaticCase ? unavailableFrozenStatic : unavailableFrozenDocumentStatic;
      if (!ports.executeFrozenStatic) {
        ordered.set(testCase.id, unavailableStatic(testCase, "Server 没有冻结 Artifact 静态索引端口。"));
      } else {
        try {
          const result = await ports.executeFrozenStatic({ project, candidate, testCase });
          ordered.set(testCase.id, result.testCaseId === testCase.id ? result : unavailableStatic(testCase, "冻结 Artifact 静态证据返回了错误的 Test Case ID。"));
        } catch (error) {
          ordered.set(testCase.id, unavailableStatic(testCase, `冻结 Artifact 静态索引失败：${error instanceof Error ? error.message : String(error)}`));
        }
      }
      continue;
    }
    const local = candidateLocalEvidence(project, candidate, testCase);
    if (local) {
      if (testCase.executionMode === "roundtrip" && local.trace.some((step) => step.id === `candidate-frozen-roundtrip-${candidate.id}-${testCase.id}` || step.id === `candidate-roundtrip-${candidate.id}-${testCase.id}`)) {
        const textRoundtrip = local.trace.some((step) => step.id === `candidate-roundtrip-${candidate.id}-${testCase.id}`);
        const snapshots = snapshotsForTest(project, candidate, testCase);
        const mappedIds = new Set(testCase.criterionIds.flatMap((id) => project.acceptanceRubric.filter((criterion) => criterion.id === id).flatMap((criterion) => criterion.artifactIds)));
        const targetIds = project.sourceArtifacts.filter((source) => source.role === "target").map((source) => source.id);
        const expectedIds = mappedIds.size ? [...mappedIds] : targetIds;
        const exactCoverage = expectedIds.length > 0
          && new Set(targetIds).size === targetIds.length
          && snapshots.length === expectedIds.length
          && new Set(snapshots.map((snapshot) => snapshot.sourceArtifactId)).size === snapshots.length
          && snapshots.every((snapshot) => expectedIds.includes(snapshot.sourceArtifactId) && snapshot.frozenArtifact?.sourceArtifactId === snapshot.sourceArtifactId);
        let validated = false;
        if (exactCoverage && ports.verifyFrozenArtifact && (!textRoundtrip || local.verificationStatus === "partial")) {
          try {
            validated = (await Promise.all(snapshots.map((snapshot) => ports.verifyFrozenArtifact!(snapshot)))).every(Boolean);
          } catch {
            validated = false;
          }
        }
        ordered.set(testCase.id, validated ? {
          ...local,
          output: `CANDIDATE FROZEN ARTIFACT ROUNDTRIP VERIFIED\n${local.output}\n本轮已重新读取每份实际 Blob，并核对 Snapshot 绑定、大小及 SHA-256。`,
          verificationStatus: "verified",
          artifactHash: snapshots.length === 1 ? snapshots[0]!.frozenArtifact!.sha256 : undefined,
          trace: [...local.trace, { id: `server-frozen-roundtrip-${testCase.id}`, stage: "format-roundtrip", summary: "本轮已重新核对冻结文件字节", status: "pass", detail: frozenRoundtripSignature(snapshots) }],
        } : unavailableFrozenRoundtrip(testCase, "Candidate 冻结文件未通过本轮 Blob 回读、完整 Target 覆盖或 SHA-256 校验。"));
        continue;
      }
      ordered.set(testCase.id, local);
      continue;
    }
    if (testCase.executionMode === "external-runner" || testCase.executionMode === "visual-review") {
      externalCases.push(testCase);
      continue;
    }
    if (testCase.executionMode === "artifact-runtime") {
      semanticCases.push(testCase);
      continue;
    }
    ordered.set(testCase.id, unavailableExperimentRun(testCase, `Server Experiment 暂不支持 executionMode=${testCase.executionMode} 的真实执行。`));
  }

  if (externalCases.length) {
    if (!ports.executeExternalBatch) {
      for (const testCase of externalCases) ordered.set(testCase.id, unavailableExperimentRun(testCase, "Server External Runner / Sandbox 未连接。"));
    } else {
      try {
        const results = await ports.executeExternalBatch({ project, candidate, testCases: externalCases });
        const { byId, duplicateIds } = indexUniqueBatchResults(results);
        for (const testCase of externalCases) {
          ordered.set(testCase.id, duplicateIds.has(testCase.id)
            ? unavailableExperimentRun(testCase, "Server External Runner 对本题返回了重复结果，证据身份不明确。")
            : byId.get(testCase.id) ?? unavailableExperimentRun(testCase, "Server External Runner 没有返回本题结果。"));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const testCase of externalCases) ordered.set(testCase.id, unavailableExperimentRun(testCase, `Server External Runner 未完成：${message}`));
      }
    }
  }

  if (semanticCases.length) {
    const started = Date.now();
    try {
      const result = await ports.executeSemanticBatch({
        project,
        candidate,
        testCases: semanticCases,
        artifactContext: candidateArtifactContext(project, candidate),
      });
      const { byId, duplicateIds } = indexUniqueBatchResults(result.results);
      const latency = Math.max(1, Math.round((Date.now() - started) / Math.max(1, semanticCases.length)));
      for (const testCase of semanticCases) {
        const item = byId.get(testCase.id);
        ordered.set(testCase.id, duplicateIds.has(testCase.id)
          ? unavailableExperimentRun(testCase, "Server AI Batch 对本题返回了重复结果，证据身份不明确。")
          : item ? {
          testCaseId: testCase.id,
          output: item.output,
          latencyMs: latency,
          cost: 0,
          verificationStatus: serverExperimentSemanticStatus(item.output),
          trace: [{
            id: `server-candidate-semantic-${candidate.id}-${testCase.id}`,
            stage: "AI 语义核查",
            summary: "Server AI 读取 exact Candidate Snapshot 并按本题定位显性内容",
            status: "info",
            detail: "该执行只提供 Candidate 成果观察；独立 Judge 负责最终 Rubric 结算。",
          }, ...item.trace],
        } : unavailableExperimentRun(testCase, "Server AI Batch 未返回本题结果。"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const testCase of semanticCases) ordered.set(testCase.id, unavailableExperimentRun(testCase, `Server AI Artifact Runtime 未完成：${message}`));
    }
  }
  const runs = testCases.map((testCase) => ordered.get(testCase.id) ?? unavailableExperimentRun(testCase, "Candidate 执行未返回结果。"));
  return normalizeLocallyVerifiableCandidateRuns(project, candidate, testCases, runs);
}

export async function judgeServerExperimentCandidate(
  project: EvolveProject,
  candidate: Candidate,
  runs: TargetRunResult[],
  ports: ServerExperimentExecutionPorts,
  testCases: TestCase[] = project.evalSuite,
  mode = "server-candidate",
) {
  const judgeCriteria = criteriaRequiringJudge(project.acceptanceRubric, testCases, runs);
  const judgeIds = new Set(judgeCriteria.map((criterion) => criterion.id));
  const evaluableRunIds = new Set(runs
    .filter((run) => run.verificationStatus === "verified" || run.verificationStatus === "partial")
    .map((run) => run.testCaseId));
  const judgeCases = testCases.filter((testCase) =>
    evaluableRunIds.has(testCase.id)
    && (testCase.criterionIds.length === 0 || testCase.criterionIds.some((id) => judgeIds.has(id))));
  const judgeCaseIds = new Set(judgeCases.map((testCase) => testCase.id));
  const effectiveCriteria = judgeCriteria.filter((criterion) =>
    judgeCases.some((testCase) => testCase.criterionIds.includes(criterion.id)));
  if (!judgeCases.length || !effectiveCriteria.length) return deterministicOnlyEvaluation(project, testCases, runs);
  const payload = {
    mode,
    candidate: { id: candidate.id },
    project: {
      goal: project.goal,
      metrics: project.metrics,
      acceptanceRubric: effectiveCriteria,
    },
    acceptanceRubric: effectiveCriteria,
    evaluatorInstruction: "Judge only the supplied exact Candidate evidence. Never cite diagnosis, plan, patches or expected impact as observed proof. UNVERIFIED tests are omitted and must not be invented as failures. PARTIAL evidence cannot fully satisfy a hard gate.",
    testCases: judgeCases.map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      input: testCase.input.slice(0, 1600),
      expected: testCase.expected,
      tags: testCase.tags,
      criterionIds: testCase.criterionIds,
      executionMode: testCase.executionMode,
      evidenceScope: testCase.evidenceScope,
    })),
    runs: runs.filter((run) => judgeCaseIds.has(run.testCaseId)).map((run) => {
      const testCase = testCases.find((item) => item.id === run.testCaseId);
      const query = `${testCase?.title ?? ""} ${testCase?.input ?? ""} ${(testCase?.expected ?? []).join(" ")}`;
      return {
        testCaseId: run.testCaseId,
        verificationStatus: run.verificationStatus,
        outputChunks: [compactExperimentRunOutput(run.output, query)],
        trace: run.trace.slice(0, 12).map((step) => ({ stage: step.stage, status: step.status, summary: step.summary })),
      };
    }),
  };
  const ai = await ports.judge(payload);
  return settleAiEvaluation({
    criteria: project.acceptanceRubric,
    testCases,
    runs,
    ai,
    notes: [
      `Server Experiment：Candidate ${candidate.id} 已完成实际 Artifact 执行与独立 Judge。`,
      ...(runs.some((run) => run.verificationStatus === "unverified")
        ? ["部分测试仍缺真实运行能力；对应 Criterion 保持 UNVERIFIED，不作为产品失败。"]
        : []),
    ],
  });
}
