import { describe, expect, it } from "vitest";
import type { ArtifactAcceptance, Candidate, EvaluationResult, SearchChampion, TestCase, ValidationRun } from "@evolution/contracts";
import { updateSearchChampion } from "./search-champion-settlement";

const suite = [{ id: "H1", criterionIds: ["CONTENT"] }] as TestCase[];
const candidate = { id: "new", patches: [] } as unknown as Candidate;
const acceptance = { status: "passed", candidateId: "new", overallScore: 90, hardGatePass: true } as ArtifactAcceptance;
function evaluation(score: number): EvaluationResult {
  return {
    accuracy: score, evidence: score, riskCoverage: score, completeness: score,
    rubricScore: score, safety: "PASS", averageCost: 1, averageLatencyMs: 1,
    notes: [], failures: [], criterionScores: [{
      criterionId: "CONTENT", score, pass: true, verificationStatus: "verified",
      evidence: ["hidden"], gaps: [], testCaseIds: ["H1"],
    }],
  } as EvaluationResult;
}
function current(historicalScore: number): SearchChampion {
  return {
    id: "old", versionLabel: "S1", round: 1, score: historicalScore,
    evaluation: evaluation(historicalScore),
    artifactAcceptance: { ...acceptance, candidateId: "old" },
    patches: [],
  } as unknown as SearchChampion;
}
function validation(candidateScore: number, incumbentScore: number): ValidationRun {
  return {
    id: "v2", status: "completed", validationMode: "full", candidateId: "new",
    recommendation: "release", evaluation: evaluation(candidateScore),
    baselineEvaluation: evaluation(incumbentScore),
    baselineSuiteIds: ["H1"], baselineContextFingerprint: "round-2",
    baselineObservedAt: 123456,
    runs: [{ testCaseId: "H1", output: "ok", latencyMs: 1, cost: 1, trace: [], verificationStatus: "verified" }],
    baselineRuns: [{ testCaseId: "H1", output: "ok", latencyMs: 1, cost: 1, trace: [], verificationStatus: "verified" }],
    checks: [],
  } as ValidationRun;
}
function settle(champion: SearchChampion, run: ValidationRun, liveTarget = true) {
  return updateSearchChampion({
    current: champion, round: 2, winner: candidate, validation: run,
    artifactAcceptance: acceptance, baseline: evaluation(80),
    parentVersionId: "S1", minImprovement: 1,
    liveTarget, hiddenSuite: suite,
  });
}
describe("live Target Champion settlement", () => {
  it("promotes a candidate better than the same-round incumbent even when the old score was higher", () => {
    const result = settle(current(100), validation(80, 60));
    expect(result.comparisonPending).toBeUndefined();
    expect(result.changed).toBe(true);
    expect(result.improvement).toBeGreaterThan(0);
    expect(result.champion?.candidate?.id).toBe("new");
  });
  it("keeps the incumbent when a stale historical score would falsely promote the candidate", () => {
    const result = settle(current(10), validation(80, 90));
    expect(result.changed).toBe(false);
    expect(result.improvement).toBeLessThan(0);
    expect(result.champion?.id).toBe("old");
  });
  it("requires complete verified paired Hidden evidence before a live promotion", () => {
    const incomplete = validation(80, 60);
    incomplete.baselineRuns = [];
    const result = settle(current(10), incomplete);
    expect(result.comparisonPending).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.champion?.id).toBe("old");
  });
  it("preserves historical static Target score comparison", () => {
    const result = settle(current(100), validation(80, 60), false);
    expect(result.changed).toBe(false);
  });
});
