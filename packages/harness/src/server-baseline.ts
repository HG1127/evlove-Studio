import type {
  BaselineRun,
  EvaluateAiResult,
  ExecuteArtifactBatchAiResult,
  EvolveProject,
  TargetRunResult,
  TestCase,
} from "@evolution/contracts";
import {
  baselineReadiness,
  campaignRootBaselineForMeasurement,
  campaignScoringInputBlocker,
  campaignScoringInputFingerprint,
  criteriaRequiringJudge,
  rubricSuiteCoverage,
  rubricValidation,
  settleAiEvaluation,
} from "@evolution/core";
import {
  baselineLocalEvidence,
  compactBaselineRunOutput,
  currentSemanticArtifactContext,
  serverBaselineCurrentViewGap,
  semanticEvidenceStatus,
  serverBaselineFingerprint,
  storedBaselineEvidence,
  unavailableBaselineRun,
} from "./server-baseline-evidence";
import { indexUniqueBatchResults } from "./server-batch-results";

export { trustedServerBaselineChampion, serverBaselineFingerprint } from "./server-baseline-evidence";

/** Stop durable Campaign comparisons before a changed Server AI scoring route can reuse old scores. */
export function serverCampaignScoringRouteBlocker(project: EvolveProject, routeFingerprint?: string): string | undefined {
  if (!routeFingerprint || project.campaign.currentRound === 0) return undefined;
  if (project.campaign.scoringRouteFingerprint === routeFingerprint) return undefined;
  return "[server-campaign-scoring-route-changed] 服务端执行或评审模型已变化，旧 Campaign 分数不可直接比较；请重置搜索后重新运行。生产发布状态不会被重置。";
}
/** A ready score is reusable only for the exact current Target, tests, Champion and Server AI route. */
export function canReuseServerBaseline(project: EvolveProject, routeFingerprint?: string): boolean {
  return baselineReadiness(project).ready
    && project.baselineRun.measurementFingerprint === serverBaselineFingerprint(project, routeFingerprint);
}
export type ServerBaselinePorts = {
  scoringRouteFingerprint?: string;
  executeSemanticBatch(args: {
    project: EvolveProject;
    testCases: TestCase[];
    artifactContext: Array<Record<string, unknown>>;
  }): Promise<ExecuteArtifactBatchAiResult>;
  executeStoredEvidence?(args: { project: EvolveProject; testCase: TestCase }): Promise<TargetRunResult>;
  buildCurrentArtifactContext?(args: { project: EvolveProject }): Promise<Array<Record<string, unknown>>>;
  executeExternalBatch?(args: {
    project: EvolveProject;
    testCases: TestCase[];
  }): Promise<TargetRunResult[]>;
  judge(payload: unknown): Promise<EvaluateAiResult>;
};

export type ServerBaselineOutcome = {
  project: EvolveProject;
  baseline: BaselineRun;
  ready: boolean;
  reason: string;
  capabilityGaps: string[];
};

/**
 * Run the visible Baseline on the server without React/browser runtime dependencies.
 * Missing capabilities remain UNVERIFIED; infrastructure absence is never converted to product failure.
 */
export async function runServerBaseline(
  inputProject: EvolveProject,
  ports: ServerBaselinePorts,
  options?: { now?: () => string },
): Promise<ServerBaselineOutcome> {
  const now = options?.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const scoringBlocker = campaignScoringInputBlocker(inputProject) ?? serverCampaignScoringRouteBlocker(inputProject, ports.scoringRouteFingerprint);
  if (scoringBlocker) {
    const paused: EvolveProject = {
      ...inputProject,
      campaign: {
        ...inputProject.campaign,
        status: "paused",
        stopReason: scoringBlocker,
        schedule: { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: startedAt,
    };
    return { project: paused, baseline: paused.baselineRun, ready: false, reason: scoringBlocker, capabilityGaps: ["server-scoring-contract"] };
  }
  const targetGate = inputProject.gates.find((gate) => gate.id === "target-ready");
  if (targetGate?.status !== "approved") throw new Error("Target Ready gate is not approved");
  if (!inputProject.evalSuite.length) throw new Error("Project evalSuite is empty");
  const rubricCheck = rubricValidation(inputProject.acceptanceRubric);
  if (!rubricCheck.ready) throw new Error(`Acceptance Rubric is not ready: ${rubricCheck.warnings.join("；")}`);
  const coverage = rubricSuiteCoverage(inputProject.acceptanceRubric, inputProject.evalSuite, inputProject.hiddenEvalSuite);
  if (!coverage.ready) {
    throw new Error(`Eval Suite does not cover current Acceptance Rubric: ${[
      ...coverage.uncovered,
      ...coverage.hiddenHardGateMissing.map((criterion) => criterion.id),
    ].join(", ")}`);
  }

  const project: EvolveProject = {
    ...inputProject,
    baselineRun: {
      ...inputProject.baselineRun,
      id: `baseline-server-${Date.parse(startedAt) || Date.now()}`,
      status: "running",
      startedAt,
      completedAt: undefined,
      totalCases: inputProject.evalSuite.length,
      runs: [],
      result: undefined,
      measurementFingerprint: serverBaselineFingerprint(inputProject, ports.scoringRouteFingerprint),
    },
    stage: "baseline",
    updatedAt: startedAt,
  };

  const ordered = new Map<string, TargetRunResult>();
  const semanticCases: TestCase[] = [];
  const externalCases: TestCase[] = [];
  for (const testCase of project.evalSuite) {
    const stored = await storedBaselineEvidence(project, testCase, ports.executeStoredEvidence);
    if (stored) { ordered.set(testCase.id, stored); continue; }
    const currentViewGap = testCase.executionMode === "artifact-runtime" && ports.buildCurrentArtifactContext
      ? undefined : serverBaselineCurrentViewGap(project, testCase);
    if (currentViewGap) {
      ordered.set(testCase.id, unavailableBaselineRun(testCase, currentViewGap));
      continue;
    }
    const local = baselineLocalEvidence(project, testCase);
    if (local) {
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
    ordered.set(testCase.id, unavailableBaselineRun(testCase, `Server Baseline 暂不支持 executionMode=${testCase.executionMode} 的真实执行。`));
  }

  if (externalCases.length) {
    if (!ports.executeExternalBatch) {
      for (const testCase of externalCases) ordered.set(testCase.id, unavailableBaselineRun(testCase, "Server External Runner / Sandbox 未连接。"));
    } else {
      try {
        const results = await ports.executeExternalBatch({ project, testCases: externalCases });
        const { byId, duplicateIds } = indexUniqueBatchResults(results);
        for (const testCase of externalCases) {
          ordered.set(testCase.id, duplicateIds.has(testCase.id)
            ? unavailableBaselineRun(testCase, "Server External Runner 对本题返回了重复结果，证据身份不明确。")
            : byId.get(testCase.id) ?? unavailableBaselineRun(testCase, "Server External Runner 没有返回本题结果。"));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const testCase of externalCases) ordered.set(testCase.id, unavailableBaselineRun(testCase, `Server External Runner 未完成：${message}`));
      }
    }
  }

  if (semanticCases.length) {
    const semanticStarted = Date.now();
    try {
      const artifactContext = await currentSemanticArtifactContext(project, ports.buildCurrentArtifactContext);
      const result = await ports.executeSemanticBatch({
        project,
        testCases: semanticCases,
        artifactContext,
      });
      const { byId, duplicateIds } = indexUniqueBatchResults(result.results);
      const latency = Math.max(1, Math.round((Date.now() - semanticStarted) / Math.max(1, semanticCases.length)));
      for (const testCase of semanticCases) {
        const item = byId.get(testCase.id);
        ordered.set(testCase.id, duplicateIds.has(testCase.id)
          ? unavailableBaselineRun(testCase, "Server AI Batch 对本题返回了重复结果，证据身份不明确。")
          : item ? {
          testCaseId: testCase.id,
          output: item.output,
          latencyMs: latency,
          cost: 0,
          verificationStatus: artifactContext.some((artifact) => artifact.truncated) && semanticEvidenceStatus(item.output) === "verified" ? "partial" : semanticEvidenceStatus(item.output),
          trace: [{
            id: `server-semantic-${testCase.id}`,
            stage: "AI 语义核查",
            summary: "Server AI 读取当前 Baseline 成果并按本题定位显性内容",
            status: "info",
            detail: "这是成果观察证据；独立 Judge 仍负责 Rubric 结算。",
          }, ...item.trace],
        } : unavailableBaselineRun(testCase, "Server AI Batch 未返回本题结果。"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const testCase of semanticCases) ordered.set(testCase.id, unavailableBaselineRun(testCase, `Server AI Artifact Runtime 未完成：${message}`));
    }
  }

  const runs = project.evalSuite.map((testCase) => ordered.get(testCase.id) ?? unavailableBaselineRun(testCase, "Baseline 执行未返回结果。"));
  const evaluableRuns = runs.filter((run) => run.verificationStatus === "verified" || run.verificationStatus === "partial");
  if (!evaluableRuns.length) {
    const baseline: BaselineRun = {
      ...project.baselineRun,
      status: "failed",
      completedAt: now(),
      runs,
    };
    const reason = "[server-campaign-baseline-evidence-pending] Server Baseline 没有获得任何 VERIFIED/PARTIAL 证据；禁止进入诊断。";
    const nextProject = {
      ...project,
      baselineRun: baseline,
      campaign: {
        ...project.campaign,
        status: "paused" as const,
        stopReason: reason,
        schedule: { ...project.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: now(),
    };
    return { project: nextProject, baseline, ready: false, reason, capabilityGaps: runs.map((run) => run.testCaseId) };
  }

  const judgeCriteria = criteriaRequiringJudge(project.acceptanceRubric, project.evalSuite, runs);
  const judgeIds = new Set(judgeCriteria.map((criterion) => criterion.id));
  const evaluableIds = new Set(
    project.evalSuite
      .filter((testCase) => testCase.criterionIds.length === 0 || testCase.criterionIds.some((id) => judgeIds.has(id)))
      .map((testCase) => testCase.id),
  );
  const judgeRuns = evaluableRuns.filter((run) => evaluableIds.has(run.testCaseId));
  const judgePayload = {
    mode: "server-baseline",
    project: {
      goal: project.goal,
      metrics: project.metrics,
      acceptanceRubric: judgeCriteria,
    },
    acceptanceRubric: judgeCriteria,
    evaluatorInstruction: "Judge only supplied current Baseline evidence. Never cite diagnosis, plans or patches. UNVERIFIED tests are omitted and must not be invented as failures. PARTIAL evidence cannot fully satisfy a hard gate.",
    testCases: project.evalSuite.filter((testCase) => evaluableIds.has(testCase.id)).map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      input: testCase.input.slice(0, 1600),
      expected: testCase.expected,
      tags: testCase.tags,
      criterionIds: testCase.criterionIds,
      executionMode: testCase.executionMode,
      evidenceScope: testCase.evidenceScope,
    })),
    runs: judgeRuns.map((run) => {
      const testCase = project.evalSuite.find((item) => item.id === run.testCaseId);
      const query = `${testCase?.title ?? ""} ${testCase?.input ?? ""} ${(testCase?.expected ?? []).join(" ")}`;
      return {
        testCaseId: run.testCaseId,
        verificationStatus: run.verificationStatus,
        outputChunks: [compactBaselineRunOutput(run.output, query)],
        trace: run.trace.slice(0, 12).map((step) => ({ stage: step.stage, status: step.status, summary: step.summary })),
      };
    }),
  };

  let evaluation;
  try {
    const judged = await ports.judge(judgePayload);
    evaluation = settleAiEvaluation({
      criteria: project.acceptanceRubric,
      testCases: project.evalSuite,
      runs,
      ai: judged,
      notes: [
        "Server Baseline：执行与独立 Judge 均在 Durable Workflow 后端完成。",
        ...(runs.some((run) => run.verificationStatus === "unverified")
          ? ["部分测试仍缺真实执行能力；对应 Criterion 保持 UNVERIFIED/PARTIAL，不按产品失败处理。"]
          : []),
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const baseline: BaselineRun = {
      ...project.baselineRun,
      status: "failed",
      completedAt: now(),
      runs,
    };
    const reason = `[server-campaign-baseline-judge-pending] Baseline 执行已有证据，但独立 Server Judge 未完成：${message}`;
    const nextProject = {
      ...project,
      baselineRun: baseline,
      campaign: {
        ...project.campaign,
        status: "paused" as const,
        stopReason: reason,
        schedule: { ...project.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: now(),
    };
    return { project: nextProject, baseline, ready: false, reason, capabilityGaps: ["server-judge"] };
  }

  const baseline: BaselineRun = {
    ...project.baselineRun,
    status: "completed",
    completedAt: now(),
    runs,
    result: evaluation,
  };
  const runById = new Map(runs.map((run) => [run.testCaseId, run]));
  const requiredCapabilityGaps = project.evalSuite.filter((testCase) => {
    const comparisonOnly = testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE");
    if (comparisonOnly) return false;
    const status = runById.get(testCase.id)?.verificationStatus ?? "unverified";
    return status === "unverified" || status === "failed";
  });
  const criterionById = new Map((evaluation.criterionScores ?? []).map((item) => [item.criterionId, item]));
  const hardGateGaps = project.acceptanceRubric.filter((criterion) =>
    criterion.hardGate && criterionById.get(criterion.id)?.verificationStatus !== "verified");
  const measured: EvolveProject = {
    ...project,
    baselineRun: baseline,
    campaign: {
      ...project.campaign,
      rootBaseline: campaignRootBaselineForMeasurement(project, evaluation, ports.scoringRouteFingerprint, !baselineReadiness(project).ready),
      scoringRouteFingerprint: project.campaign.currentRound === 0 ? ports.scoringRouteFingerprint ?? project.campaign.scoringRouteFingerprint : project.campaign.scoringRouteFingerprint,
      scoringInputFingerprint: project.campaign.currentRound === 0 ? campaignScoringInputFingerprint(project) : project.campaign.scoringInputFingerprint,
    },
    updatedAt: now(),
  };
  const readiness = baselineReadiness(measured);
  if (requiredCapabilityGaps.length || hardGateGaps.length || !readiness.ready) {
    const details = [
      ...readiness.blockers,
      ...(requiredCapabilityGaps.length ? [`未完成真实执行：${requiredCapabilityGaps.map((item) => item.id).join("、")}`] : []),
      ...(hardGateGaps.length ? [`Hard Gate 未获得 VERIFIED 证据：${hardGateGaps.map((item) => item.id).join("、")}`] : []),
    ];
    const reason = `[server-campaign-baseline-evidence-pending] Server Baseline 已完成，但证据仍不足以进入自动诊断：${details.join("；")}`;
    const paused: EvolveProject = {
      ...measured,
      stage: "baseline",
      campaign: {
        ...measured.campaign,
        status: "paused",
        stopReason: reason,
        schedule: { ...measured.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      updatedAt: now(),
    };
    return {
      project: paused,
      baseline,
      ready: false,
      reason,
      capabilityGaps: [...new Set([
        ...requiredCapabilityGaps.map((testCase) => testCase.id),
        ...hardGateGaps.map((criterion) => `criterion:${criterion.id}`),
      ])],
    };
  }

  const checkpointAt = now();
  const readyProject: EvolveProject = {
    ...measured,
    stage: "problem",
    campaign: {
      ...measured.campaign,
      status: "running",
      stopReason: undefined,
      checkpoint: {
        round: measured.campaign.currentRound + 1,
        completedPhase: "baseline",
        at: checkpointAt,
      },
    },
    updatedAt: checkpointAt,
  };
  return {
    project: readyProject,
    baseline,
    ready: true,
    reason: `Server Baseline 已完成：${readiness.verified} verified / ${readiness.partial} partial，证据覆盖 ${readiness.evidenceCoverage}%`,
    capabilityGaps: [],
  };
}
