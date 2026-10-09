import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcceptanceCriterion, Candidate, EvaluationResult, EvolveProject, TargetRunResult, TestCase } from "../schemas";

const mocks = vi.hoisted(() => ({ judge: vi.fn(), run: vi.fn() }));
vi.mock("../evaluation/service", async (importOriginal) => ({
  ...await importOriginal<typeof import("../evaluation/service")>(), evaluateRuns: mocks.judge,
}));
vi.mock("../target/registry", () => ({
  getTargetAdapter: () => ({ run: mocks.run }), getTargetStatus: () => ({ live: true, provider: "synthetic-test" }),
}));
import { demoProject } from "../data/mock-project";
import { AcceptanceCriterionSchema, CandidateSchema, TestCaseSchema } from "../schemas";
import { clearRoundCaches } from "./round-cache";
import { clearValidationReuseCache } from "./validation-reuse";
import { runValidation } from "./run-local";

type JudgeArgs = {
  testCases: TestCase[]; runs: TargetRunResult[]; forceRefresh?: boolean;
  context: { candidate?: Candidate; project: { acceptanceRubric: AcceptanceCriterion[] } };
};
function fixture(): { project: EvolveProject; candidate: Candidate } {
  const criterion = AcceptanceCriterionSchema.parse({ id: "SOP", title: "配置步骤", requirement: "配置有完成检查",
    source: "user-command", hardGate: true, validationMethod: "semantic-judge" });
  const testCase = TestCaseSchema.parse({ id: "H-SOP", title: "步骤检查", input: "检查当前 SOP", expected: ["完成检查"],
    criterionIds: [criterion.id], hidden: true });
  const source = { ...demoProject.sourceArtifacts[0]!, id: "sop", name: "guide.md", artifactKind: "document" as const,
    extension: "md", textContent: "旧版配置说明" };
  const candidate = CandidateSchema.parse({ id: "same", name: "当前新版", change: "补充检查", artifactSnapshots: [{
    id: "sop-current", sourceArtifactId: "sop", name: "guide.md", mimeType: "text/markdown",
    content: "填写配置后检查输出，异常时修正后重试。", createdAt: "2026-10-08T00:00:00Z",
  }] });
  const project: EvolveProject = { ...structuredClone(demoProject), id: "revalidation-proof", objectType: "document",
    evolutionCommand: "补充配置详情", sourceArtifacts: [source], acceptanceRubric: [criterion], hiddenEvalSuite: [testCase],
    candidates: [candidate], experimentRun: { ...demoProject.experimentRun, status: "completed", winnerId: candidate.id } };
  return { project, candidate };
}
function completeJudge(args: JudgeArgs): EvaluationResult {
  return { ...demoProject.baselineRun.result!, demoJudged: false, safety: "PASS", unverifiedCriterionIds: [],
    criterionScores: args.context.project.acceptanceRubric.map((criterion) => ({ criterionId: criterion.id,
      score: 100, pass: true, verificationStatus: "verified", evidence: ["synthetic complete observation"], gaps: [],
      testCaseIds: args.testCases.filter((item) => item.criterionIds.includes(criterion.id)).map((item) => item.id),
    })) };
}
const reviewCalls = () => mocks.judge.mock.calls.map(([args]) => args as JudgeArgs);
beforeEach(() => {
  mocks.judge.mockReset(); mocks.run.mockReset(); clearRoundCaches(); clearValidationReuseCache();
  mocks.run.mockImplementation(async ({ testCase }: { testCase: TestCase }) => ({ testCaseId: testCase.id,
    output: "当前文件观察", verificationStatus: "verified", latencyMs: 0, cost: 0, trace: [] }));
  mocks.judge.mockImplementation(completeJudge);
});

describe("explicit Hidden rejudging of the same immutable files", () => {
  it("refreshes both answer sheets, including a reusable stored baseline, without rerunning valid observations", async () => {
    const { project, candidate } = fixture();
    const snapshots = structuredClone(candidate.artifactSnapshots);
    const first = await runValidation(project, candidate, undefined, { skipFastGate: true, forceJudgeRefresh: true });
    const executed = mocks.run.mock.calls.length;
    const second = await runValidation({ ...project, validationRun: first }, candidate, undefined,
      { skipFastGate: true, forceJudgeRefresh: true });
    expect(reviewCalls().filter((args) => args.context.candidate)).toHaveLength(2);
    expect(reviewCalls().filter((args) => !args.context.candidate)).toHaveLength(2);
    expect(reviewCalls().every((args) => args.forceRefresh === true)).toBe(true);
    expect(mocks.run).toHaveBeenCalledTimes(executed);
    expect(second.baselineRuns).toEqual(first.baselineRuns);
    expect(second.runs).toEqual(first.runs);
    expect(candidate.artifactSnapshots).toEqual(snapshots);
  });

  it("refreshes a reusable session baseline and preserves both execution sheets", async () => {
    const { project, candidate } = fixture();
    const first = await runValidation(project, candidate, undefined, { skipFastGate: true });
    const second = await runValidation(project, candidate, undefined, { skipFastGate: true, forceJudgeRefresh: true });
    const freshReviews = reviewCalls().slice(2);
    expect(freshReviews).toHaveLength(2);
    expect(freshReviews.every((args) => args.forceRefresh === true)).toBe(true);
    expect(second.baselineRuns).toEqual(first.baselineRuns);
  });

  it("retains default baseline reuse when no fresh Judge was requested", async () => {
    const { project, candidate } = fixture();
    const first = await runValidation(project, candidate, undefined, { skipFastGate: true });
    await runValidation({ ...project, validationRun: first }, candidate, undefined, { skipFastGate: true });
    expect(reviewCalls().filter((args) => !args.context.candidate)).toHaveLength(1);
    expect(reviewCalls().every((args) => args.forceRefresh === undefined)).toBe(true);
  });

  it("preserves the explicit refresh instruction after the Candidate binding changes", async () => {
    const { project, candidate } = fixture();
    const first = await runValidation(project, candidate, undefined, { skipFastGate: true });
    const changed = { ...candidate, artifactSnapshots: candidate.artifactSnapshots.map((item) => ({ ...item, content: item.content + "新增检查。" })) };
    mocks.judge.mockClear();
    const next = await runValidation({ ...project, validationRun: first }, changed, undefined,
      { skipFastGate: true, retryFailedOnly: true, forceJudgeRefresh: true });
    expect(next.evidenceFingerprint).not.toBe(first.evidenceFingerprint);
    expect(reviewCalls().every((args) => args.forceRefresh === true)).toBe(true);
    expect(reviewCalls().some((args) => args.context.candidate?.artifactSnapshots[0]?.content.endsWith("新增检查。"))).toBe(true);
  });

  it("freshly judges both merged sheets in failed-only retry while preserving the oldest retained observation", async () => {
    const { project, candidate } = fixture();
    const at = Date.parse("2026-10-09T03:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    try {
      const first = await runValidation(project, candidate, undefined, { skipFastGate: true });
      const failed = { ...first,
        baselineRuns: first.baselineRuns.map((run, index) => index ? run : { ...run, error: "synthetic execution failure" }),
        runs: first.runs.map((run, index) => index ? run : { ...run, error: "synthetic execution failure" }),
      };
      clearValidationReuseCache(); mocks.judge.mockClear();
      clock.mockReturnValue(at + 1_000);
      const retry = await runValidation({ ...project, validationRun: failed }, candidate, undefined,
        { skipFastGate: true, retryFailedOnly: true, forceJudgeRefresh: true });
      expect(reviewCalls()).toHaveLength(2);
      expect(reviewCalls().every((args) => args.forceRefresh === true)).toBe(true);
      expect(retry.baselineRuns.slice(1)).toEqual(first.baselineRuns.slice(1));
      expect(retry.runs.slice(1)).toEqual(first.runs.slice(1));
      expect(retry.baselineObservedAt).toBe(first.baselineObservedAt);
      expect(retry.baselineRuns[0]?.error).toBeUndefined();
      expect(retry.runs[0]?.error).toBeUndefined();
    } finally { clock.mockRestore(); }
  });

  it("does not make reused live observations newer just by refreshing their judgement", async () => {
    const { project, candidate } = fixture();
    const live = { ...project, targetConnection: { ...project.targetConnection, adapter: "http" as const } };
    const at = Date.parse("2026-10-09T03:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    try {
      const first = await runValidation(live, candidate, undefined, { skipFastGate: true });
      clock.mockReturnValue(at + 5 * 60_000);
      const next = await runValidation({ ...live, validationRun: first }, candidate, undefined,
        { skipFastGate: true, forceJudgeRefresh: true });
      expect(next.baselineRuns).toEqual(first.baselineRuns);
      expect(next.baselineObservedAt).toBe(first.baselineObservedAt);
      clock.mockReturnValue(at + 10 * 60_000);
      const beforeFreshExecution = mocks.run.mock.calls.length;
      const fresh = await runValidation({ ...live, validationRun: next }, candidate, undefined,
        { skipFastGate: true, forceJudgeRefresh: true });
      const freshBaselineCalls = mocks.run.mock.calls.slice(beforeFreshExecution)
        .filter(([args]) => !args.variant);
      expect(freshBaselineCalls).toHaveLength(next.baselineRuns.length);
      expect(fresh.baselineObservedAt).toBe(at + 10 * 60_000);
    } finally { clock.mockRestore(); }
  });

  it("fails explicitly when the fresh Judge cannot run, preserving the prior verdict and frozen snapshots", async () => {
    const { project, candidate } = fixture();
    const first = await runValidation(project, candidate, undefined, { skipFastGate: true });
    const before = structuredClone({ first, candidate });
    mocks.judge.mockImplementation((args: JudgeArgs) => {
      if (args.forceRefresh) throw new Error("synthetic provider unavailable");
      return completeJudge(args);
    });
    await expect(runValidation({ ...project, validationRun: first }, candidate, undefined,
      { skipFastGate: true, forceJudgeRefresh: true })).rejects.toThrow("synthetic provider unavailable");
    expect({ first, candidate }).toEqual(before);
  });
});
