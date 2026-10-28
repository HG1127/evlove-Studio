import type { Candidate, EvaluationResult, EvolveProject } from "@evolution/contracts";
import { indexScopedAcceptanceResults } from "./acceptance-result-identity";
import { originalUserGoalCriteria, USER_GOAL_SCOPE_POLICY, userGoalProgress } from "./user-goal-scope";
import {pairedComparisonBaseline} from "./paired-judge";

function scoreIndex(project: EvolveProject, evaluation: EvaluationResult) {
  return indexScopedAcceptanceResults([{
    requestedCriterionIds: project.acceptanceRubric.map((criterion) => criterion.id),
    results: evaluation.criterionScores ?? [],
  }]);
}

function hardRubricFailures(project: EvolveProject, evaluation: EvaluationResult) {
  const byId = scoreIndex(project, evaluation).byId;
  return project.acceptanceRubric.filter((criterion) => {
    if (!criterion.hardGate) return false;
    const result = byId.get(criterion.id);
    return Boolean(result && result.verificationStatus === "verified" && !result.pass);
  });
}

export function experimentEvaluationScore(project: EvolveProject, evaluation: EvaluationResult) {
  if (evaluation.safety === "FAIL" || hardRubricFailures(project, evaluation).length || scoreIndex(project, evaluation).duplicateIds.size) return -Infinity;
  const generic = evaluation.accuracy * 0.28
    + evaluation.evidence * 0.22
    + evaluation.riskCoverage * 0.15
    + evaluation.completeness * 0.20
    + (evaluation.safety === "PASS" ? 15 : 4);
  const measuredPair=project.experimentPolicy?.judgeComparison==="paired-two-order-v1"&&evaluation.judgeComparison
    ?pairedRubricQuality(project,evaluation,evaluation.judgeComparison.baseline):undefined;
  if(project.experimentPolicy?.judgeComparison==="paired-two-order-v1"&&!measuredPair)return -Infinity;
  const objective = measuredPair?measuredPair.candidate-measuredPair.baseline:evaluation.rubricScore !== undefined ? evaluation.rubricScore * 0.84 + generic * 0.16 : generic;
  const costPenalty = evaluation.averageCost * 3;
  const latencyPenalty = evaluation.averageLatencyMs / 10_000;
  const uncertaintyPenalty = Math.max(0, 100 - (evaluation.verifiedRubricCoverage ?? 100)) * 0.12;
  const demoJudgePenalty = evaluation.demoJudged ? 40 : 0;
  return objective - costPenalty - latencyPenalty - uncertaintyPenalty - demoJudgePenalty;
}

function comparableQuality(evaluation: EvaluationResult) {
  return evaluation.rubricScore
    ?? (evaluation.accuracy * 0.32 + evaluation.evidence * 0.24 + evaluation.riskCoverage * 0.18 + evaluation.completeness * 0.26);
}

function normalizedCriterionLabel(value: string) {
  return value.toLowerCase().replace(/[\s·:：()（）【】_-]+/g, "");
}

function targetCriterionIds(project: EvolveProject, candidate?: Candidate) {
  if (project.experimentPolicy?.winnerGoalScope === USER_GOAL_SCOPE_POLICY) return originalUserGoalCriteria(project).map(c => c.id);
  if (!candidate?.designRationale?.coveredCriteria.length) return [];
  const requested = candidate.designRationale.coveredCriteria.map(normalizedCriterionLabel).filter(Boolean);
  return project.acceptanceRubric.filter((criterion) => {
    const id = normalizedCriterionLabel(criterion.id);
    const title = normalizedCriterionLabel(criterion.title);
    return requested.some((value) => value === id || value === title || value.includes(id) || value.includes(title));
  }).map((criterion) => criterion.id);
}

function pairedRubricQuality(project: EvolveProject, evaluation: EvaluationResult, baseline: EvaluationResult, onlyIds?: string[]) {
  const candidateById = scoreIndex(project, evaluation).byId;
  const baselineById = scoreIndex(project, baseline).byId;
  const allowed = onlyIds?.length ? new Set(onlyIds) : undefined;
  const comparable = project.acceptanceRubric.filter((criterion) => {
    if (allowed && !allowed.has(criterion.id)) return false;
    const current = candidateById.get(criterion.id);
    const prior = baselineById.get(criterion.id);
    return current?.verificationStatus === "verified"
      && prior?.verificationStatus === "verified"
      && current.testCaseIds.some((id) => prior.testCaseIds.includes(id));
  });
  const weight = comparable.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (!weight) return undefined;
  const weighted = (source: Map<string, NonNullable<EvaluationResult["criterionScores"]>[number]>) =>
    comparable.reduce((sum, criterion) => sum + source.get(criterion.id)!.score * criterion.weight, 0) / weight;
  return {
    candidate: weighted(candidateById),
    baseline: weighted(baselineById),
    criterionIds: comparable.map((criterion) => criterion.id),
  };
}

/**
 * Visible Experiment Winner is a paired-evidence decision, not a "highest score wins" shortcut.
 * Missing evidence can keep a challenger provisional, but cannot fabricate improvement.
 */
export function candidateWinnerDecision(
  project: EvolveProject,
  evaluation: EvaluationResult,
  baseline: EvaluationResult,
  candidate?: Candidate,
) {
  const blockers: string[] = [];
  const signals: string[] = [];
  const comparison=pairedComparisonBaseline(project,evaluation,baseline,project.evalSuite,candidate);
  baseline=comparison.baseline;if(comparison.blocker)blockers.push(comparison.blocker);
  const candidateScores = scoreIndex(project, evaluation);
  const baselineScores = scoreIndex(project, baseline);
  if (candidateScores.duplicateIds.size) blockers.push(`候选评分存在重复 Criterion：${[...candidateScores.duplicateIds].join("、")}；需重新验证`);
  if (baselineScores.duplicateIds.size) blockers.push(`基线评分存在重复 Criterion：${[...baselineScores.duplicateIds].join("、")}；需重新测量`);
  if (evaluation.safety === "FAIL") blockers.push("Safety 未通过");
  if (evaluation.demoJudged) blockers.push("评审使用演示兜底，不能据此选出 Winner");
  const candidateHardFailures = hardRubricFailures(project, evaluation).length;
  const baselineHardFailures = hardRubricFailures(project, baseline).length;
  if (candidateHardFailures > baselineHardFailures) blockers.push(`Hard Gate 失败由 ${baselineHardFailures} 项增至 ${candidateHardFailures} 项`);
  const candidateCoverage = evaluation.verifiedRubricCoverage ?? 100;
  const baselineCoverage = baseline.verifiedRubricCoverage ?? 100;
  const paired = pairedRubricQuality(project, evaluation, baseline);
  if (!paired && candidateCoverage + 5 < baselineCoverage) blockers.push(`缺少同卷证据，覆盖率由 ${baselineCoverage}% 变为 ${candidateCoverage}%，请补证后比较`);
  if (paired && candidateCoverage + 5 < baselineCoverage) signals.push(`未配对标准待独立验收补证（覆盖率 ${candidateCoverage}%）`);
  const lostProtected = project.acceptanceRubric.filter((criterion) => (criterion.hardGate || criterion.protectedConstraint)
    && baselineScores.byId.get(criterion.id)?.verificationStatus === "verified"
    && baselineScores.byId.get(criterion.id)?.pass
    && !(candidateScores.byId.get(criterion.id)?.verificationStatus === "verified" && candidateScores.byId.get(criterion.id)?.pass));
  if (lostProtected.length) blockers.push(`原版已通过的保护标准需补证或修复：${lostProtected.map((item) => item.id).join("、")}`);
  const candidateQuality = paired?.candidate ?? comparableQuality(evaluation);
  const baselineQuality = paired?.baseline ?? comparableQuality(baseline);
  const globalDelta = candidateQuality - baselineQuality;
  const targets = targetCriterionIds(project, candidate);
  const targeted = targets.length ? pairedRubricQuality(project, evaluation, baseline, targets) : undefined;
  const targetDelta = targeted ? targeted.candidate - targeted.baseline : undefined;
  if (project.experimentPolicy?.winnerGoalScope === USER_GOAL_SCOPE_POLICY) {
    const progress = userGoalProgress(project, evaluation, baseline);
    if (!progress.ready) blockers.push(`原始完整用户目标缺少同卷配对证据：${progress.pendingCriterionIds.join("、") || "目标定义或权重不完整"}`);
    if (progress.regressedCriterionIds.length) blockers.push(`原始用户目标同卷退步：${progress.regressedCriterionIds.join("、")}；最低分过线不能代替目标改善`);
    if (progress.ready && (progress.weightedDelta ?? 0) < 1) blockers.push(`原始完整用户目标变化 ${progress.weightedDelta!.toFixed(1)} 分，未达到 1 分提升门槛`);
  }
  const hardGateImproved = candidateHardFailures < baselineHardFailures;
  const globalImproved = globalDelta >= 1;
  const focusedImproved = targetDelta !== undefined && targetDelta >= 1 && globalDelta >= -3;
  if (hardGateImproved) signals.push(`Hard Gate 失败减少 ${baselineHardFailures - candidateHardFailures} 项`);
  if (globalImproved) signals.push(`同口径综合质量提升 ${globalDelta.toFixed(1)} 分`);
  if (focusedImproved) signals.push(`本轮目标标准提升 ${targetDelta!.toFixed(1)} 分，且全局无实质退步`);
  if (!hardGateImproved && !globalImproved && !focusedImproved) {
    const targetText = targetDelta === undefined ? "本轮目标标准缺少可配对证据" : `本轮目标标准变化 ${targetDelta.toFixed(1)} 分`;
    blockers.push(`${targetText}；同口径综合质量变化 ${globalDelta.toFixed(1)} 分，未达到晋级线`);
  }
  const eligible = blockers.length === 0 && (hardGateImproved || globalImproved || focusedImproved);
  return {
    eligible,
    summary: eligible ? `可进入独立验证：${signals.join("；")}` : `未成为 Winner：${blockers.join("；")}`,
    candidateQuality: Number(candidateQuality.toFixed(1)),
    baselineQuality: Number(baselineQuality.toFixed(1)),
    globalDelta: Number(globalDelta.toFixed(1)),
    targetDelta: targetDelta === undefined ? undefined : Number(targetDelta.toFixed(1)),
    comparedCriterionIds: paired?.criterionIds ?? [],
    targetCriterionIds: targets,
    blockers,
    signals,
  };
}

export function experimentEvidencePendingOnly(evaluation: EvaluationResult) {
  const scores = evaluation.criterionScores ?? [];
  const { byId, duplicateIds } = indexScopedAcceptanceResults([{
    requestedCriterionIds: scores.map((item) => item.criterionId), results: scores,
  }]);
  return evaluation.safety !== "FAIL"
    && (duplicateIds.size > 0 || [...byId.values()].some((item) => item.verificationStatus !== "verified"))
    && ![...byId.values()].some((item) => item.verificationStatus === "verified" && !item.pass);
}
