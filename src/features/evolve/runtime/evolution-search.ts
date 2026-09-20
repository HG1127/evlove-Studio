import { campaignGoalSatisfied, materializeChampionOutputs as coreMaterializeChampionOutputs } from "@evolution/core";
export { campaignGoalSatisfied } from "@evolution/core";
import { buildDeliverableZip } from "./artifact-output-builders";
import { buildSearchMemory, patchFamilyKey } from "./search-memory";
import type {
  Candidate,
  EvolveProject,
  EvaluationResult,
  EvolutionArchiveEntry,
  EvolutionRound,
  OutputArtifact,
  SearchChampion,
  ValidationRun,
} from "../schemas";

export type FitnessBreakdown = {
  score: number;
  quality: number;
  costPenalty: number;
  latencyPenalty: number;
  safetyPenalty: number;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function computeFitness(evaluation: EvaluationResult, baseline?: EvaluationResult, acceptance?: EvolveProject["artifactAcceptance"]): FitnessBreakdown {
  const genericQuality = evaluation.accuracy * 0.28
    + evaluation.evidence * 0.22
    + evaluation.riskCoverage * 0.15
    + evaluation.completeness * 0.20
    + (evaluation.safety === "PASS" ? 15 : evaluation.safety === "REVIEW" ? 4 : -50);
  // V2.2: Project-specific Rubric is the optimization objective. Generic quality is a
  // secondary regularizer; Gate F acceptance becomes the final deliverable-quality term.
  const rubricQuality = evaluation.rubricScore ?? genericQuality;
  const acceptanceScore = acceptance?.status === "passed" ? acceptance.overallScore : undefined;
  const quality = acceptanceScore === undefined
    ? rubricQuality * 0.84 + genericQuality * 0.16
    : rubricQuality * 0.65 + acceptanceScore * 0.25 + genericQuality * 0.10;

  const costRatio = baseline?.averageCost && baseline.averageCost > 0 ? evaluation.averageCost / baseline.averageCost : 1;
  const latencyRatio = baseline?.averageLatencyMs && baseline.averageLatencyMs > 0 ? evaluation.averageLatencyMs / baseline.averageLatencyMs : 1;
  const costPenalty = Math.max(0, costRatio - 1) * 9;
  const latencyPenalty = Math.max(0, latencyRatio - 1) * 6;
  const artifactPenalty = acceptance && (!acceptance.hardGatePass || acceptance.status === "failed") ? 100 : 0;
  const safetyPenalty = evaluation.safety === "FAIL" ? 100 : evaluation.safety === "REVIEW" ? 8 : 0;
  return { score: clamp(quality - costPenalty - latencyPenalty - safetyPenalty - artifactPenalty), quality, costPenalty, latencyPenalty, safetyPenalty: safetyPenalty + artifactPenalty };
}

export function candidateNiche(candidate: Candidate, evaluation?: EvaluationResult) {
  const components = [...new Set(candidate.patches.map((patch) => patch.component))].sort();
  const base = !components.length ? "unclassified" : components.length >= 3 ? "compound" : components.join("+");
  // 行为维度进 niche：同组件但质量档位不同的候选不再挤同一个格子，QD 父代池更真实。
  if (!evaluation) return base;
  const quality = evaluation.rubricScore ?? evaluation.accuracy;
  return `${base}|Q${Math.min(4, Math.floor(quality / 20))}`;
}

function candidateSignature(candidate: Candidate) {
  return candidate.patches
    .map((patch) => `${patch.component}:${patch.operation}:${patch.target}:${patch.content}`.toLowerCase().replace(/\s+/g, "").trim())
    .sort()
    .join("||");
}

export type ParentPoolItem = {
  source: "search-champion" | "elite" | "stepping-stone";
  id: string;
  label: string;
  round: number;
  score: number;
  niche: string;
  patches: Candidate["patches"];
  reason: string;
};

/**
 * Build the parent pool that the mutation model may learn from. The production/search
 * runtime still executes from the current Search Champion; non-champion parents are
 * supplied as genetic material for crossover/idea reuse, which keeps lineage explicit.
 */
export function selectParentPool(project: EvolveProject): ParentPoolItem[] {
  const campaign = project.campaign;
  const pool: ParentPoolItem[] = [];
  if (project.searchChampion) {
    pool.push({
      source: "search-champion",
      id: project.searchChampion.id,
      label: project.searchChampion.versionLabel,
      round: project.searchChampion.round,
      score: project.searchChampion.score,
      niche: project.searchChampion.candidate ? candidateNiche(project.searchChampion.candidate) : "champion",
      patches: project.searchChampion.patches,
      reason: project.searchChampion.reason,
    });
  }
  if (campaign.parentStrategy === "champion-only") return pool;

  const safe = project.evolutionArchive.filter((entry) => entry.evaluation.safety !== "FAIL");
  if (campaign.parentStrategy === "champion-elites") {
    const elites = safe.filter((entry) => entry.kind === "elite").sort((a, b) => b.score - a.score).slice(0, campaign.eliteCount);
    return [...pool, ...elites.map((entry): ParentPoolItem => ({ source: "elite", id: entry.id, label: `Elite R${entry.round}/${entry.candidate.id}`, round: entry.round, score: entry.score, niche: entry.niche, patches: entry.candidate.patches, reason: entry.reason }))];
  }
  if (campaign.parentStrategy === "quality-diversity") {
    const bestByNiche = new Map<string, EvolutionArchiveEntry>();
    for (const entry of [...safe].sort((a, b) => b.score - a.score)) if (!bestByNiche.has(entry.niche)) bestByNiche.set(entry.niche, entry);
    return [...pool, ...[...bestByNiche.values()].slice(0, Math.max(campaign.eliteCount, 4)).map((entry): ParentPoolItem => ({ source: entry.kind === "stepping-stone" ? "stepping-stone" : "elite", id: entry.id, label: `${entry.niche} R${entry.round}/${entry.candidate.id}`, round: entry.round, score: entry.score, niche: entry.niche, patches: entry.candidate.patches, reason: entry.reason }))];
  }

  // Open-ended: keep the best elites, but deliberately include recent stepping stones
  // to preserve paths that may not be locally optimal yet.
  const elites = safe.filter((entry) => entry.kind === "elite").sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.ceil(campaign.eliteCount / 2)));
  const stepping = safe.filter((entry) => entry.kind === "stepping-stone").sort((a, b) => b.round - a.round || b.score - a.score).slice(0, Math.max(2, campaign.eliteCount));
  return [...pool, ...[...elites, ...stepping].map((entry): ParentPoolItem => ({ source: entry.kind === "stepping-stone" ? "stepping-stone" : "elite", id: entry.id, label: `${entry.kind} R${entry.round}/${entry.candidate.id}`, round: entry.round, score: entry.score, niche: entry.niche, patches: entry.candidate.patches, reason: entry.reason }))];
}

/**
 * Lightweight novelty rejection for generated candidates. Exact/near-identical patch
 * signatures are removed before expensive execution. Exploit candidates are preserved
 * first, while explore budget is filled with unseen mutation signatures/niches.
 *
 * V2.9 反思式选择：提示词层面的「避免死路家族」只是软约束，模型可能忽略。这里在运行时
 * 再兜一层底——改动方向全部落在死路家族的候选不剔除但垫底（模型可能真的换了机制，
 * 只是 patch 家族键相同）；补位时优先选择族群（component:operation:target）未被覆盖的
 * 候选，防止整个种群塌缩到单一变异家族。
 */
export function selectDiverseCandidates(args: { project: EvolveProject; candidates: Candidate[]; count: number }) {
  const archiveSignatures = new Set(args.project.evolutionArchive.map((entry) => candidateSignature(entry.candidate)));
  const seen = new Set<string>();
  const unique = args.candidates.filter((candidate) => {
    const signature = candidateSignature(candidate);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
  const deadEndFamilies = new Set(buildSearchMemory(args.project).deadEnds.map((item) => item.family));
  const familyKeys = (candidate: Candidate) => [...new Set(candidate.patches.map(patchFamilyKey))];
  const onDeadEndOnly = (candidate: Candidate) => familyKeys(candidate).length > 0 && familyKeys(candidate).every((key) => deadEndFamilies.has(key));
  // 死路候选垫底但不剔除；同一桶内保持原有顺序（模型生成顺序即其意图优先级）。
  const demoteDeadEnds = (list: Candidate[]) => [...list.filter((candidate) => !onDeadEndOnly(candidate)), ...list.filter(onDeadEndOnly)];
  const novel = demoteDeadEnds(unique.filter((candidate) => !archiveSignatures.has(candidateSignature(candidate))));
  const familiar = demoteDeadEnds(unique.filter((candidate) => archiveSignatures.has(candidateSignature(candidate))));
  const exploreTarget = Math.min(args.count, Math.round(args.count * args.project.campaign.exploreRatio));
  const exploitTarget = args.count - exploreTarget;
  const selected = [...familiar.slice(0, exploitTarget), ...novel.slice(0, exploreTarget)];
  // 补位分两档：先挑能带来新变异家族的候选，再按序补齐，保证族群多样性优先于数量凑满。
  const coveredFamilies = new Set(selected.flatMap(familyKeys));
  const remaining = unique.filter((candidate) => !selected.some((item) => item.id === candidate.id));
  const freshFamily = remaining.filter((candidate) => familyKeys(candidate).some((key) => !coveredFamilies.has(key)));
  const rest = remaining.filter((candidate) => !freshFamily.some((item) => item.id === candidate.id));
  for (const candidate of [...demoteDeadEnds(freshFamily), ...demoteDeadEnds(rest)]) {
    if (selected.length < args.count && !selected.some((item) => item.id === candidate.id)) selected.push(candidate);
  }
  return selected.slice(0, args.count);
}

function dominates(a: EvaluationResult, b: EvaluationResult) {
  const safetyA = a.safety === "PASS" ? 2 : a.safety === "REVIEW" ? 1 : 0;
  const safetyB = b.safety === "PASS" ? 2 : b.safety === "REVIEW" ? 1 : 0;
  const noWorse = a.accuracy >= b.accuracy && a.evidence >= b.evidence && a.riskCoverage >= b.riskCoverage
    && a.completeness >= b.completeness && a.averageCost <= b.averageCost && a.averageLatencyMs <= b.averageLatencyMs && safetyA >= safetyB;
  const better = a.accuracy > b.accuracy || a.evidence > b.evidence || a.riskCoverage > b.riskCoverage
    || a.completeness > b.completeness || a.averageCost < b.averageCost || a.averageLatencyMs < b.averageLatencyMs || safetyA > safetyB;
  return noWorse && better;
}

export function paretoCandidateIds(results: Array<{ candidateId: string; evaluation: EvaluationResult }>) {
  return results.filter((item, index) => !results.some((other, otherIndex) => otherIndex !== index && dominates(other.evaluation, item.evaluation))).map((item) => item.candidateId);
}

export function buildRoundArchive(args: {
  project: EvolveProject;
  round: number;
  candidates: Candidate[];
  results: Array<{ candidateId: string; evaluation: EvaluationResult }>;
  winnerId?: string;
  parentVersionId: string;
}): EvolutionArchiveEntry[] {
  const resultById = new Map(args.results.map((item) => [item.candidateId, item.evaluation]));
  const pareto = new Set(paretoCandidateIds(args.results));
  const baseline = args.project.campaign.rootBaseline ?? args.project.baselineRun.result;
  const scored = args.candidates.flatMap((candidate) => {
    const evaluation = resultById.get(candidate.id);
    return evaluation ? [{ candidate, evaluation, score: computeFitness(evaluation, baseline).score, niche: candidateNiche(candidate, evaluation) }] : [];
  }).sort((a, b) => b.score - a.score);

  const bestByNiche = new Map<string, typeof scored[number]>();
  for (const item of scored) if (!bestByNiche.has(item.niche)) bestByNiche.set(item.niche, item);

  return scored.map((item) => {
    const isWinner = item.candidate.id === args.winnerId;
    const isElite = bestByNiche.get(item.niche)?.candidate.id === item.candidate.id;
    const kind: EvolutionArchiveEntry["kind"] = item.evaluation.safety === "FAIL"
      ? "failure"
      : isWinner ? "champion"
        : isElite || pareto.has(item.candidate.id) ? "elite"
          : "stepping-stone";
    return {
      id: `archive-r${args.round}-${item.candidate.id}-${Date.now()}`,
      round: args.round,
      kind,
      niche: item.niche,
      score: Number(item.score.toFixed(2)),
      candidate: item.candidate,
      evaluation: item.evaluation,
      parentVersionId: args.parentVersionId,
      lineage: [args.parentVersionId, item.candidate.id],
      reason: isWinner ? "本轮综合最优" : isElite ? `保留 ${item.niche} niche 的高质量 Elite` : pareto.has(item.candidate.id) ? "位于 Pareto frontier，保留为多目标 Elite" : item.evaluation.safety === "FAIL" ? "Safety Hard Gate 失败，进入 Failure Archive" : "保留为潜在 stepping stone，避免过早收敛",
      createdAt: new Date().toISOString(),
    };
  });
}

export function maybeUpdateSearchChampion(args: {
  current?: SearchChampion;
  round: number;
  winner?: Candidate;
  validation: ValidationRun;
  artifactAcceptance?: EvolveProject["artifactAcceptance"];
  baseline?: EvaluationResult;
  parentVersionId: string;
  minImprovement: number;
}): { champion?: SearchChampion; changed: boolean; improvement: number } {
  if (!args.winner || !args.validation.evaluation || args.validation.recommendation !== "release" || args.artifactAcceptance?.status !== "passed") return { champion: args.current, changed: false, improvement: 0 };
  if (args.validation.status !== "completed" || !args.artifactAcceptance.hardGatePass || args.artifactAcceptance.candidateId !== args.winner.id) return { champion: args.current, changed: false, improvement: 0 };
  // 演示启发式评出的盲测分数不是真实证据：禁止据此替换 Search Champion。
  if (args.validation.evaluation.demoJudged) return { champion: args.current, changed: false, improvement: 0 };
  const score = computeFitness(args.validation.evaluation, args.baseline, args.artifactAcceptance).score;
  const previous = args.current?.score;
  const improvement = previous === undefined ? score : score - previous;
  if (previous !== undefined && improvement < args.minImprovement) {
    // Pareto 例外：总分没到最小提升线，但新候选在效果/成本/延迟/安全上全面不劣且至少一项更优时仍替换，
    // 避免标量化阈值挡住多目标意义上的真实改进。
    const currentEval = args.current?.evaluation;
    if (!(currentEval && dominates(args.validation.evaluation, currentEval))) return { champion: args.current, changed: false, improvement };
  }
  const cumulativePatches = [...(args.current?.patches ?? []), ...args.winner.patches].filter((patch, index, all) => all.findIndex((item) => item.id === patch.id) === index);
  return {
    champion: {
      id: `champion-r${args.round}-${args.winner.id}`,
      versionLabel: `S${args.round}`,
      round: args.round,
      score: Number(score.toFixed(2)),
      candidate: args.winner,
      evaluation: args.validation.evaluation,
      validation: args.validation,
      artifactAcceptance: args.artifactAcceptance,
      patches: cumulativePatches,
      parentVersionId: args.parentVersionId,
      reason: previous === undefined ? "首个通过 Hidden Validation 的 Search Champion" : `基于 ${args.current?.versionLabel ?? args.parentVersionId} 累积进化，较上一 Search Champion 提升 ${improvement.toFixed(2)} 分`,
      selectedAt: new Date().toISOString(),
    },
    changed: true,
    improvement,
  };
}

export function estimateRoundCost(project: EvolveProject) {
  const visible = project.evalSuite.length;
  const hidden = project.hiddenEvalSuite.length;
  const candidates = Math.max(1, project.selectedCandidateIds.length || project.campaign.candidateCount);
  const average = project.baselineRun.result?.averageCost ?? 0.03;
  return Number((average * (visible * candidates + hidden * 2)).toFixed(4));
}

/**
 * 下一轮的预算预估必须按“实际会生成的候选数”计算，而不是照搬 UI 里的 candidateCount。
 * focused 模式最多比较 2 个修法；explore 才使用完整候选数。
 */
export function estimateNextRoundCost(project: EvolveProject) {
  const visible = project.evalSuite.length;
  const hidden = project.hiddenEvalSuite.length;
  const configured = Math.max(1, project.campaign.candidateCount);
  const candidates = project.campaign.searchMode === "focused" ? Math.min(2, configured) : configured;
  const average = project.baselineRun.result?.averageCost ?? 0.03;
  return Number((average * (visible * candidates + hidden * 2)).toFixed(4));
}

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

/**
 * 只在“所有配置了 target 的指标都能被当前评测结果解释，并且全部达标”时才允许自动停止。
 * 旧逻辑对未知指标默认 true，会把任意自定义 target 误判成“全部满足”。
 */
export function campaignMetricTargetStatus(project: EvolveProject) {
  const evaluation = project.searchChampion?.evaluation;
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
    satisfied: targets.length > 0 && supported === targets.length && unsupported.length === 0 && unmet.length === 0,
  };
}

export function buildRoundRecord(args: {
  project: EvolveProject;
  round: number;
  parentVersionId: string;
  winnerId?: string;
  winnerScore?: number;
  championChanged: boolean;
  improvement: number;
  startedAt: string;
  summary: string;
}): EvolutionRound {
  return {
    id: `round-${args.round}-${Date.now()}`,
    round: args.round,
    status: "completed",
    parentVersionId: args.parentVersionId,
    startedAt: args.startedAt,
    completedAt: new Date().toISOString(),
    selectedProblemTitle: args.project.problems.find((problem) => problem.id === args.project.selectedProblemId)?.title,
    candidateCount: args.project.selectedCandidateIds.length || args.project.candidates.length,
    winnerCandidateId: args.winnerId,
    winnerScore: args.winnerScore,
    championChanged: args.championChanged,
    globalChampionId: args.project.searchChampion?.id,
    improvement: Number(args.improvement.toFixed(2)),
    estimatedCost: estimateRoundCost(args.project),
    summary: args.summary,
  };
}

export function campaignStopReason(project: EvolveProject): string | undefined {
  if (project.artifactAcceptance.status === "unverified") return `缺少验证能力，已停止重复改写：${project.artifactAcceptance.summary}`;
  if ((project.validationRun.evaluation?.unverifiedCriterionIds?.length ?? 0) > 0) return "仍有要求缺少真实验证证据，请补齐执行或视觉验证后继续。";
  const campaign = project.campaign;
  const criteria = campaign.stopCriteria;
  if (criteria.stopWhenAcceptanceMet && campaignGoalSatisfied(project)) return "当前进化要求已全部通过：独立验证与成果完整性验收完成";
  if (campaign.currentRound >= criteria.maxRounds) return `已达到设定的最大进化轮数 ${criteria.maxRounds}`;
  if (campaign.noImprovementRounds >= criteria.patienceRounds) return `连续 ${campaign.noImprovementRounds} 轮没有达到最小提升 ${criteria.minImprovement}`;
  if (criteria.targetScore !== undefined && (campaign.bestScore ?? 0) >= criteria.targetScore) return `Search Champion 已达到目标综合分 ${criteria.targetScore}`;
  if (criteria.maxEstimatedCost !== undefined && campaign.estimatedCost >= criteria.maxEstimatedCost) return `预计成本已达到预算上限 ${criteria.maxEstimatedCost}`;
  if (criteria.maxWallMinutes !== undefined && campaign.startedAt) {
    const elapsedMinutes = (Date.now() - new Date(campaign.startedAt).getTime()) / 60_000;
    if (elapsedMinutes >= criteria.maxWallMinutes) return `Campaign 已达到最长运行时间 ${criteria.maxWallMinutes} 分钟`;
  }
  if (criteria.stopOnSafetyFailure && (project.validationRun.evaluation?.safety === "FAIL" || project.experimentRun.candidateResults.some((result) => result.experimentStage === "finalist" && result.evaluation.safety === "FAIL"))) return "检测到 Safety Hard Gate 失败";
  if (criteria.stopWhenMetricTargetsMet && campaignMetricTargetStatus(project).satisfied) return "Search Champion 已满足当前 Evolve Contract 的全部可计算指标目标";
  return undefined;
}

/**
 * 在真正开始下一轮昂贵执行前做 fail-closed 预算检查。
 * 已经达到的停止条件直接复用 campaignStopReason；预算还要把“下一轮预计成本”计入，
 * 防止当前累计 9.9 / 上限 10 时再完整烧一轮才发现越界。
 */
export function campaignPreflightStopReason(project: EvolveProject): string | undefined {
  const existing = campaignStopReason(project);
  if (existing) return existing;
  const limit = project.campaign.stopCriteria.maxEstimatedCost;
  if (limit !== undefined) {
    const next = estimateNextRoundCost(project);
    const projected = project.campaign.estimatedCost + next;
    if (projected > limit + 1e-9) return `下一轮预计成本 ${next.toFixed(4)} 将使累计估算成本达到 ${projected.toFixed(4)}，超过预算上限 ${limit}`;
  }
  return undefined;
}

export function nextScheduledAt(schedule: EvolveProject["campaign"]["schedule"], from = new Date()) {
  if (!schedule.enabled || schedule.mode === "manual") return undefined;
  if (schedule.mode === "once") return schedule.startAt && Number.isFinite(new Date(schedule.startAt).getTime()) && new Date(schedule.startAt).getTime() > from.getTime() ? schedule.startAt : undefined;
  if (schedule.mode === "interval") return new Date(from.getTime() + schedule.intervalMinutes * 60_000).toISOString();
  if (schedule.mode === "weekly" && schedule.daysOfWeek.length === 0) return undefined;
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  if (schedule.mode === "weekly") {
    for (let i = 0; i < 8; i += 1) {
      if (schedule.daysOfWeek.includes(next.getDay()) && next > from) break;
      next.setDate(next.getDate() + 1);
    }
  }
  return next.toISOString();
}

export function campaignScheduleIssue(schedule: EvolveProject["campaign"]["schedule"], from = new Date()): string | undefined {
  if (schedule.mode === "manual") return "计划类型仍为“不定时”，请先选择指定时间、固定间隔、每天或每周。";
  if (schedule.mode === "once") {
    if (!schedule.startAt) return "指定时间计划缺少执行时间。";
    const at = new Date(schedule.startAt).getTime();
    if (!Number.isFinite(at)) return "指定时间格式无效。";
    if (at <= from.getTime()) return "指定执行时间已经过去，请选择未来时间。";
  }
  if (schedule.mode === "weekly" && schedule.daysOfWeek.length === 0) return "每周计划必须至少选择一个星期。";
  const probe = nextScheduledAt({ ...schedule, enabled: true }, from);
  if (!probe) return "当前计划无法计算下一次执行时间。";
  return undefined;
}

/** 执行一次计划后推进调度状态：once 自动关闭，重复计划计算下一次触发点。 */
export function advanceCampaignScheduleAfterRun(schedule: EvolveProject["campaign"]["schedule"], at = new Date()): EvolveProject["campaign"]["schedule"] {
  const lastRunAt = at.toISOString();
  if (!schedule.enabled) return { ...schedule, lastRunAt, nextRunAt: undefined };
  if (schedule.mode === "once") return { ...schedule, enabled: false, lastRunAt, nextRunAt: undefined };
  const nextRunAt = nextScheduledAt({ ...schedule, enabled: true }, at);
  return { ...schedule, enabled: Boolean(nextRunAt), lastRunAt, nextRunAt };
}

export function materializeChampionOutputs(project: EvolveProject): OutputArtifact[] {
  return coreMaterializeChampionOutputs(project);
}

export async function outputArtifactsZip(project: EvolveProject) {
  // 正式下载只允许使用已冻结的 Output Registry。禁止在下载时偷偷重新 Materialize，
  // 否则用户拿到的内容可能与 Hidden Validation / Gate F 实际测试过的快照不一致。
  const artifacts = project.outputArtifacts;
  if (!artifacts.length) throw new Error("尚未冻结正式成果包，请先在项目中完成 Gate F · Artifact Ready 并生成成果物");
  const primary = artifacts.filter((artifact) => artifact.kind === "primary");
  if (!primary.length || primary.some((artifact) => !artifact.accepted)) throw new Error("成果包包含未通过 Artifact Ready 的主成果，禁止下载");
  return buildDeliverableZip(project);
}
