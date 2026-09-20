import type {
  Candidate,
  EvaluateAiResult,
  ExecuteArtifactBatchAiResult,
  EvaluationResult,
  EvolveProject,
  TargetRunResult,
  TestCase,
} from "@evolution/contracts";
import {
  criteriaRequiringJudge,
  deriveCriterionScores,
  settleAiEvaluation,
} from "@evolution/core";
import {
  candidateArtifactContext,
  candidateLocalEvidence,
  compactExperimentRunOutput,
  serverExperimentSemanticStatus,
  unavailableExperimentRun,
} from "./server-experiment-evidence";

export type ServerExperimentExecutionPorts = {
  executeSemanticBatch(args: {
    project: EvolveProject;
    candidate: Candidate;
    testCases: TestCase[];
    artifactContext: Array<Record<string, unknown>>;
  }): Promise<ExecuteArtifactBatchAiResult>;
  executeExternalBatch?(args: {
    project: EvolveProject;
    candidate: Candidate;
    testCases: TestCase[];
  }): Promise<TargetRunResult[]>;
  judge(payload: unknown): Promise<EvaluateAiResult>;
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function deterministicOnlyEvaluation(
  project: EvolveProject,
  testCases: TestCase[],
  runs: TargetRunResult[],
): EvaluationResult {
  const rubric = deriveCriterionScores(project.acceptanceRubric, testCases, [], runs);
  const executed = runs.filter((run) => !run.error);
  const source = executed.length ? executed : runs;
  return {
    accuracy: 0,
    evidence: 0,
    riskCoverage: 0,
    completeness: 0,
    safety: "PASS",
    notes: ["本轮没有需要 AI Judge 的可执行语义标准；仅结算确定性证据。通用质量维度未测量，因此保持 0，不代表产品失败。"],
    failures: [],
    criterionScores: rubric.criterionScores,
    rubricScore: rubric.rubricScore,
    verifiedRubricCoverage: rubric.verifiedRubricCoverage,
    unverifiedCriterionIds: rubric.unverifiedCriterionIds,
    caseScores: [],
    averageCost: Number(average(source.map((run) => run.cost)).toFixed(4)),
    averageLatencyMs: Math.round(average(source.map((run) => run.latencyMs))),
  };
}

export async function executeServerExperimentCandidate(
  project: EvolveProject,
  candidate: Candidate,
  ports: ServerExperimentExecutionPorts,
): Promise<TargetRunResult[]> {
  const ordered = new Map<string, TargetRunResult>();
  const semanticCases: TestCase[] = [];
  const externalCases: TestCase[] = [];
  for (const testCase of project.evalSuite) {
    const local = candidateLocalEvidence(project, candidate, testCase);
    if (local) {
      ordered.set(testCase.id, local);
      continue;
    }
    if (testCase.executionMode === "external-runner") {
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
        const byId = new Map(results.map((run) => [run.testCaseId, run]));
        for (const testCase of externalCases) {
          ordered.set(testCase.id, byId.get(testCase.id) ?? unavailableExperimentRun(testCase, "Server External Runner 没有返回本题结果。"));
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
      const byId = new Map(result.results.map((item) => [item.testCaseId, item]));
      const latency = Math.max(1, Math.round((Date.now() - started) / Math.max(1, semanticCases.length)));
      for (const testCase of semanticCases) {
        const item = byId.get(testCase.id);
        ordered.set(testCase.id, item ? {
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
  return project.evalSuite.map((testCase) => ordered.get(testCase.id) ?? unavailableExperimentRun(testCase, "Experiment 执行未返回结果。"));
}

export async function judgeServerExperimentCandidate(
  project: EvolveProject,
  candidate: Candidate,
  runs: TargetRunResult[],
  ports: ServerExperimentExecutionPorts,
) {
  const judgeCriteria = criteriaRequiringJudge(project.acceptanceRubric, project.evalSuite, runs);
  const judgeIds = new Set(judgeCriteria.map((criterion) => criterion.id));
  const evaluableRunIds = new Set(runs
    .filter((run) => run.verificationStatus === "verified" || run.verificationStatus === "partial")
    .map((run) => run.testCaseId));
  const judgeCases = project.evalSuite.filter((testCase) =>
    evaluableRunIds.has(testCase.id)
    && (testCase.criterionIds.length === 0 || testCase.criterionIds.some((id) => judgeIds.has(id))));
  const judgeCaseIds = new Set(judgeCases.map((testCase) => testCase.id));
  const effectiveCriteria = judgeCriteria.filter((criterion) =>
    judgeCases.some((testCase) => testCase.criterionIds.includes(criterion.id)));
  if (!judgeCases.length || !effectiveCriteria.length) return deterministicOnlyEvaluation(project, project.evalSuite, runs);
  const payload = {
    mode: "server-candidate",
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
      const testCase = project.evalSuite.find((item) => item.id === run.testCaseId);
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
    testCases: project.evalSuite,
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
