import {
  computeSearchFitness,
  estimateRoundCost,
  materializeChampionOutputs as coreMaterializeChampionOutputs,
  updateSearchChampion,
} from "@evolution/core";
export {
  campaignGoalSatisfied,
  campaignMetricTargetStatus,
  campaignPreflightStopReason,
  campaignStopReason,
  estimateNextRoundCost,
  estimateRoundCost,
} from "@evolution/core";
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

export function computeFitness(evaluation: EvaluationResult, baseline?: EvaluationResult, acceptance?: EvolveProject["artifactAcceptance"]): FitnessBreakdown {
  return computeSearchFitness(evaluation,baseline,acceptance);
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
  return updateSearchChampion(args);
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
    baselineMeasurementFingerprint: args.project.baselineRun.measurementFingerprint,
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
