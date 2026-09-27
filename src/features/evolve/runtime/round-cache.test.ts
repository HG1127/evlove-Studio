import { describe, expect, it, vi } from "vitest";
import type { EvolveProject } from "../schemas";
import { baselineFingerprint, baselineMeasurementFingerprint, baselineScoringRouteFingerprint, campaignScoringRouteBlocker, canReuseVisibleBaseline, canReusePriorDiagnosis, clearRoundCaches, getHoldoutBaseline, getVisibleBaseline, holdoutBaselineFingerprint, setHoldoutBaseline, setVisibleBaseline } from "./round-cache";
import { demoProject } from "../data/mock-project";
import { EvolutionRoundSchema } from "../schemas";
import { buildRoundRecord } from "./evolution-search";

function project(overrides: Partial<EvolveProject> = {}): EvolveProject {
  return {
    id: "p1",
    evalSuite: [{ id: "c1", input: "q", expected: ["a"] }],
    hiddenEvalSuite: [{ id: "h1" }],
    sourceArtifacts: [{ id: "a1", role: "target", textContent: "hello" }],
    appliedPatches: [],
    experimentPolicy: { batchArtifactRuntime: true, batchSize: 4 },
    targetConnection: { id: "local" },
    ...overrides,
  } as unknown as EvolveProject;
}

describe("campaign Baseline reuse", () => {
  it("reuses a complete verified measurement and rejects a Demo Judge or missing cases", () => {
    const verified = { ...demoProject.baselineRun,
      measurementFingerprint: baselineMeasurementFingerprint(demoProject),
      runs: demoProject.evalSuite.map((testCase) => ({ testCaseId: testCase.id, verificationStatus: "verified" as const })) as EvolveProject["baselineRun"]["runs"],
    };
    expect(canReuseVisibleBaseline(demoProject, verified)).toBe(true);
    expect(canReuseVisibleBaseline(demoProject, { ...verified, result: { ...verified.result!, demoJudged: true } })).toBe(false);
    expect(canReuseVisibleBaseline(demoProject, { ...verified, runs: [] })).toBe(false);
    expect(canReuseVisibleBaseline(demoProject, { ...verified, measurementFingerprint: undefined })).toBe(false);
    expect(canReuseVisibleBaseline(demoProject, { ...verified, measurementFingerprint: "old-target-and-suite" })).toBe(false);
    expect(canReuseVisibleBaseline({ ...demoProject, goal: "修改后的用户目标" }, verified)).toBe(false);
    expect(canReuseVisibleBaseline({ ...demoProject, sourceArtifacts: [{ ...demoProject.sourceArtifacts[0]!, name: "renamed.md" }, ...demoProject.sourceArtifacts.slice(1)] }, verified)).toBe(false);
    expect(canReuseVisibleBaseline({ ...demoProject, targetConnection: { ...demoProject.targetConnection, status: "error", label: "Renamed" } }, verified)).toBe(true);
    expect(canReuseVisibleBaseline({ ...demoProject, evalSuite: demoProject.evalSuite.map((testCase) => ({ ...testCase, input: testCase.input + " 新要求" })) }, verified)).toBe(false);
    expect(canReuseVisibleBaseline({ ...demoProject, aiProfile: { mode: "project", primary: { connectionId: "judge-2", model: "different", label: "new judge" } } }, verified)).toBe(false);
  });
  it("remeasures a live Target in a new round but resumes its same-round Baseline", () => {
    const dynamic = { ...demoProject, targetConnection: { ...demoProject.targetConnection, adapter: "http" as const } };
    const verified = {
      ...dynamic.baselineRun,
      completedAt: "2026-09-28T00:00:00.000Z",
      measurementFingerprint: baselineMeasurementFingerprint(dynamic),
      runs: dynamic.evalSuite.map((testCase) => ({ testCaseId: testCase.id, verificationStatus: "verified" as const })) as EvolveProject["baselineRun"]["runs"],
    };
    expect(canReuseVisibleBaseline(dynamic, verified)).toBe(false);
    const resumed = { ...dynamic, campaign: { ...dynamic.campaign, checkpoint: { round: dynamic.campaign.currentRound + 1, completedPhase: "baseline" as const, at: "2026-09-28T00:00:00Z" } } };
    expect(canReuseVisibleBaseline(resumed, verified, Date.parse(verified.completedAt!) + 1_000)).toBe(true);
    expect(canReuseVisibleBaseline(resumed, verified, Date.parse(verified.completedAt!) + 10 * 60_000)).toBe(false);
    expect(canReuseVisibleBaseline({ ...resumed, campaign: { ...resumed.campaign, currentRound: resumed.campaign.currentRound + 1, checkpoint: undefined } }, verified)).toBe(false);
    expect(holdoutBaselineFingerprint(dynamic)).toBe(holdoutBaselineFingerprint(resumed));
    expect(holdoutBaselineFingerprint({ ...dynamic, campaign: { ...dynamic.campaign, currentRound: dynamic.campaign.currentRound + 1 } })).not.toBe(holdoutBaselineFingerprint(dynamic));
    expect(holdoutBaselineFingerprint({ ...demoProject, campaign: { ...demoProject.campaign, currentRound: demoProject.campaign.currentRound + 1 } })).toBe(holdoutBaselineFingerprint(demoProject));
    const hiddenExternal = { ...demoProject, hiddenEvalSuite: demoProject.hiddenEvalSuite.map((testCase, index) => index === 0 ? { ...testCase, executionMode: "external-runner" as const } : testCase) };
    expect(holdoutBaselineFingerprint({ ...hiddenExternal, campaign: { ...hiddenExternal.campaign, currentRound: hiddenExternal.campaign.currentRound + 1 } })).not.toBe(holdoutBaselineFingerprint(hiddenExternal));
  });
});
describe("repair-round diagnosis evidence", () => {
  it("reuses the prior root cause only when the previous round measured these exact inputs", () => {
    const fingerprint = baselineMeasurementFingerprint(demoProject);
    const previous = EvolutionRoundSchema.parse({
      id: "round-1", round: 1, status: "completed", parentVersionId: "V0",
      startedAt: "2026-09-28T00:00:00Z", candidateCount: 1, summary: "No improvement",
      baselineMeasurementFingerprint: fingerprint,
    });
    const eligible = {
      ...demoProject,
      diagnosis: { summary: "Evidence-backed root cause" } as EvolveProject["diagnosis"],
      roundHistory: [previous],
      campaign: {
        ...demoProject.campaign, currentRound: 1, noImprovementRounds: 1,
        lastGapAdvice: { overall: "Try another mutation", actions: [] },
      },
    };
    expect(canReusePriorDiagnosis(eligible)).toBe(true);
    expect(canReusePriorDiagnosis({ ...eligible, targetConnection: { ...eligible.targetConnection, adapter: 'http' } })).toBe(false);
    expect(canReusePriorDiagnosis({ ...eligible, goal: "Updated user goal" })).toBe(false);
    expect(canReusePriorDiagnosis({ ...eligible, evalSuite: demoProject.evalSuite.map((testCase) => ({ ...testCase, input: testCase.input + " changed" })) })).toBe(false);
    expect(canReusePriorDiagnosis({ ...eligible, roundHistory: [{ ...previous, baselineMeasurementFingerprint: undefined }] })).toBe(false);
    expect(canReusePriorDiagnosis({ ...eligible, campaign: { ...eligible.campaign, currentRound: 2 } })).toBe(false);
  });

  it("records the measured Baseline identity in each completed round", () => {
    const fingerprint = baselineMeasurementFingerprint(demoProject);
    const record = buildRoundRecord({
      project: { ...demoProject, baselineRun: { ...demoProject.baselineRun, measurementFingerprint: fingerprint } },
      round: 1, parentVersionId: "V0", championChanged: false, improvement: 0,
      startedAt: "2026-09-28T00:00:00Z", summary: "No improvement",
    });
    expect(EvolutionRoundSchema.parse(record).baselineMeasurementFingerprint).toBe(fingerprint);
  });
});
describe("Campaign scoring route binding", () => {
  const profile = { mode: "project" as const, primary: { connectionId: "judge-1", model: "model-a", label: "Judge" } };
  const measured = {
    ...demoProject,
    aiProfile: profile,
    campaign: {
      ...demoProject.campaign,
      currentRound: 1,
      rootBaseline: demoProject.baselineRun.result,
      scoringRouteFingerprint: baselineScoringRouteFingerprint({ ...demoProject, aiProfile: profile }),
    },
  };

  it("allows the original scoring route and unrelated diagnosis or Champion changes", () => {
    expect(campaignScoringRouteBlocker(measured)).toBeUndefined();
    expect(campaignScoringRouteBlocker({
      ...measured,
      aiProfile: { ...profile, operationRoutes: { diagnose: { connectionId: "judge-1", model: "diagnosis-b", label: "Diagnosis" } } },
    })).toBeUndefined();
    expect(campaignScoringRouteBlocker({ ...measured, version: "V2" })).toBeUndefined();
  });

  it("pauses old and switched routes before another round can compare scores", () => {
    expect(campaignScoringRouteBlocker({
      ...measured,
      aiProfile: { ...profile, primary: { ...profile.primary, model: "model-b" } },
    })).toContain("重置搜索");
    expect(campaignScoringRouteBlocker({
      ...measured,
      campaign: { ...measured.campaign, scoringRouteFingerprint: undefined },
    })).toContain("重置搜索");
    expect(campaignScoringRouteBlocker({
      ...measured,
      campaign: { ...measured.campaign, currentRound: 0, scoringRouteFingerprint: undefined },
    })).toBeUndefined();
  });
});
describe("round-cache · 跨轮 Baseline 复用", () => {
  it("同 ID 隐藏题内容、模型与用户目标变化使缓存失效", () => {
    const base = baselineFingerprint(project());
    expect(baselineFingerprint(project({ hiddenEvalSuite:[{id:"h1",input:"新测试"}] } as Partial<EvolveProject>))).not.toBe(base);
    expect(baselineFingerprint(project({goal:"新的目标"}))).not.toBe(base);
    expect(baselineFingerprint(project({aiProfile:{mode:"project",primary:{connectionId:"x",model:"different",label:"test"}}} as Partial<EvolveProject>))).not.toBe(base);
  });
  it("global Judge route changes invalidate an otherwise complete Baseline", () => {
    const connectionKey = "evolve-studio:provider-connections:v2";
    const routingKey = "evolve-studio:ai-routing:v2";
    const originalConnection = localStorage.getItem(connectionKey);
    const originalRouting = localStorage.getItem(routingKey);
    try {
      localStorage.setItem(connectionKey, JSON.stringify([{
        id: "baseline-global-judge", providerId: "openai", label: "Test Judge", enabled: true,
        apiKey: "test-key", defaultModel: "gpt-5.6-sol", models: ["gpt-5.6-sol", "gpt-5.6-terra"],
        createdAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z",
      }]));
      const policy = (model: string) => ({
        mode: "single", operationRoutes: {}, defaultRoute: { connectionId: "baseline-global-judge", model, fallbackConnectionIds: [] },
        requireIndependentEvaluator: false, fallbackToDemo: false,
      });
      localStorage.setItem(routingKey, JSON.stringify(policy("gpt-5.6-sol")));
      const first = baselineFingerprint(project());
      const scoringRoute = baselineScoringRouteFingerprint(project());
      localStorage.setItem(routingKey, JSON.stringify(policy("gpt-5.6-terra")));
      expect(baselineFingerprint(project())).not.toBe(first);
      expect(baselineScoringRouteFingerprint(project())).not.toBe(scoringRoute);
    } finally {
      if (originalConnection === null) localStorage.removeItem(connectionKey);
      else localStorage.setItem(connectionKey, originalConnection);
      if (originalRouting === null) localStorage.removeItem(routingKey);
      else localStorage.setItem(routingKey, originalRouting);
    }
  });
  it("只改诊断节点模型不让 Baseline 缓存失效", () => {
    const base = baselineFingerprint(project());
    const scoped = project({ aiProfile: {
      mode: "project",
      primary: { connectionId: "x", model: "m", label: "test" },
      operationRoutes: { diagnose: { connectionId: "x", model: "diagnosis-model", label: "诊断" } },
    } } as Partial<EvolveProject>);
    const baselineScoped = project({ aiProfile: {
      mode: "project",
      primary: { connectionId: "x", model: "m", label: "test" },
    } } as Partial<EvolveProject>);
    expect(baselineFingerprint(scoped)).toBe(baselineFingerprint(baselineScoped));
    expect(baselineFingerprint(scoped)).not.toBe(base);
  });
  it("缓存返回隔离副本，并在三十分钟后失效", () => {
    clearRoundCaches();
    const start = Date.now();
    const time = vi.spyOn(Date,"now").mockReturnValue(start);
    try {
      setVisibleBaseline("p1","fp",{id:"original"} as never);
      getVisibleBaseline("p1","fp")!.id = "changed";
      expect(getVisibleBaseline("p1","fp")!.id).toBe("original");
      time.mockReturnValue(start + 29 * 60_000);
      expect(getVisibleBaseline("p1","fp")?.id).toBe("original");
      time.mockReturnValue(start + 30 * 60_000 + 1);
      expect(getVisibleBaseline("p1","fp")).toBeUndefined();
    } finally { time.mockRestore(); }
  });
  it("指纹：输入相同稳定；考卷 / 进化对象 / 执行配置变化立即失效", () => {
    const base = baselineFingerprint(project());
    expect(baselineFingerprint(project())).toBe(base);
    expect(baselineFingerprint(project({ evalSuite: [{ id: "c1", input: "q2", expected: ["a"] }] } as Partial<EvolveProject>))).not.toBe(base);
    expect(baselineFingerprint(project({ hiddenEvalSuite: [{ id: "h2" }] } as Partial<EvolveProject>))).not.toBe(base);
    expect(baselineFingerprint(project({ sourceArtifacts: [{ id: "a1", role: "target", textContent: "hello!" }] } as Partial<EvolveProject>))).not.toBe(base);
    expect(baselineFingerprint(project({ experimentPolicy: { batchArtifactRuntime: false, batchSize: 4 } } as Partial<EvolveProject>))).not.toBe(base);
    expect(baselineFingerprint(project({ appliedPatches: [{ id: "p1", component: "prompt", operation: "add", target: "t", content: "c", rationale: "r" }] } as Partial<EvolveProject>))).not.toBe(base);
  });

  it("参考材料变化使基线失效，避免继续使用旧证据", () => {
    const base = baselineFingerprint(project());
    const withReference = project({ sourceArtifacts: [{ id: "a1", role: "target", textContent: "hello" }, { id: "r1", role: "reference", textContent: "ref" }] } as Partial<EvolveProject>);
    expect(baselineFingerprint(withReference)).not.toBe(base);
  });

  it("Search Champion 内容变化会使下一轮 Baseline 缓存失效", () => {
    const champion = (content: string) => ({
      candidate: { id: "winner", artifactSnapshots: [{ sourceArtifactId: "a1", content }] },
      validation: { status: "completed", recommendation: "release" },
      artifactAcceptance: { status: "passed", candidateId: "winner" },
    });
    const first = baselineFingerprint(project({ searchChampion: champion("S1") } as Partial<EvolveProject>));
    const next = baselineFingerprint(project({ searchChampion: champion("S2") } as Partial<EvolveProject>));
    expect(next).not.toBe(first);
  });

  it("可见 Baseline：指纹命中可复用，指纹或项目不同则 miss", () => {
    clearRoundCaches();
    const fp = baselineFingerprint(project());
    setVisibleBaseline("p1", fp, { id: "b1" } as never);
    expect(getVisibleBaseline("p1", fp)?.id).toBe("b1");
    expect(getVisibleBaseline("p1", "other-fingerprint")).toBeUndefined();
    expect(getVisibleBaseline("p2", fp)).toBeUndefined();
  });

  it("expires dynamic holdout cache after its shorter freshness window", () => {
    clearRoundCaches();
    const at = Date.parse("2026-09-28T00:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    try {
      setHoldoutBaseline("live", { fingerprint: "fp", suiteIds: ["h1"], runs: [], evaluation: { accuracy: 80 } as never });
      clock.mockReturnValue(at + 10 * 60_000 - 1);
      expect(getHoldoutBaseline("live", "fp", 10 * 60_000)).toBeTruthy();
      clock.mockReturnValue(at + 10 * 60_000);
      expect(getHoldoutBaseline("live", "fp", 10 * 60_000)).toBeUndefined();
      clock.mockReturnValue(at - 1);
      expect(getHoldoutBaseline("live", "fp", 10 * 60_000)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });
  it("盲测对照：按项目 + 指纹存取；指纹变化自动失效", () => {
    clearRoundCaches();
    const fp = baselineFingerprint(project());
    setHoldoutBaseline("p1", { fingerprint: fp, suiteIds: ["h1"], runs: [], evaluation: { accuracy: 80 } as never });
    expect(getHoldoutBaseline("p1", fp)?.suiteIds).toEqual(["h1"]);
    expect(getHoldoutBaseline("p1", "changed")).toBeUndefined();
  });
});

it("does not invalidate measured inputs when displaying new scores", () => {
  const first = project({ metrics: [{ key: "quality", value: 50, target: 90, direction: "higher" }] } as Partial<EvolveProject>);
  const next = structuredClone(first);
  next.metrics[0].value = 80;
  expect(baselineFingerprint(next)).toBe(baselineFingerprint(first));
  next.metrics[0].target = 95;
  expect(baselineFingerprint(next)).not.toBe(baselineFingerprint(first));
});
