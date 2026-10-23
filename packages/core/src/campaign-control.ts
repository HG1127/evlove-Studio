import type { EvolveProject, EvaluationResult } from "@evolution/contracts";
import { campaignGoalSatisfied } from "./campaign-readiness";

function metricEvaluationValue(key: string, evaluation: EvaluationResult) {
  const normalized = key.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "evidence") return evaluation.evidence;
  if (normalized === "risk" || normalized === "riskcoverage") return evaluation.riskCoverage;
  if (normalized === "quality") return evaluation.rubricScore ?? evaluation.accuracy;
  if (normalized === "accuracy") return evaluation.accuracy;
  if (normalized === "success" || normalized === "completeness") return evaluation.completeness;
  if (normalized === "cost" || normalized === "averagecost") return evaluation.averageCost;
  if (normalized === "latency" || normalized === "averagelatency" || normalized === "latencyms" || normalized === "averagelatencyms") return evaluation.averageLatencyMs;
  return undefined;
}

export function campaignMetricTargetStatus(project: EvolveProject) {
  const evaluation = project.searchChampion?.validation?.evaluation;
  const targets = project.metrics.filter((metric) => metric.target !== undefined);
  const unsupported: string[] = [];
  const unmet: string[] = [];
  if (!evaluation) return { configured: targets.length, supported: 0, unsupported, unmet, satisfied: false };
  let supported = 0;
  for (const metric of targets) {
    const value = metricEvaluationValue(metric.key, evaluation);
    if (value === undefined) {
      unsupported.push(metric.label || metric.key);
      continue;
    }
    supported += 1;
    const target = metric.target!;
    const met = metric.direction === "lower" ? value <= target : value >= target;
    if (!met) unmet.push(`${metric.label || metric.key} ${value} ${metric.direction === "lower" ? ">" : "<"} ${target}`);
  }
  return {
    configured: targets.length,
    supported,
    unsupported,
    unmet,
    satisfied: campaignGoalSatisfied(project) && targets.length > 0 && supported === targets.length && unsupported.length === 0 && unmet.length === 0,
  };
}

export function estimateRoundCost(project: EvolveProject) {
  const visible = project.evalSuite.length;
  const hidden = project.hiddenEvalSuite.length+(project.finalHoldout?.suite.length??0);
  const candidates = Math.max(1, project.selectedCandidateIds.length || project.campaign.candidateCount);
  const average = project.baselineRun.result?.averageCost ?? 0.03;
  return Number((average * (visible * candidates + hidden * 2)).toFixed(4));
}

export function estimateNextRoundCost(project: EvolveProject) {
  const visible = project.evalSuite.length;
  const hidden = project.hiddenEvalSuite.length+(project.finalHoldout?.suite.length??0);
  const configured = Math.max(1, project.campaign.candidateCount);
  const candidates = project.campaign.searchMode === "focused" ? Math.min(2, configured) : configured;
  const average = project.baselineRun.result?.averageCost ?? 0.03;
  return Number((average * (visible * candidates + hidden * 2)).toFixed(4));
}

export function campaignStopReason(project: EvolveProject): string | undefined {
  if (project.artifactAcceptance.status === "unverified") return `缺少验证能力，已停止重复改写：${project.artifactAcceptance.summary}`;
  if ((project.validationRun.evaluation?.unverifiedCriterionIds?.length ?? 0) > 0) return "仍有要求缺少真实验证证据，请补齐执行或视觉验证后继续。";
  return campaignLimitStopReason(project);
}

/** Resource, safety and configured completion limits, independently of evidence readiness. */
export function campaignLimitStopReason(project:EvolveProject):string|undefined{
  const campaign = project.campaign;
  const criteria = campaign.stopCriteria;
  if (criteria.stopWhenAcceptanceMet && campaignGoalSatisfied(project)) return "当前进化要求已全部通过：独立验证与成果完整性验收完成";
  if (campaign.currentRound >= criteria.maxRounds) return `已达到设定的最大进化轮数 ${criteria.maxRounds}`;
  if (campaign.noImprovementRounds >= criteria.patienceRounds) return `连续 ${campaign.noImprovementRounds} 轮没有达到最小提升 ${criteria.minImprovement}`;
  if (criteria.targetScore !== undefined && campaignGoalSatisfied(project) && (project.searchChampion?.score ?? 0) >= criteria.targetScore) return `Search Champion 已达到目标综合分 ${criteria.targetScore}`;
  if (criteria.maxEstimatedCost !== undefined && campaign.estimatedCost >= criteria.maxEstimatedCost) return `预计成本已达到预算上限 ${criteria.maxEstimatedCost}`;
  if (criteria.maxWallMinutes !== undefined && campaign.startedAt) {
    const elapsedMinutes = (Date.now() - new Date(campaign.startedAt).getTime()) / 60_000;
    if (elapsedMinutes >= criteria.maxWallMinutes) return `Campaign 已达到最长运行时间 ${criteria.maxWallMinutes} 分钟`;
  }
  if (criteria.stopOnSafetyFailure && (project.validationRun.evaluation?.safety === "FAIL"
    || project.experimentRun.candidateResults.some((result) => result.experimentStage === "finalist" && result.evaluation.safety === "FAIL"))) return "检测到 Safety Hard Gate 失败";
  if (criteria.stopWhenMetricTargetsMet && campaignMetricTargetStatus(project).satisfied) return "Search Champion 已满足当前 Evolve Contract 的全部可计算指标目标";
  return undefined;
}

export function campaignPreflightStopReason(project: EvolveProject): string | undefined {
  const existing = campaignStopReason(project);
  if (existing) return existing;
  return projectedCostStopReason(project);
}

/** Repair may act on a proven rejection while other evidence remains unknown; limits still apply. */
export function campaignRepairLimitStopReason(project:EvolveProject):string|undefined{
  return campaignLimitStopReason(project)??projectedCostStopReason(project);
}

function projectedCostStopReason(project:EvolveProject):string|undefined{
  const limit = project.campaign.stopCriteria.maxEstimatedCost;
  if (limit !== undefined) {
    const next = estimateNextRoundCost(project);
    const projected = project.campaign.estimatedCost + next;
    if (projected > limit + 1e-9) return `下一轮预计成本 ${next.toFixed(4)} 将使累计估算成本达到 ${projected.toFixed(4)}，超过预算上限 ${limit}`;
  }
  return undefined;
}

/** An explicit retry starts a fresh patience/time window without erasing prior rounds or evidence. */
export function prepareCampaignRetry(project: EvolveProject, at: Date = new Date()): EvolveProject {
  const campaign = project.campaign;
  const patienceExhausted = campaign.noImprovementRounds >= campaign.stopCriteria.patienceRounds;
  const wallTimeExhausted = campaign.stopCriteria.maxWallMinutes !== undefined && campaign.startedAt !== undefined
    && (at.getTime() - new Date(campaign.startedAt).getTime()) / 60_000 >= campaign.stopCriteria.maxWallMinutes;
  return {
    ...project,
    campaign: {
      ...campaign,
      noImprovementRounds: patienceExhausted ? 0 : campaign.noImprovementRounds,
      startedAt: wallTimeExhausted ? undefined : campaign.startedAt,
      status: campaign.status === "completed" ? "completed" : "idle",
      stopReason: undefined,
      completedAt: campaign.status === "completed" ? campaign.completedAt : undefined,
    },
  };
}
