import { describe, expect, it } from "vitest";
import type { Candidate, EvolveProject, EvolutionArchiveEntry } from "../schemas";
import { CandidateSchema, EvolutionArchiveEntrySchema } from "../schemas";
import { advanceCampaignScheduleAfterRun, campaignGoalSatisfied, campaignMetricTargetStatus, campaignPreflightStopReason, campaignScheduleIssue, campaignStopReason, nextScheduledAt, selectDiverseCandidates } from "./evolution-search";
import { demoProject } from "../data/mock-project";
import { prepareCampaignRetry } from "@evolution/core";

type PatchInput = { component: "prompt" | "workflow" | "tool" | "memory" | "code" | "model"; operation: "add" | "update" | "remove"; target: string; content: string };

function candidate(id: string, patches: PatchInput[]): Candidate {
  return CandidateSchema.parse({ id, name: id, change: "test", patches: patches.map((patch, index) => ({ id: `${id}-p${index}`, ...patch, rationale: "r" })) });
}

function archiveEntry(id: string, round: number, score: number, kind: EvolutionArchiveEntry["kind"], patches: PatchInput[]): EvolutionArchiveEntry {
  return EvolutionArchiveEntrySchema.parse({
    id,
    round,
    kind,
    niche: "test",
    score,
    candidate: { id, name: id, change: "test", patches: patches.map((patch, index) => ({ id: `${id}-p${index}`, ...patch, rationale: "r" })) },
    evaluation: { accuracy: score, evidence: score, riskCoverage: score, completeness: score, safety: "PASS", averageCost: 0.01, averageLatencyMs: 400, failures: [] },
    reason: "test",
    createdAt: new Date().toISOString(),
  });
}

const familyA = (content: string): PatchInput => ({ component: "prompt", operation: "update", target: "§tone", content });
const familyB = (content: string): PatchInput => ({ component: "workflow", operation: "add", target: "retry-node", content });
const familyC = (content: string): PatchInput => ({ component: "tool", operation: "add", target: "validator", content });

// Archive：家族 A 反复尝试但从未夺冠且分数远低于 Champion（dead-end），家族 B 是夺冠方向。
const baseArchive = [
  archiveEntry("a1", 1, 40, "stepping-stone", [familyA("old-1")]),
  archiveEntry("a2", 2, 42, "stepping-stone", [familyA("old-2")]),
  archiveEntry("b1", 3, 90, "champion", [familyB("old-3")]),
];

function project(archive: EvolutionArchiveEntry[], exploreRatio = 0): EvolveProject {
  return {
    evolutionArchive: archive,
    searchChampion: { score: 90 },
    campaign: { exploreRatio, noImprovementRounds: 0 },
  } as unknown as EvolveProject;
}

describe("autonomous campaign completion", () => {
  it("stops successfully as soon as a fully accepted Search Champion exists", () => {
    const candidate = CandidateSchema.parse({ id:"C-auto", name:"达标版本", change:"满足要求", artifactSnapshots:[{ id:"s-auto", sourceArtifactId:demoProject.sourceArtifacts[0]!.id, name:"result.txt", mimeType:"text/plain", content:"accepted", contentHash:"accepted-hash", createdAt:new Date().toISOString() }] });
    const p = {
      ...demoProject,
      campaign: { ...demoProject.campaign, stopCriteria: { ...demoProject.campaign.stopCriteria, stopWhenAcceptanceMet:true } },
      searchChampion: {
        id:"champion-auto", versionLabel:"S1", round:1, score:90, candidate, patches:[], reason:"accepted", selectedAt:new Date().toISOString(),
        validation:{ id:"v-auto", status:"completed" as const, candidateId:candidate.id, recommendation:"release" as const, runs:[], baselineRuns:[], checks:[], evaluation:{ accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS" as const,averageCost:0,averageLatencyMs:1,failures:[],unverifiedCriterionIds:[] } },
        artifactAcceptance:{ id:"a-auto",status:"passed" as const,candidateId:candidate.id,overallScore:90,coverageScore:95,integrityScore:100,pairwiseScore:90,hardGatePass:true,results:[],attempts:0,maxRepairAttempts:3,summary:"passed" },
      },
    } as unknown as EvolveProject;
    expect(campaignGoalSatisfied(p)).toBe(true);
    expect(campaignStopReason(p)).toContain("进化要求已全部通过");
  });

  it("reaching max rounds without an accepted champion is not goal satisfaction", () => {
    const p = { ...demoProject, searchChampion:undefined, campaign:{ ...demoProject.campaign, currentRound:5, stopCriteria:{ ...demoProject.campaign.stopCriteria, maxRounds:5, stopWhenAcceptanceMet:true } } } as EvolveProject;
    expect(campaignGoalSatisfied(p)).toBe(false);
    expect(campaignStopReason(p)).toContain("最大进化轮数");
  });
});

describe("campaign control preflight", () => {
  const evaluation = { accuracy: 92, evidence: 91, riskCoverage: 90, completeness: 93, safety: "PASS" as const, averageCost: 0.4, averageLatencyMs: 800, notes: [], failures: [] };

  it("does not treat unsupported custom metrics as automatically satisfied", () => {
    const p = {
      ...demoProject,
      metrics: [{ ...demoProject.metrics[0]!, key: "custom-business-kpi", label: "自定义业务指标", target: 95, direction: "higher" as const }],
      searchChampion: { id:"metric-champion", versionLabel:"S1", round:1, score:90, evaluation, patches:[], reason:"test", selectedAt:new Date().toISOString() },
      campaign: { ...demoProject.campaign, stopCriteria: { ...demoProject.campaign.stopCriteria, stopWhenAcceptanceMet:false, stopWhenMetricTargetsMet:true }, currentRound:0, noImprovementRounds:0 },
    } as EvolveProject;
    const status = campaignMetricTargetStatus(p);
    expect(status.satisfied).toBe(false);
    expect(status.unsupported).toContain("自定义业务指标");
    expect(campaignStopReason(p)).toBeUndefined();
  });

  it("supports lower-is-better cost targets without reversing the comparison", () => {
    const p = {
      ...demoProject,
      metrics: [{ ...demoProject.metrics[0]!, key: "cost", label: "平均成本", target: 0.5, direction: "lower" as const }],
      searchChampion: { id:"cost-champion", versionLabel:"S1", round:1, score:90, evaluation, patches:[], reason:"test", selectedAt:new Date().toISOString() },
      campaign: { ...demoProject.campaign, stopCriteria: { ...demoProject.campaign.stopCriteria, stopWhenAcceptanceMet:false, stopWhenMetricTargetsMet:true }, currentRound:0, noImprovementRounds:0 },
    } as EvolveProject;
    expect(campaignMetricTargetStatus(p).satisfied).toBe(true);
    expect(campaignStopReason(p)).toContain("指标目标");
  });

  it("blocks before an estimated next round would overshoot the budget", () => {
    const p = {
      ...demoProject,
      campaign: { ...demoProject.campaign, searchMode:"focused" as const, candidateCount:5, estimatedCost:0.99, stopCriteria:{ ...demoProject.campaign.stopCriteria, maxEstimatedCost:1, stopWhenAcceptanceMet:false, stopWhenMetricTargetsMet:false }, currentRound:0, noImprovementRounds:0 },
    } as EvolveProject;
    expect(campaignPreflightStopReason(p)).toContain("超过预算上限");
  });

  it("explicit retry restarts the patience window while preserving completed rounds and champion", () => {
    const p = {
      ...demoProject,
      campaign: {
        ...demoProject.campaign,
        status: "paused" as const,
        currentRound: 2,
        noImprovementRounds: 2,
        stopCriteria: { ...demoProject.campaign.stopCriteria, maxRounds: 5, patienceRounds: 2 },
        stopReason: "连续 2 轮没有达到最小提升 0.3",
      },
    } as EvolveProject;
    expect(campaignPreflightStopReason(p)).toContain("连续 2 轮");
    const retried = prepareCampaignRetry(p);
    expect(retried.campaign.noImprovementRounds).toBe(0);
    expect(retried.campaign.currentRound).toBe(2);
    expect(retried.searchChampion).toBe(p.searchChampion);
    expect(retried.campaign.stopReason).toBeUndefined();
    expect(campaignPreflightStopReason(retried)).toBeUndefined();
  });

  it("explicit retry does not bypass the total round limit", () => {
    const p = {
      ...demoProject,
      campaign: {
        ...demoProject.campaign,
        status: "paused" as const,
        currentRound: 5,
        noImprovementRounds: 2,
        stopCriteria: { ...demoProject.campaign.stopCriteria, maxRounds: 5, patienceRounds: 2 },
      },
    } as EvolveProject;
    expect(campaignPreflightStopReason(prepareCampaignRetry(p))).toContain("最大进化轮数");
  });

  it("explicit retry starts a new elapsed time window", () => {
    const p = {
      ...demoProject,
      campaign: {
        ...demoProject.campaign,
        status: "paused" as const,
        startedAt: "2026-09-26T00:00:00.000Z",
        stopCriteria: { ...demoProject.campaign.stopCriteria, maxWallMinutes: 10 },
      },
    } as EvolveProject;
    const retried = prepareCampaignRetry(p, new Date("2026-09-26T00:11:00.000Z"));
    expect(retried.campaign.startedAt).toBeUndefined();
    expect(retried.campaign.currentRound).toBe(p.campaign.currentRound);
  });

  it("advances recurring schedules and closes one-shot schedules after execution", () => {
    const at = new Date("2026-09-17T10:00:00.000Z");
    const base = demoProject.campaign.schedule;
    const once = advanceCampaignScheduleAfterRun({ ...base, mode:"once", enabled:true, startAt:"2026-09-17T10:00:00.000Z" }, at);
    expect(once.enabled).toBe(false);
    expect(once.nextRunAt).toBeUndefined();
    const interval = advanceCampaignScheduleAfterRun({ ...base, mode:"interval", enabled:true, intervalMinutes:60 }, at);
    expect(interval.enabled).toBe(true);
    expect(interval.nextRunAt).toBe("2026-09-17T11:00:00.000Z");
  });

  it("fails closed for invalid schedules instead of creating a fake scheduled state", () => {
    const base = demoProject.campaign.schedule;
    expect(campaignScheduleIssue({ ...base, mode:"manual", enabled:true })).toContain("不定时");
    expect(campaignScheduleIssue({ ...base, mode:"weekly", enabled:true, daysOfWeek:[] })).toContain("星期");
    expect(nextScheduledAt({ ...base, mode:"weekly", enabled:true, daysOfWeek:[] })).toBeUndefined();
    expect(campaignScheduleIssue({ ...base, mode:"once", enabled:true, startAt:"2000-01-01T00:00:00.000Z" })).toContain("已经过去");
  });
});

describe("selectDiverseCandidates · 反思式选择", () => {
  it("死路家族候选垫底：同池有健康家族时优先入选", () => {
    const pool = [
      candidate("cA1", [familyA("new-1")]),
      candidate("cA2", [familyA("new-2")]),
      candidate("cB1", [familyB("new-3")]),
    ];
    const picked = selectDiverseCandidates({ project: project(baseArchive), candidates: pool, count: 2 });
    expect(picked.map((item) => item.id)).toEqual(["cB1", "cA1"]);
    const onlyHealthy = selectDiverseCandidates({ project: project(baseArchive), candidates: pool, count: 1 });
    expect(onlyHealthy.map((item) => item.id)).toEqual(["cB1"]);
  });

  it("死路候选不剔除：种群不足时仍会用它们补位", () => {
    const pool = [
      candidate("cA1", [familyA("new-1")]),
      candidate("cA2", [familyA("new-2")]),
    ];
    const picked = selectDiverseCandidates({ project: project(baseArchive), candidates: pool, count: 2 });
    expect(picked.map((item) => item.id)).toEqual(["cA1", "cA2"]);
  });

  it("健康父代池（无死路）时保持原有 explore/exploit 配额行为", () => {
    const archive = [
      archiveEntry("b1", 1, 88, "champion", [familyB("old-1")]),
      archiveEntry("c1", 2, 70, "elite", [familyC("old-2")]),
    ];
    const pool = [
      candidate("cB1", [familyB("new-1")]),
      candidate("cC1", [familyC("new-2")]),
      candidate("cA1", [familyA("new-3")]),
    ];
    // exploreRatio 0.35、count 3 → explore 1 个；familiar 为空，exploit 缺口按池序补位。
    const picked = selectDiverseCandidates({ project: project(archive, 0.35), candidates: pool, count: 3 });
    expect(picked.map((item) => item.id)).toEqual(["cB1", "cC1", "cA1"]);
  });

  it("补位时优先带来新变异家族的候选，避免种群塌缩到同一族群", () => {
    // 无死路的健康 Archive；让 cA1 真正 familiar：archive 里用相同 content。
    const archiveWithSameContent = [
      archiveEntry("a1", 1, 60, "stepping-stone", [familyA("same")]),
      archiveEntry("b1", 2, 85, "champion", [familyB("old-2")]),
    ];
    const mixedPool = [
      candidate("cA1", [familyA("same")]),     // familiar
      candidate("cB1", [familyB("new-1")]),    // novel · family B
      candidate("cB2", [familyB("new-2")]),    // novel · family B（与 cB1 同族群）
      candidate("cC1", [familyC("new-3")]),    // novel · family C
    ];
    // exploreRatio 0.35、count 3 → explore 1 + exploit 2；familiar 只有 1 个 → 需补位 1 个。
    const picked = selectDiverseCandidates({ project: project(archiveWithSameContent, 0.35), candidates: mixedPool, count: 3 });
    // 补位应选 family C（新族群）而不是第二个 family B。
    expect(picked.map((item) => item.id)).toEqual(["cA1", "cB1", "cC1"]);
    expect(picked.some((item) => item.id === "cB2")).toBe(false);
  });

  it("完全相同的 patch 集合会被精确去重", () => {
    const pool = [
      candidate("dup-1", [familyA("same-content")]),
      candidate("dup-2", [familyA("same-content")]),
      candidate("other", [familyB("same-content")]),
    ];
    const picked = selectDiverseCandidates({ project: project([]), candidates: pool, count: 3 });
    expect(picked.map((item) => item.id)).toEqual(["dup-1", "other"]);
  });
});
