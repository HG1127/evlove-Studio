import { describe, expect, it } from "vitest";
import type { EvolutionArchiveEntry, EvolveProject } from "../schemas";
import { aggregatePatchFamilies, aggregateRecurringGaps, buildSearchMemory, nextExploreRatio, patchFamilyKey, withFamilyVerdicts } from "./search-memory";
import { EvolutionArchiveEntrySchema } from "../schemas";

function entry(partial: {
  id: string;
  round?: number;
  kind?: EvolutionArchiveEntry["kind"];
  niche?: string;
  score: number;
  safety?: "PASS" | "REVIEW" | "FAIL";
  patches: Array<{ component: string; operation: string; target: string }>;
  failures?: string[];
  gap?: string;
}): EvolutionArchiveEntry {
  return EvolutionArchiveEntrySchema.parse({
    id: partial.id,
    round: partial.round ?? 1,
    kind: partial.kind ?? "stepping-stone",
    niche: partial.niche ?? "test",
    score: partial.score,
    candidate: { id: partial.id, name: partial.id, change: "test", patches: partial.patches.map((patch, index) => ({ id: `${partial.id}-p${index}`, ...patch, content: "x", rationale: "r" })) },
    evaluation: {
      accuracy: partial.score, evidence: partial.score, riskCoverage: partial.score, completeness: partial.score,
      safety: partial.safety ?? "PASS", averageCost: 0.01, averageLatencyMs: 500,
      failures: partial.failures ?? [],
      criterionScores: partial.gap ? [{ criterionId: "c1", score: 30, pass: false, gaps: [partial.gap] }] : undefined,
    },
    reason: "test",
    createdAt: new Date().toISOString(),
  });
}

const patchA = { component: "prompt", operation: "update", target: "§tone" };
const patchB = { component: "workflow", operation: "add", target: "retry-node" };

describe("search memory", () => {
  it("家族键归一化大小写与空白并截断超长 target", () => {
    expect(patchFamilyKey({ component: " Prompt ", operation: "Update", target: "  Hello   World " }))
      .toBe(patchFamilyKey({ component: "prompt", operation: "update", target: "hello world" }));
    expect(patchFamilyKey({ component: "prompt", operation: "update", target: "x".repeat(80) }).length)
      .toBeLessThan(80);
  });

  it("聚合同一家族的尝试次数与最好/平均分，safety FAIL 计入失败次数", () => {
    const families = aggregatePatchFamilies([
      entry({ id: "a1", score: 50, patches: [patchA] }),
      entry({ id: "a2", round: 2, score: 62, patches: [patchA] }),
      entry({ id: "b1", score: 80, kind: "failure", safety: "FAIL", patches: [patchB] }),
    ]);
    const a = families.find((item) => item.family === patchFamilyKey(patchA))!;
    const b = families.find((item) => item.family === patchFamilyKey(patchB))!;
    expect(a.attempts).toBe(2);
    expect(a.bestScore).toBe(62);
    expect(a.averageScore).toBe(56);
    expect(b.safetyFailures).toBe(1);
    expect(b.lastRound).toBe(1);
  });

  it("dead-end 判定：至少两次尝试、从未夺冠且最好成绩显著低于 Champion；夺冠家族恒为 winning", () => {
    const families = withFamilyVerdicts(aggregatePatchFamilies([
      entry({ id: "a1", score: 50, patches: [patchA] }),
      entry({ id: "a2", round: 2, score: 52, patches: [patchA] }),
      entry({ id: "b1", round: 3, score: 90, kind: "champion", patches: [patchB] }),
    ]), 90);
    expect(families.find((item) => item.family === patchFamilyKey(patchA))!.verdict).toBe("dead-end");
    expect(families.find((item) => item.family === patchFamilyKey(patchB))!.verdict).toBe("winning");
  });

  it("只尝试一次的家族不判 dead-end", () => {
    const families = withFamilyVerdicts(aggregatePatchFamilies([entry({ id: "a1", score: 40, patches: [patchA] })]), 90);
    expect(families[0]!.verdict).toBe("mixed");
  });

  it("反复出现的差距主题按次数排序，单次出现不入榜", () => {
    const gaps = aggregateRecurringGaps([
      entry({ id: "a1", score: 40, patches: [patchA], gap: "缺少重试机制导致偶发失败" }),
      entry({ id: "a2", round: 2, score: 42, patches: [patchA], gap: "缺少重试机制导致偶发失败" }),
      entry({ id: "b1", round: 2, score: 60, patches: [patchB], gap: "一次性问题" }),
    ]);
    expect(gaps[0]).toMatchObject({ theme: expect.stringContaining("重试"), count: 2 });
    expect(gaps.some((item) => item.theme.includes("一次性"))).toBe(false);
  });

  it("停滞轮数进入记忆摘要；无历史时给中性摘要", () => {
    const base = { evalSuite: [], hiddenEvalSuite: [], selectedCandidateIds: [], problems: [], baselineRun: {} } as unknown as EvolveProject;
    const stagnated = buildSearchMemory({ ...base, evolutionArchive: [], campaign: { noImprovementRounds: 3 } } as unknown as EvolveProject);
    expect(stagnated.stagnationRounds).toBe(3);
    expect(stagnated.summary).toContain("连续 3 轮未提升");
    const fresh = buildSearchMemory({ ...base, evolutionArchive: [], campaign: { noImprovementRounds: 0 } } as unknown as EvolveProject);
    expect(fresh.summary).toContain("暂无足够历史");
  });

  it("自适应探索：夺冠收敛、停滞加码、始终夹在 0.15–0.6", () => {
    expect(nextExploreRatio(0.35, true, 0)).toBe(0.28);
    expect(nextExploreRatio(0.35, false, 1)).toBe(0.35);
    expect(nextExploreRatio(0.35, false, 2)).toBe(0.45);
    expect(nextExploreRatio(0.35, false, 5)).toBe(0.55);
    expect(nextExploreRatio(0.5, true, 0)).toBe(0.4);
    expect(nextExploreRatio(0.1, false, 4)).toBe(0.3);
    expect(nextExploreRatio(0.58, false, 3)).toBe(0.6);
    expect(nextExploreRatio(0.2, false, 0)).toBe(0.2);
  });
});
