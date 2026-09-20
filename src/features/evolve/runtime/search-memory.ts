import type { EvolutionArchiveEntry, EvolveProject } from "../schemas";

/**
 * 搜索记忆（Search Memory）：把多轮 Archive 压缩成「哪类改动反复无效 / 哪类改动真实有效 /
 * 哪些差距反复出现」的紧凑画像，注入下一轮候选生成的提示词。
 *
 * 顶尖进化系统（GEPA / OpenEvolver 这类反思式进化）的共同点是：变异不是无记忆的——
 * 每轮把「失败反模式 + 有效模式」显式喂回给生成器，避免种群在同一批 dead-end 上反复烧预算。
 * 这里只做纯函数派生，不持久化、不改项目状态。
 */

export type FamilyStat = {
  /** 稳定键：component:operation:target（target 截断，避免超长路径撑爆提示词）。 */
  family: string;
  attempts: number;
  averageScore: number;
  bestScore: number;
  /** 该家族产出的候选成为当轮 Champion / Archive champion 的次数。 */
  wins: number;
  safetyFailures: number;
  lastRound: number;
  verdict: "dead-end" | "winning" | "mixed";
};

export type SearchMemory = {
  families: FamilyStat[];
  deadEnds: FamilyStat[];
  winning: FamilyStat[];
  recurringGaps: Array<{ theme: string; count: number }>;
  stagnationRounds: number;
  archiveSize: number;
  championScore?: number;
  /** 一句话画像，直接用于活动流 / 汇总展示。 */
  summary: string;
};

/** 家族键：同一 component+operation+target 的改动视为同一「变异家族」。 */
export function patchFamilyKey(patch: { component: string; operation: string; target: string }): string {
  const target = patch.target.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 48);
  return `${patch.component.toLowerCase().trim()}:${patch.operation.toLowerCase().trim()}:${target || "*"}`;
}

type MutableFamily = {
  family: string;
  attempts: number;
  totalScore: number;
  bestScore: number;
  wins: number;
  safetyFailures: number;
  lastRound: number;
};

/**
 * 从 Archive 聚合每个变异家族的历史表现。
 * 失败条目（safety FAIL）也计入 attempts——「试过且被 Hard Gate 拦下」本身就是记忆。
 */
export function aggregatePatchFamilies(archive: EvolutionArchiveEntry[]): FamilyStat[] {
  const byFamily = new Map<string, MutableFamily>();
  for (const entry of archive) {
    const keys = [...new Set(entry.candidate.patches.map(patchFamilyKey))];
    if (!keys.length) continue;
    const isWin = entry.kind === "champion";
    const isSafetyFailure = entry.kind === "failure" || entry.evaluation.safety === "FAIL";
    for (const key of keys) {
      const current = byFamily.get(key) ?? { family: key, attempts: 0, totalScore: 0, bestScore: -Infinity, wins: 0, safetyFailures: 0, lastRound: 0 };
      current.attempts += 1;
      current.totalScore += entry.score;
      current.bestScore = Math.max(current.bestScore, entry.score);
      current.wins += isWin ? 1 : 0;
      current.safetyFailures += isSafetyFailure ? 1 : 0;
      current.lastRound = Math.max(current.lastRound, entry.round);
      byFamily.set(key, current);
    }
  }
  return [...byFamily.values()]
    .map((item): FamilyStat => ({
      family: item.family,
      attempts: item.attempts,
      averageScore: Number((item.totalScore / item.attempts).toFixed(2)),
      bestScore: Number(item.bestScore.toFixed(2)),
      wins: item.wins,
      safetyFailures: item.safetyFailures,
      lastRound: item.lastRound,
      verdict: "mixed",
    }))
    .sort((a, b) => b.bestScore - a.bestScore);
}

/** 反复出现的差距主题：来自逐 criterion 的 gaps 与评测 failures，归一化后计数。 */
export function aggregateRecurringGaps(archive: EvolutionArchiveEntry[], limit = 6): Array<{ theme: string; count: number }> {
  const counts = new Map<string, number>();
  const bump = (raw: string) => {
    const theme = raw.toLowerCase().replace(/\d+(\.\d+)?/g, "#").replace(/\s+/g, " ").trim().slice(0, 64);
    if (theme.length < 8) return;
    counts.set(theme, (counts.get(theme) ?? 0) + 1);
  };
  for (const entry of archive) {
    for (const failure of entry.evaluation.failures) bump(failure);
    for (const criterion of entry.evaluation.criterionScores ?? []) {
      if (criterion.pass) continue;
      for (const gap of criterion.gaps) bump(gap);
    }
  }
  return [...counts.entries()]
    .map(([theme, count]) => ({ theme, count }))
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme))
    .slice(0, limit);
}

/**
 * 判定 dead-end：同一家族至少尝试 2 次、从未夺冠、最好成绩仍显著低于当前 Champion。
 * 阈值用相对差（6 分）而不是绝对分，兼容不同项目的分数分布。
 */
export function withFamilyVerdicts(families: FamilyStat[], championScore: number | undefined): FamilyStat[] {
  const reference = championScore ?? families[0]?.bestScore;
  if (reference === undefined) return families;
  return families.map((item) => ({
    ...item,
    verdict: item.wins > 0 || item.bestScore >= reference - 1
      ? "winning"
      : item.attempts >= 2 && item.bestScore <= reference - 6
        ? "dead-end"
        : "mixed",
  }));
}

export function buildSearchMemory(project: EvolveProject): SearchMemory {
  const archive = project.evolutionArchive;
  const families = withFamilyVerdicts(aggregatePatchFamilies(archive), project.searchChampion?.score);
  const deadEnds = families.filter((item) => item.verdict === "dead-end").slice(0, 8);
  const winning = families.filter((item) => item.verdict === "winning").slice(0, 6);
  const recurringGaps = aggregateRecurringGaps(archive);
  const stagnationRounds = project.campaign.noImprovementRounds;
  const parts: string[] = [];
  if (deadEnds.length) parts.push(`${deadEnds.length} 类改动反复无效`);
  if (winning.length) parts.push(`${winning.length} 类改动有效`);
  if (recurringGaps.length) parts.push(`${recurringGaps[0]!.count} 次重复出现「${recurringGaps[0]!.theme}」`);
  if (stagnationRounds >= 2) parts.push(`已连续 ${stagnationRounds} 轮未提升`);
  return {
    families,
    deadEnds,
    winning,
    recurringGaps,
    stagnationRounds,
    archiveSize: archive.length,
    championScore: project.searchChampion?.score,
    summary: parts.length ? `搜索记忆：${parts.join("；")}。` : "搜索记忆：暂无足够历史，正常探索。",
  };
}

/**
 * 自适应探索比例：夺冠后收敛（exploit），连续停滞时加码探索（escape local optimum）。
 * 只在 [0.15, 0.6] 区间内漂移，且每轮变化都写进活动流，避免用户配置被静默改掉的感觉。
 */
export function nextExploreRatio(current: number, championChanged: boolean, noImprovementRounds: number): number {
  const clamp = (value: number) => Number(Math.max(0.15, Math.min(0.6, value)).toFixed(2));
  if (championChanged) return clamp(current * 0.8);
  if (noImprovementRounds >= 2) return clamp(current + 0.1 * Math.min(noImprovementRounds - 1, 2));
  return clamp(current);
}
