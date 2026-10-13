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
  originalHtmlBaselineDiagnosticCase,
  originalHtmlBaselineDiagnosticEligibility,
  OriginalHtmlBaselineDiagnosticBindingSchema,
  type OriginalHtmlBaselineDiagnosticBinding,
  type OriginalHtmlBaselineDiagnosticEligibility,
  baselineDeferredComparisonCriterionIds,
  htmlProtectionContractBlocker,
  campaignLiveObservationFresh,
  campaignObservesLiveTarget,
  campaignRootBaselineForMeasurement,
  campaignScoringInputBlocker,
  campaignScoringInputFingerprint,
  criteriaRequiringJudge,
  rubricSuiteCoverage,
  rubricValidation,
  settleAiEvaluation,
  settleDeterministicEvaluation,
} from "@evolution/core";
import {
  baselineLocalEvidence,
  currentSemanticArtifactContext,
  serverBaselineCurrentViewGap,
  semanticEvidenceStatus,
  serverBaselineFingerprint,
  storedBaselineEvidence,
  unavailableBaselineRun,
} from "./server-baseline-evidence";
import { serverJudgeEvidence } from "./server-judge-evidence";
import { indexUniqueBatchResults } from "./server-batch-results";
import { serverExperimentRecoveryCheckpoint } from "./server-experiment-wait";
import { serverMainFlowRecoveryCheckpoint } from "./server-main-flow-wait";

export { trustedServerBaselineChampion, serverBaselineFingerprint } from "./server-baseline-evidence";

/** Stop durable Campaign comparisons before a changed Server AI scoring route can reuse old scores. */
export function serverCampaignScoringRouteBlocker(project: EvolveProject, routeFingerprint?: string): string | undefined {
  if (!routeFingerprint || project.campaign.currentRound === 0) return undefined;
  if (project.campaign.scoringRouteFingerprint === routeFingerprint) return undefined;
  return "[server-campaign-scoring-route-changed] 服务端执行或评审配置已变化，旧 Campaign 分数不可直接比较；请重置搜索后重新运行。生产发布状态不会被重置。";
}
/** A ready score is reusable only for the exact current Target, tests, Champion and Server AI route. */
export function canReuseServerBaseline(project: EvolveProject, routeFingerprint?: string, nowMs = Date.now()): boolean {
  if (htmlProtectionContractBlocker(project)) return false;
  if (campaignObservesLiveTarget(project) && (project.campaign.checkpoint?.round !== project.campaign.currentRound + 1
    || !campaignLiveObservationFresh(project, project.baselineRun.completedAt, nowMs))) return false;

  return baselineReadiness(project).ready
    && !serverBaselineEvidenceGaps(project).requiredCapabilityGaps.length
    && !serverBaselineEvidenceGaps(project).hardGateGaps.length
    && project.baselineRun.measurementFingerprint === serverBaselineFingerprint(project, routeFingerprint);
}
export type ServerBaselinePorts = {
  scoringRouteFingerprint?: string;
  executeSemanticBatch(args: {
    project: EvolveProject;
    testCases: TestCase[];
    artifactContext: Array<Record<string, unknown>>;
  }): Promise<ExecuteArtifactBatchAiResult>;
  /** Server-owned physical read port; no public/AI field can provide diagnosis eligibility. */
  readOriginalHtmlDiagnosticBinding?(args: { project: EvolveProject; testCase: TestCase }): Promise<unknown>;
  executeStoredEvidence?(args: { project: EvolveProject; testCase: TestCase }): Promise<TargetRunResult>;
  buildCurrentArtifactContext?(args: { project: EvolveProject; testCases?: TestCase[] }): Promise<Array<Record<string, unknown>>>;
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
  /** Fresh diagnosis-only qualification; never stored as acceptance or reused by canReuseServerBaseline. */
  diagnosticEligibility?: OriginalHtmlBaselineDiagnosticEligibility;
};

/**
 * Run the visible Baseline on the server without React/browser runtime dependencies.
 * Missing capabilities remain UNVERIFIED; infrastructure absence is never converted to product failure.
 */
export async function runServerBaseline(
  callerProject: EvolveProject,
  ports: ServerBaselinePorts,
  options?: { now?: () => string },
): Promise<ServerBaselineOutcome> {
  // Keep one owned generation across storage, execution and independent Judge awaits.
  const inputProject = structuredClone(callerProject);
  const inputGenerationWire = JSON.stringify(inputProject);
  const now = options?.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const scoringBlocker = htmlProtectionContractBlocker(inputProject) ?? campaignScoringInputBlocker(inputProject) ?? serverCampaignScoringRouteBlocker(inputProject, ports.scoringRouteFingerprint);
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

  const diagnosticCase = ports.readOriginalHtmlDiagnosticBinding ? originalHtmlBaselineDiagnosticCase(project) : undefined;
  let initialDiagnosticBinding: OriginalHtmlBaselineDiagnosticBinding | undefined;
  if (diagnosticCase && ports.readOriginalHtmlDiagnosticBinding) {
    try {
      initialDiagnosticBinding = OriginalHtmlBaselineDiagnosticBindingSchema.parse(await ports.readOriginalHtmlDiagnosticBinding({
        project: structuredClone(project), testCase: structuredClone(diagnosticCase),
      }));
    } catch { /* Missing/changed physical inputs retain the original evidence pause. */ }
  }
  const ordered = new Map<string, TargetRunResult>();
  const semanticCases: TestCase[] = [];
  const externalCases: TestCase[] = [];
  const deferredCriteria = baselineDeferredComparisonCriterionIds(project);
  for (const originalCase of project.evalSuite) {
    const comparisonOnly = originalCase.criterionIds.length > 0 && originalCase.criterionIds.every(id => deferredCriteria.has(id));
    if (comparisonOnly) {
      ordered.set(originalCase.id, unavailableBaselineRun(originalCase, "原版 Baseline 是对照起点；Candidate 相对改进与原始保护对照在实验及 Hidden 阶段验证，不在此处声明通过。"));
      continue;
    }
    const testCase = { ...originalCase, criterionIds: originalCase.criterionIds.filter(id => !deferredCriteria.has(id)) };
    const stored = structuredClone(await storedBaselineEvidence(project, testCase, ports.executeStoredEvidence
      ? args => ports.executeStoredEvidence!({ project: structuredClone(args.project), testCase: structuredClone(args.testCase) })
      : undefined));
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
        const results = structuredClone(await ports.executeExternalBatch({
          project: structuredClone(project), testCases: structuredClone(externalCases),
        }));
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
      const artifactContext = structuredClone(await currentSemanticArtifactContext(project, ports.buildCurrentArtifactContext
        ? args => ports.buildCurrentArtifactContext!({ project: structuredClone(args.project),
          testCases: args.testCases ? structuredClone(args.testCases) : undefined }) : undefined, semanticCases));
      // The App context computed this digest from actual current bytes. It is not inferred from AI output.
      const targets = project.sourceArtifacts.filter(source => source.role === "target");
      const contexts = targets.length === 1 ? artifactContext.filter(item => item.id === targets[0]!.id) : [];
      const currentArtifactHash = ports.readOriginalHtmlDiagnosticBinding && contexts.length === 1
        && !contexts[0]!.truncated && typeof contexts[0]!.artifactSha256 === "string"
        && /^[a-f0-9]{64}$/.test(contexts[0]!.artifactSha256) ? contexts[0]!.artifactSha256 : undefined;
      const result = structuredClone(await ports.executeSemanticBatch({
        project: structuredClone(project),
        testCases: structuredClone(semanticCases),
        artifactContext: structuredClone(artifactContext),
      }));
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
          ...(currentArtifactHash ? { artifactHash: currentArtifactHash } : {}),
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

  // The current-only phase keeps its complete stored paper; only its Judge projection omits future comparisons.
  const baselineCases = project.evalSuite.map(testCase => ({ ...testCase, criterionIds: testCase.criterionIds.filter(id => !deferredCriteria.has(id)) }));
  const judgeCriteria = criteriaRequiringJudge(project.acceptanceRubric, baselineCases, runs);
  const judgeIds = new Set(judgeCriteria.map((criterion) => criterion.id));
  const evaluableIds = new Set(
    project.evalSuite
      .filter((testCase) => testCase.criterionIds.length === 0 || testCase.criterionIds.some((id) => judgeIds.has(id)))
      .map((testCase) => testCase.id),
  );
  const judgeRuns = evaluableRuns.filter((run) => evaluableIds.has(run.testCaseId));
  const judgeRunIds = new Set(judgeRuns.map((run) => run.testCaseId));
  const judgeCases = baselineCases.filter((testCase) => judgeRunIds.has(testCase.id));
  const effectiveCriteria = judgeCriteria.filter((criterion) => judgeCases.some((testCase) => testCase.criterionIds.includes(criterion.id)));
  const judgeEvidence = judgeRuns.map(run => {
    const testCase = baselineCases.find(item => item.id === run.testCaseId);
    const query = `${testCase?.title ?? ""} ${testCase?.input ?? ""} ${(testCase?.expected ?? []).join(" ")}`;
    return serverJudgeEvidence(run, query);
  });
  const evaluationRuns = runs.map(run => judgeEvidence.find(item => item.run.testCaseId === run.testCaseId)?.run ?? run);
  const judgePayload = {
    mode: "server-baseline",
    project: {
      goal: project.goal,
      metrics: project.metrics,
      acceptanceRubric: effectiveCriteria,
    },
    acceptanceRubric: effectiveCriteria,
    evaluatorInstruction: "Judge only supplied current Baseline evidence for the explicitly listed criterion IDs. Candidate-only relative improvement/protection comparisons omitted from this phase are deferred until Candidate comparison; if a mixed paper also mentions Original vs Evolved, judge the current arm against current applicable content requirements only. Never cite diagnosis, plans or patches. UNVERIFIED tests are omitted and must not be invented as failures. PARTIAL evidence cannot fully satisfy a hard gate.",
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
    runs: judgeEvidence.map(item => item.payload),
  };

  let evaluation;
  let independentJudge: EvaluateAiResult | undefined;
  try {
    if (!judgeRuns.length || !effectiveCriteria.length) {
      evaluation = settleDeterministicEvaluation({
        criteria: project.acceptanceRubric, scope: project,
        testCases: baselineCases,
        runs,
        notes: ["Server Baseline：仅结算已获得的确定性证据；缺失语义评审的标准保持 UNVERIFIED，通用质量维度未测量。"],
      });
    } else {
      const judged = structuredClone(await ports.judge(structuredClone(judgePayload)));
      independentJudge = structuredClone(judged);
      evaluation = settleAiEvaluation({
        criteria: project.acceptanceRubric, scope: project,
        testCases: baselineCases,
        runs: evaluationRuns,
        ai: judged,
        notes: [
          "Server Baseline：执行与独立 Judge 均在 Durable Workflow 后端完成。",
          ...(runs.some((run) => run.verificationStatus === "unverified")
            ? ["部分测试仍缺真实执行能力；对应 Criterion 保持 UNVERIFIED/PARTIAL，不按产品失败处理。"]
            : []),
        ],
      });
    }
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
  const { requiredCapabilityGaps, hardGateGaps } = serverBaselineEvidenceGaps({ ...project, baselineRun: baseline });
  const measured: EvolveProject = {
    ...project,
    baselineRun: baseline,
    campaign: {
      ...project.campaign,
      rootBaseline: campaignRootBaselineForMeasurement(project, evaluation, ports.scoringRouteFingerprint, true),
      scoringRouteFingerprint: project.campaign.currentRound === 0 ? ports.scoringRouteFingerprint ?? project.campaign.scoringRouteFingerprint : project.campaign.scoringRouteFingerprint,
      scoringInputFingerprint: project.campaign.currentRound === 0 ? campaignScoringInputFingerprint(project) : project.campaign.scoringInputFingerprint,
    },
    updatedAt: now(),
  };
  const readiness = baselineReadiness(measured);
  let diagnosticEligibility: OriginalHtmlBaselineDiagnosticEligibility | undefined;
  if (!requiredCapabilityGaps.length && readiness.ready && hardGateGaps.length === 1
    && hardGateGaps[0]?.id === "SYS-INTEGRITY" && diagnosticCase && initialDiagnosticBinding
    && independentJudge && ports.readOriginalHtmlDiagnosticBinding) {
    try {
      const finalDiagnosticBinding = await ports.readOriginalHtmlDiagnosticBinding({
        project: structuredClone(measured), testCase: structuredClone(diagnosticCase),
      });
      diagnosticEligibility = originalHtmlBaselineDiagnosticEligibility({ project: measured,
        initialBinding: initialDiagnosticBinding, finalBinding: finalDiagnosticBinding, independentJudge });
    } catch { /* No serialized claim or readback failure grants a diagnosis exception. */ }
  }
  // A separate caller generation is never paired with the observations of this snapshot.
  const callerGenerationChanged = JSON.stringify(callerProject) !== inputGenerationWire;
  if (callerGenerationChanged) diagnosticEligibility = undefined;
  if (callerGenerationChanged || !diagnosticEligibility && (requiredCapabilityGaps.length || hardGateGaps.length || !readiness.ready)) {
    const details = [
      ...(callerGenerationChanged ? ["调用方输入在测量等待期间发生变化；旧证据未用于新一代诊断"] : []),
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
  // A fresh comparison reruns observations without discarding checkpoint-bound frozen construction.
  const recoveryCheckpoint = serverMainFlowRecoveryCheckpoint(inputProject);
  const experimentCheckpoint = serverExperimentRecoveryCheckpoint(inputProject) ? inputProject.campaign.checkpoint : undefined;
  const retainedCheckpoint = recoveryCheckpoint ?? experimentCheckpoint;
  const readyProject: EvolveProject = {
    ...measured,
    stage: recoveryCheckpoint ? inputProject.stage : experimentCheckpoint ? "experiment" : "problem",
    campaign: {
      ...measured.campaign,
      status: "running",
      stopReason: undefined,
      serverRecoveryWait: undefined,
      checkpoint: retainedCheckpoint ?? {
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
    reason: `Server Baseline 已完成：${readiness.verified} verified / ${readiness.partial} partial，证据覆盖 ${readiness.evidenceCoverage}%`
      + (diagnosticEligibility ? "；当次原始 HTML 文件测量可用于诊断，完整保护仍未验收。" : ""),
    capabilityGaps: diagnosticEligibility ? diagnosticEligibility.pendingCriterionIds.map(id => `criterion:${id}`) : [],
    ...(diagnosticEligibility ? { diagnosticEligibility } : {}),
  };
}


/** Initial measurement and cache reuse must obey the same evidence boundary. */
function serverBaselineEvidenceGaps(project: EvolveProject) {
  const runById = new Map(project.baselineRun.runs.map((run) => [run.testCaseId, run]));
  const deferredCriteria = baselineDeferredComparisonCriterionIds(project);
  const requiredCapabilityGaps = project.evalSuite.filter((testCase) => {
    const comparisonOnly = testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => deferredCriteria.has(id));
    if (comparisonOnly) return false;
    const status = runById.get(testCase.id)?.verificationStatus ?? "unverified";
    return status === "unverified" || status === "failed";
  });
  const criterionById = new Map((project.baselineRun.result?.criterionScores ?? []).map((item) => [item.criterionId, item]));
  const hardGateGaps = project.acceptanceRubric.filter((criterion) =>
    criterion.hardGate && !deferredCriteria.has(criterion.id) && criterionById.get(criterion.id)?.verificationStatus !== "verified");
  return { requiredCapabilityGaps, hardGateGaps };
}
