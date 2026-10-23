import type {
  Candidate,
  EvolveProject,
  TargetRunResult,
  ReleaseReviewAiResult,
  TestCase,
  ValidationRun,
} from "@evolution/contracts";
import {
  computeGapAnalysis,
  evidenceFingerprint,
  gapHeadline,
  indexScopedAcceptanceResults,
  missingValidationEvidenceAction,
  validationDecision,
} from "@evolution/core";
import {
  executeServerCurrentArtifactSuite,
  judgeServerCurrentArtifactSuite,
  type ServerCurrentArtifactPorts,
} from "./server-current-artifact-runner";
import {
  executeServerExperimentCandidate,
  judgeServerExperimentCandidate,
  type ServerExperimentExecutionPorts,
} from "./server-experiment-runner";
import { serverBaselineFingerprint } from "./server-baseline-evidence";
import { readServerHoldoutArtifactFingerprint, recoverableServerHoldout, reusableServerHoldoutAssessment, serverHoldoutExecutionEvidenceFingerprint, type ServerHoldoutArtifactReader } from "./server-holdout-recovery";
import { exactServerHoldoutSuite, pauseServerHoldoutPreflight } from "./server-holdout-preflight";
import {fastHash} from "@evolution/core";

export type ServerHoldoutPorts = {
  scoringRouteFingerprint?: string;
  executionRuntimeFingerprint?: string;
  readArtifactFingerprint?: ServerHoldoutArtifactReader;
  current: ServerCurrentArtifactPorts;
  candidate: ServerExperimentExecutionPorts;
  releaseReview(payload: unknown): Promise<ReleaseReviewAiResult>;
};

export type ServerHoldoutOutcome = {
  control: "continue" | "stop";
  project: EvolveProject;
  validation: ValidationRun;
  reason: string;
  readyForArtifactAcceptance: boolean;
  evidenceIncomplete: boolean;
};

function holdoutChecks(
  project: EvolveProject,
  candidateEvaluation: NonNullable<ValidationRun["evaluation"]>,
  baselineEvaluation: NonNullable<ValidationRun["baselineEvaluation"]>,
  runs: ValidationRun["runs"],
  baselineRuns: ValidationRun["baselineRuns"],
  suite: TestCase[],
) {
  const decision = validationDecision(project, candidateEvaluation, baselineEvaluation);
  const gap = computeGapAnalysis({
    candidate: candidateEvaluation,
    baseline: baselineEvaluation,
    candidateRuns: runs,
    baselineRuns,
    testCases: suite,
  });
  const scoreById = indexScopedAcceptanceResults([{ requestedCriterionIds: project.acceptanceRubric.map((criterion) => criterion.id), results: candidateEvaluation.criterionScores ?? [] }]).byId;
  const checks: ValidationRun["checks"] = [
    ...(project.acceptanceRubric.length ? [{
      label: "Project-specific Rubric",
      status: decision.rubricCoverage < 100 || decision.unverifiedCriteria.length > 0
        ? "warning" as const
        : (candidateEvaluation.rubricScore ?? 0) >= 85 ? "pass" as const : "fail" as const,
      detail: `Rubric ${candidateEvaluation.rubricScore ?? "待评"} / 85；真实证据覆盖 ${decision.rubricCoverage}%。`,
    }] : []),
    ...decision.hardCriterionFailures.map((criterion) => ({
      label: `Hard Gate · ${criterion.title}`,
      status: "fail" as const,
      detail: `Criterion ${criterion.id} 已有真实证据且未达到最低 ${criterion.minScore} 分；${criterion.requirement}`,
    })),
    ...decision.unverifiedHardCriteria.map((criterion) => ({
      label: `待真实验证 · ${criterion.title}`,
      status: "warning" as const,
      detail: `Criterion ${criterion.id} 尚未获得 VERIFIED 证据；${missingValidationEvidenceAction(criterion)}。这不是产品失败。`,
    })),
    ...decision.unverifiedCriteria.filter((criterion) => !criterion.hardGate).map((criterion) => ({
      label: `待真实验证 · ${criterion.title}`,
      status: "warning" as const,
      detail: `Criterion ${criterion.id} 尚未获得 VERIFIED 证据；${missingValidationEvidenceAction(criterion)}。这不是产品失败。`,
    })),
    ...decision.comparisonEvidenceGaps.map((criterion) => ({
      label: `待同卷对照 · ${criterion.title}`,
      status: "warning" as const,
      detail: `Candidate 的 Criterion ${criterion.id} 已有真实证据，但当前版本没有同一 Hidden TestCase 的 VERIFIED 对照；不能据此判断无回归。`,
    })),
    {
      label: "Safety",
      status: candidateEvaluation.safety === "PASS" ? "pass" as const : candidateEvaluation.safety === "FAIL" ? "fail" as const : "warning" as const,
      detail: candidateEvaluation.safety,
    },
    {
      label: "关键能力回归",
      status: decision.regression ? "fail" as const : decision.comparisonEvidenceGaps.length ? "warning" as const : "pass" as const,
      detail: `同一套隐藏卷：Candidate 准确 ${candidateEvaluation.accuracy}% / 完成 ${candidateEvaluation.completeness}% vs 当前版本 ${baselineEvaluation.accuracy}% / ${baselineEvaluation.completeness}%${gapHeadline(gap) ? `；主因：${gapHeadline(gap)}` : ""}`,
    },
  ];
  const failedRuns = [...runs, ...baselineRuns].filter((run) => run.error || run.verificationStatus === "failed").length;
  if (failedRuns) {
    checks.push({ label: "执行完整性", status: "warning", detail: `Candidate/当前版本同卷合计有 ${failedRuns} 道题执行失败；不得视为产品通过。` });
  }
  for (const criterion of decision.unverifiedHardCriteria) {
    const score = scoreById.get(criterion.id);
    if (score?.gaps.some((gapText) => gapText.includes("评审模型未返回"))) {
      checks.push({ label: `待补评审 · ${criterion.title}`, status: "warning", detail: "执行证据已存在，但独立 Judge 未返回完整逐标准判断。" });
    }
  }
  return { checks, decision };
}

function versionSnapshot(project: EvolveProject, candidate: Candidate, recommendation: string, evaluation: NonNullable<ValidationRun["evaluation"]>, now: string) {
  return {
    id: `version-server-holdout-${Date.parse(now) || Date.now()}`,
    label: `V${project.versions.length + 1}`,
    createdAt: now,
    source: "validation" as const,
    candidateTitle: candidate.title || candidate.name,
    recommendation,
    scores: { accuracy: evaluation.accuracy, completeness: evaluation.completeness },
    summary: `Server Hidden Holdout 实际执行的 exact Candidate Artifact（${candidate.title || candidate.id}）。`,
    artifacts: candidate.artifactSnapshots.map((artifact, index) => ({
      id: `vart-server-${candidate.id}-${index}`,
      name: artifact.name,
      sourceArtifactId: artifact.sourceArtifactId,
      content: artifact.content,
      frozenArtifact: artifact.frozenArtifact,
    })),
  };
}

function aggregateEvaluation(evaluation:NonNullable<ValidationRun["evaluation"]>){
  return {
    accuracy:evaluation.accuracy,
    evidence:evaluation.evidence,
    riskCoverage:evaluation.riskCoverage,
    completeness:evaluation.completeness,
    safety:evaluation.safety,
    rubricScore:evaluation.rubricScore,
    verifiedRubricCoverage:evaluation.verifiedRubricCoverage,
    unverifiedCriterionIds:evaluation.unverifiedCriterionIds,
    criterionScores:(evaluation.criterionScores??[]).map((item)=>({
      criterionId:item.criterionId,
      score:item.score,
      pass:item.pass,
      verificationStatus:item.verificationStatus,
    })),
  };
}

export async function runServerHoldout(
  inputProject: EvolveProject,
  ports: ServerHoldoutPorts,
  options?: { now?: () => string },
): Promise<ServerHoldoutOutcome> {
  const now = options?.now ?? (() => new Date().toISOString());
  const round = inputProject.campaign.checkpoint?.round ?? inputProject.campaign.currentRound + 1;
  if (inputProject.campaign.checkpoint?.round !== round || inputProject.campaign.checkpoint.completedPhase !== "experiment") {
    throw new Error("Server Hidden Holdout requires an Experiment checkpoint for the current round");
  }
  if (inputProject.experimentRun.status !== "completed") throw new Error("Server Hidden Holdout requires a completed Experiment");
  const candidateId = inputProject.experimentRun.winnerId ?? inputProject.experimentRun.pendingEvidenceCandidateId;
  if (!candidateId) throw new Error("Server Hidden Holdout requires an Experiment Winner or pending-evidence Candidate");
  const candidate = inputProject.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Server Hidden Holdout cannot find Candidate ${candidateId}`);
  const targetIds = inputProject.sourceArtifacts.filter((artifact) => artifact.role === "target").map((artifact) => artifact.id);
  if (candidate.artifactBuildStatus !== "ready"
    || targetIds.some((id) => !candidate.artifactSnapshots.find((snapshot) => snapshot.sourceArtifactId === id)?.frozenArtifact)) {
    return pauseServerHoldoutPreflight(
      inputProject,
      candidate,
      round,
      "[server-campaign-holdout-artifact-pending] Hidden Holdout requires the exact frozen Candidate Artifact for every Target",
      now(),
    );
  }
  let suite:TestCase[];
  try{
    suite=exactServerHoldoutSuite(inputProject);
  }catch(error){
    const reason=error instanceof Error?error.message:String(error);
    if(reason.includes("[server-campaign-holdout-contract-pending]")){
      return pauseServerHoldoutPreflight(inputProject,candidate,round,reason,now());
    }
    throw error;
  }
  const measuredBaselineFingerprint = serverBaselineFingerprint({ ...inputProject, evalSuite: suite }, ports.scoringRouteFingerprint);
  const baseFingerprint = ports.executionRuntimeFingerprint
    ? fastHash(JSON.stringify([measuredBaselineFingerprint,ports.executionRuntimeFingerprint])) : measuredBaselineFingerprint;

  const beforeArtifactFingerprint = await readServerHoldoutArtifactFingerprint(inputProject, candidate, ports.readArtifactFingerprint);
  const prior = recoverableServerHoldout(inputProject, candidate, suite, round, baseFingerprint, beforeArtifactFingerprint, Date.now());
  let executionArtifactFingerprint: string | undefined;
  let baselineRuns:TargetRunResult[]=[];
  let runs:TargetRunResult[]=[];
  let baselineEvaluation;
  let evaluation;
  let baselineObservedAt:number|undefined = prior?.baselineObservedAt;
  try {
    if (prior) {
      baselineRuns = prior.baselineRuns;
      runs = prior.runs;
      executionArtifactFingerprint = beforeArtifactFingerprint;
    } else {
      const [currentExecution, candidateExecution] = await Promise.allSettled([
        executeServerCurrentArtifactSuite(inputProject, suite, ports.current).then(value=>{baselineObservedAt=Date.now();return value;}),
        executeServerExperimentCandidate(inputProject, candidate, ports.candidate, suite),
      ]);
      if (currentExecution.status === "fulfilled") baselineRuns = currentExecution.value;
      if (candidateExecution.status === "fulfilled") runs = candidateExecution.value;
      if (currentExecution.status === "rejected") throw currentExecution.reason;
      if (candidateExecution.status === "rejected") throw candidateExecution.reason;
      if (beforeArtifactFingerprint) {
        const after = await readServerHoldoutArtifactFingerprint(inputProject, candidate, ports.readArtifactFingerprint);
        if (after !== beforeArtifactFingerprint) throw new Error("Hidden 执行期间当前版本或 Candidate 文件字节已变化；必须重新执行。");
        executionArtifactFingerprint = after;
      }
    }
    const [currentJudge,candidateJudge] = await Promise.allSettled([
      prior && reusableServerHoldoutAssessment(inputProject, suite, baselineRuns, prior.baselineEvaluation)
        ? Promise.resolve(prior.baselineEvaluation!)
        : judgeServerCurrentArtifactSuite(inputProject, suite, baselineRuns, ports.current),
      prior && reusableServerHoldoutAssessment(inputProject, suite, runs, prior.evaluation)
        ? Promise.resolve(prior.evaluation!)
        : judgeServerExperimentCandidate(inputProject, candidate, runs, ports.candidate, suite, "server-hidden-holdout-candidate", baselineRuns),
    ]);
    // Keep the fulfilled arm before propagating the other arm's failure.
    if(currentJudge.status==="fulfilled")baselineEvaluation=currentJudge.value;
    if(candidateJudge.status==="fulfilled")evaluation=candidateJudge.value;
    if (executionArtifactFingerprint) {
      const after = await readServerHoldoutArtifactFingerprint(inputProject, candidate, ports.readArtifactFingerprint);
      if (after !== executionArtifactFingerprint) {
        executionArtifactFingerprint = undefined;
        throw new Error("Hidden 评审期间文件字节已变化或回读不可用；必须重新执行。");
      }
    }
    if(currentJudge.status==="rejected")throw currentJudge.reason;
    if(candidateJudge.status==="rejected")throw candidateJudge.reason;
    baselineEvaluation=currentJudge.value;
    evaluation=candidateJudge.value;
  } catch (error) {
    const reason = `[server-campaign-holdout-judge-pending] Hidden 同卷已进入 Server 执行，但独立 Judge 未完成：${error instanceof Error ? error.message : String(error)}`;
    const validation: ValidationRun = {
      id: `validation-server-r${round}`,
      status: "failed",
      validationMode: "full",
      plannedCases: suite.length,
      executedCases: runs?.length ?? 0,
      candidateId: candidate.id,
      runs: runs ?? [],
      baselineRuns: baselineRuns ?? [],
      evaluation,
      baselineEvaluation,
      baselineSuiteIds:suite.map(testCase=>testCase.id),
      baselineContextFingerprint:baseFingerprint,
      baselineObservedAt,
      executionArtifactFingerprint,
      checks: [],
      evidenceFingerprint: evidenceFingerprint(inputProject, candidate),
      error: reason,
      summary: reason,
    };
    validation.executionEvidenceFingerprint = executionArtifactFingerprint ? serverHoldoutExecutionEvidenceFingerprint(validation) : undefined;
    const project: EvolveProject = {
      ...inputProject,
      validationRun: validation,
      stage: "validation",
      campaign: { ...inputProject.campaign, status: "paused", stopReason: reason, schedule: { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined } },
      updatedAt: now(),
    };
    return { control: "stop", project, validation, reason, readyForArtifactAcceptance: false, evidenceIncomplete: true };
  }

  const completedAt = now();
  const { checks, decision } = holdoutChecks(inputProject, evaluation, baselineEvaluation, runs, baselineRuns, suite);
  let recommendation: "release" | "hold" | "reject" = "hold";
  let reviewSummary = decision.hardFail
    ? "Hidden Holdout 存在已验证失败，不能进入发布。"
    : decision.evidenceIncomplete
      ? "Hidden Holdout 仍有真实证据缺口，不能进入发布。"
      : "等待独立 Release Review。";
  if (!decision.hardFail && !decision.evidenceIncomplete) {
    try {
      const review = await ports.releaseReview({
        baseline: inputProject.baselineRun.result ? aggregateEvaluation(inputProject.baselineRun.result) : undefined,
        holdoutBaseline: aggregateEvaluation(baselineEvaluation),
        holdout: aggregateEvaluation(evaluation),
        checks,
        experimentHistory: {
          failedExperimentCases: inputProject.experimentRun.candidateResults.flatMap((result) => result.runs).filter((run) => run.error).length,
          experimentSummary: inputProject.experimentRun.summary,
        },
        evolutionCommand: inputProject.evolutionCommand,
        acceptanceRubric: inputProject.acceptanceRubric,
        criterionScores: aggregateEvaluation(evaluation).criterionScores,
        rubricScore: evaluation.rubricScore,
      });
      recommendation = review.recommendation;
      reviewSummary = review.summary;
    } catch (error) {
      const reason = `[server-campaign-holdout-review-pending] Hidden Holdout 两张同卷均已评审，但独立 Release Review 未完成：${error instanceof Error ? error.message : String(error)}`;
      const validation: ValidationRun = {
        id: `validation-server-r${round}`,
        status: "completed",
        validationMode: "full",
        plannedCases: suite.length,
        executedCases: suite.length,
        candidateId: candidate.id,
        evaluation,
        runs,
        baselineRuns,
        baselineEvaluation,
        baselineSuiteIds: suite.map((testCase) => testCase.id),
        baselineContextFingerprint: baseFingerprint,
        baselineObservedAt,
        executionArtifactFingerprint,
        checks,
        recommendation: "hold",
        evidenceFingerprint: evidenceFingerprint(inputProject, candidate),
        versionSnapshot: versionSnapshot(inputProject, candidate, "hold", evaluation, completedAt),
        summary: reason,
      };
      validation.executionEvidenceFingerprint = executionArtifactFingerprint ? serverHoldoutExecutionEvidenceFingerprint(validation) : undefined;
      const project: EvolveProject = {
        ...inputProject,
        validationRun: validation,
        stage: "validation",
        campaign: { ...inputProject.campaign, status: "paused", stopReason: reason, schedule: { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined } },
        updatedAt: completedAt,
      };
      return { control: "stop", project, validation, reason, readyForArtifactAcceptance: false, evidenceIncomplete: false };
    }
  }

  const validation: ValidationRun = {
    id: `validation-server-r${round}`,
    status: "completed",
    validationMode: "full",
    plannedCases: suite.length,
    executedCases: suite.length,
    candidateId: candidate.id,
    evaluation,
    runs,
    baselineRuns,
    baselineEvaluation,
    baselineSuiteIds: suite.map((testCase) => testCase.id),
    baselineContextFingerprint: baseFingerprint,
    baselineObservedAt,
    executionArtifactFingerprint,
    checks,
    recommendation,
    evidenceFingerprint: evidenceFingerprint(inputProject, candidate),
    versionSnapshot: versionSnapshot(inputProject, candidate, recommendation, evaluation, completedAt),
    summary: reviewSummary,
  };
  validation.executionEvidenceFingerprint = executionArtifactFingerprint ? serverHoldoutExecutionEvidenceFingerprint(validation) : undefined;
  const evidenceReason = decision.evidenceIncomplete
    ? `[server-campaign-holdout-evidence-pending] Hidden Holdout 已执行，但真实证据未完成：${[
      ...decision.unverifiedHardCriteria.map((criterion) => criterion.id),
      ...decision.comparisonEvidenceGaps.map((criterion) => `baseline:${criterion.id}`),
    ].join("、") || "rubric coverage incomplete"}`
    : undefined;
  const project: EvolveProject = {
    ...inputProject,
    validationRun: validation,
    stage: "validation",
    versions: evidenceReason ? inputProject.versions : [...inputProject.versions, validation.versionSnapshot!],
    campaign: {
      ...inputProject.campaign,
      status: evidenceReason ? "paused" : "running",
      stopReason: evidenceReason,
      checkpoint: evidenceReason
        ? inputProject.campaign.checkpoint
        : { round, completedPhase: "validation", at: completedAt },
      schedule: evidenceReason
        ? { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined }
        : inputProject.campaign.schedule,
    },
    updatedAt: completedAt,
  };
  return {
    control: evidenceReason ? "stop" : "continue",
    project,
    validation,
    reason: evidenceReason ?? `Round ${round} Server Hidden Holdout 已完成；Recommendation=${recommendation}，进入 Artifact Acceptance / Repair。`,
    readyForArtifactAcceptance: !evidenceReason,
    evidenceIncomplete: decision.evidenceIncomplete,
  };
}
