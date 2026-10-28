import { describe, expect, it, vi } from "vitest";
import { CandidateSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { finalHoldoutContractFingerprint, finalHoldoutPaperHash } from "@evolution/core";
import { experimentRecoveryAt, experimentRecoveryFixture } from "@evolution/testkit";
import { canReuseServerBaseline, runServerBaseline } from "./server-baseline";
import { serverBaselineFingerprint } from "./server-baseline-evidence";
import { plannedBaselineRefresh, samePlannedOriginalReferences } from "./server-planned-baseline";
import { advanceServerCampaignPreparation } from "./server-campaign-preparation";

const route = "unchanged-scoring-route", later = new Date(Date.parse(experimentRecoveryAt) + 11 * 60_000).toISOString();
const ids = ["CONTENT", "DETAIL", "CONSISTENCY"];
function planned() {
  const p = experimentRecoveryFixture().project;
  p.acceptanceRubric = ids.map((id, index) => ({ ...p.acceptanceRubric[0]!, id, title: id, weight: index === 0 ? 34 : 33 }));
  p.evalSuite[0]!.criterionIds = ids;
  p.baselineRun.result!.criterionScores = ids.map(id => ({ ...p.baselineRun.result!.criterionScores![0]!, criterionId: id }));
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: experimentRecoveryAt });
  p.hiddenEvalSuite = [{ ...p.evalSuite[0]!, id: "H1", hidden: true }];
  const suite = [
    TestCaseSchema.parse({ id: "F1", title: "Recover interruption", input: "Explain recovery after an interrupted installation without losing the user's saved settings.", expected: ["safe recovery"], criterionIds: ids, hidden: true }),
    TestCaseSchema.parse({ id: "F2", title: "Verify an alternative setup", input: "Demonstrate the independent verification steps for an alternative supported configuration.", expected: ["verification"], criterionIds: ids, hidden: true }),
  ];
  p.finalHoldout = { round: 1, suite, paperHash: finalHoldoutPaperHash(suite), contractFingerprint: finalHoldoutContractFingerprint(p), createdAt: experimentRecoveryAt };
  p.candidates = [CandidateSchema.parse({ ...p.candidates[0]!, status: "queued", finalHoldoutPaperHash: p.finalHoldout.paperHash })];
  p.selectedCandidateIds = [p.candidates[0]!.id];
  p.baselineRun.completedAt = experimentRecoveryAt;
  p.campaign.scoringRouteFingerprint = route;
  p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
  return p;
}
function ports() {
  return {
    scoringRouteFingerprint: route,
    executeSemanticBatch: vi.fn(async () => ({ results: [] })),
    executeExternalBatch: vi.fn(async () => [{ testCaseId: "V1", output: "Fresh measured Original content", verificationStatus: "verified" as const, latencyMs: 1, cost: 0, trace: [] }]),
    judge: vi.fn(async () => ({ accuracy: 70, evidence: 80, riskCoverage: 80, completeness: 70, safety: "PASS" as const, notes: [], failures: [],
      cases: [{ testCaseId: "V1", accuracy: 70, evidence: 80, completeness: 70, reason: "fresh Original" }],
      criteria: ids.map(criterionId => ({ criterionId, score: 70, pass: false, evidence: ["fresh Original"], gaps: ["needs improvement"], testCaseIds: ["V1"] })) })),
  };
}

describe("Baseline refresh after committed planning", () => {
  it("remeasures an expired Original then continues the exact same Plan without another generation", async () => {
    const p = planned(), io = ports(), before = JSON.stringify(p);
    expect(canReuseServerBaseline(p, route, Date.parse(later))).toBe(false);
    const refreshed = await runServerBaseline(p, io, { now: () => later });
    expect(refreshed.ready).toBe(true);
    expect(io.executeExternalBatch).toHaveBeenCalledOnce();
    expect(io.judge).toHaveBeenCalledOnce();
    expect(refreshed.baseline.completedAt).toBe(later);
    expect(refreshed.baseline.result?.criterionScores?.[0]?.score).toBe(70);
    expect(refreshed.project.campaign.checkpoint).toEqual(p.campaign.checkpoint);
    expect(refreshed.project.stage).toBe("plan");
    expect(refreshed.project.candidates).toEqual(p.candidates);
    expect(refreshed.project.finalHoldout).toEqual(p.finalHoldout);
    expect(canReuseServerBaseline(refreshed.project, route, Date.parse(later) + 1)).toBe(true);
    const generation = vi.fn(async () => { throw Error("No additional planning is authorized"); });
    const next = await advanceServerCampaignPreparation(refreshed.project, { problemAnalysis: generation, diagnose: generation, plan: generation });
    expect(next.phase).toBe("experiment");
    expect(generation).not.toHaveBeenCalled();
    expect(JSON.stringify(p)).toBe(before);
  });

  it.each([
    ["changed source", (p: EvolveProject) => { p.sourceArtifacts[0]!.textContent += "changed"; }],
    ["missing paper", (p: EvolveProject) => { p.finalHoldout = undefined; }],
    ["changed paper", (p: EvolveProject) => { p.finalHoldout!.suite[0]!.input += "changed"; }],
    ["changed Candidate binding", (p: EvolveProject) => { p.candidates[0]!.finalHoldoutPaperHash = "other"; }],
    ["unapproved plan", (p: EvolveProject) => { p.gates.find(g => g.id === "experiment-ready")!.status = "pending"; }],
    ["repeated selection", (p: EvolveProject) => { p.selectedCandidateIds.push(p.selectedCandidateIds[0]!); }],
    ["already evaluated Candidate", (p: EvolveProject) => { p.candidates[0]!.status = "passed"; }],
    ["missing selected Candidate", (p: EvolveProject) => { p.selectedCandidateIds = ["missing"]; }],
    ["unbound failure memory", (p: EvolveProject) => {
      p.failureObservationSources = [{ schemaVersion: "visible-failure-source-v1", missionId: "prior", missionSha256: "a".repeat(64), experimentRunId: "prior-experiment", candidateId: "prior-candidate", round: 1 }];
      p.finalHoldout!.contractFingerprint = finalHoldoutContractFingerprint(p);
    }],
    ["spent final paper", (p: EvolveProject) => {
      p.validationRun.independentFinal = { candidateId: p.candidates[0]!.id, inputFingerprint: "prior-final", paperHash: p.finalHoldout!.paperHash,
        suite: p.finalHoldout!.suite, status: "completed", runs: [], baselineRuns: [] };
    }],
  ] as const)("stops %s before external work without discarding or replacing the Candidate", async (_label, change) => {
    const p = planned(), io = ports(); change(p);
    const result = await runServerBaseline(p, io, { now: () => later });
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("planned-baseline-refresh-pending");
    expect(io.executeExternalBatch).not.toHaveBeenCalled();
    expect(io.judge).not.toHaveBeenCalled();
    expect(result.project.candidates).toEqual(p.candidates);
    expect(result.project.campaign.checkpoint).toEqual(p.campaign.checkpoint);
  });

  it("stops a changed scoring route before remeasurement", async () => {
    const p = planned(), io = { ...ports(), scoringRouteFingerprint: "changed-route" };
    expect((await runServerBaseline(p, io)).ready).toBe(false);
    expect(io.judge).not.toHaveBeenCalled();
  });

  it("retains the planned Candidate when a fresh Judge fails", async () => {
    const p = planned(), io = ports(); io.judge.mockRejectedValueOnce(Error("provider unavailable"));
    const result = await runServerBaseline(p, io, { now: () => later });
    expect(result.ready).toBe(false);
    expect(result.project.candidates).toEqual(p.candidates);
    expect(result.project.finalHoldout).toEqual(p.finalHoldout);
    expect(result.project.campaign.checkpoint).toEqual(p.campaign.checkpoint);
  });

  it("records a changed physical Original but stops before the existing Plan can consume it", async () => {
    const p = planned(), base = ports();
    p.sourceArtifacts[0]!.storageRef = "original";
    p.evalSuite[0]!.executionMode = "artifact-runtime";
    p.acceptanceRubric.forEach(criterion => { criterion.validationMethod = "semantic-judge"; });
    p.finalHoldout!.contractFingerprint = finalHoldoutContractFingerprint(p);
    const old = { schemaVersion: "original-artifact-reference-v1" as const, missionId: p.id, sourceArtifactId: "source", blobId: "original", sha256: "a".repeat(64), sizeBytes: p.sourceArtifacts[0]!.size };
    p.baselineRun.originalReferences = [old];
    p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
    const changed = { ...old, sha256: "b".repeat(64) };
    const result = await runServerBaseline(p, { ...base, buildCurrentArtifactContext: async () => [{ id: "source", artifactSha256: changed.sha256, originalReference: changed,
      content: "Complete synthetic Original text", originalChars: 32, projectionChars: 32, truncated: false,
      contextRepresentation: "complete-html-static-text-projection", excludes: ["scripts", "styles", "visual-fidelity", "runtime-behavior"] }] }, { now: () => later });
    expect(base.judge).toHaveBeenCalledOnce();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("planned-original-changed");
    expect(result.baseline.originalReferences).toEqual([changed]);
    expect(result.project.candidates).toEqual(p.candidates);
    expect(result.project.finalHoldout).toEqual(p.finalHoldout);
    expect(result.project.campaign.checkpoint).toEqual(p.campaign.checkpoint);
  });

  it("recognizes only complete plans and compares physical Original references without order dependence", () => {
    expect(plannedBaselineRefresh(planned(), route)?.checkpoint?.completedPhase).toBe("plan");
    const p = planned(); p.campaign.checkpoint!.completedPhase = "diagnose";
    expect(plannedBaselineRefresh(p, route)).toBeUndefined();
    const ref = { schemaVersion: "original-artifact-reference-v1" as const, missionId: "m", sourceArtifactId: "s", blobId: "b", sha256: "a".repeat(64), sizeBytes: 42 };
    const other = { ...ref, sourceArtifactId: "s2" };
    expect(samePlannedOriginalReferences([ref, other], [other, ref])).toBe(true);
    expect(samePlannedOriginalReferences([ref], [{ ...ref, sha256: "b".repeat(64) }])).toBe(false);
    expect(samePlannedOriginalReferences([ref], [ref, ref])).toBe(false);
    expect(samePlannedOriginalReferences([ref], undefined)).toBe(false);
  });
});
