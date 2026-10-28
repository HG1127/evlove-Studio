import { describe, expect, it, vi } from "vitest";
import { CandidateSchema, EvolveProjectSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { finalHoldoutContractFingerprint, finalHoldoutPaperHash } from "@evolution/core";
import { experimentRecoveryAt, experimentRecoveryFixture } from "@evolution/testkit";
import { canReuseServerBaseline, runServerBaseline } from "./server-baseline";
import { serverBaselineFingerprint } from "./server-baseline-evidence";
import { plannedBaselineRefresh, samePlannedOriginalReferences } from "./server-planned-baseline";
import { advanceServerCampaignPreparation } from "./server-campaign-preparation";

const route = "unchanged-scoring-route", later = new Date(Date.parse(experimentRecoveryAt) + 11 * 60_000).toISOString();
const ids = ["CONTENT", "DETAIL", "CONSISTENCY"];
const rejectedRequest = () => Object.assign(Error("temporary request rejection"), { httpStatus: 429 });
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
  it.each(["draft", "queued"] as const)("remeasures an expired Original then continues the same %s Plan without another generation", async status => {
    const p = planned(), io = ports();
    p.candidates[0]!.status = status;
    const original = JSON.stringify(p);
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
    expect(JSON.stringify(p)).toBe(original);
  });

  it.each([
    ["changed source", (p: EvolveProject) => { p.sourceArtifacts[0]!.textContent += "changed"; }],
    ["missing paper", (p: EvolveProject) => { p.finalHoldout = undefined; }],
    ["changed paper", (p: EvolveProject) => { p.finalHoldout!.suite[0]!.input += "changed"; }],
    ["changed Candidate binding", (p: EvolveProject) => { p.candidates[0]!.finalHoldoutPaperHash = "other"; }],
    ["unapproved plan", (p: EvolveProject) => { p.gates.find(g => g.id === "experiment-ready")!.status = "pending"; }],
    ["repeated selection", (p: EvolveProject) => { p.selectedCandidateIds.push(p.selectedCandidateIds[0]!); }],
    ["already evaluated Candidate", (p: EvolveProject) => { p.candidates[0]!.status = "passed"; }],
    ["running Candidate", (p: EvolveProject) => { p.candidates[0]!.status = "running"; }],
    ["failed Candidate", (p: EvolveProject) => { p.candidates[0]!.status = "failed"; }],
    ["winning Candidate", (p: EvolveProject) => { p.candidates[0]!.status = "winner"; }],
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

  it("can explicitly retry a persisted transient refresh failure without creating another Plan", async () => {
    const p = EvolveProjectSchema.parse(planned()), io = ports();
    p.finalHoldout!.contractFingerprint = finalHoldoutContractFingerprint(p);
    p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
    p.campaign.startedAt = experimentRecoveryAt;
    p.campaign.stopCriteria.maxWallMinutes = 30;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(later));
    try {
      io.judge.mockRejectedValueOnce(rejectedRequest());
      const failed = await runServerBaseline(p, io, { now: () => later });
      expect(failed.ready).toBe(false);
      expect(failed.baseline.status).toBe("failed");
      expect(failed.baseline.plannedRefresh).toMatchObject({ status: "retryable", failureKind: "judge" });
      const persisted = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(failed.project)));
      const retryAt = new Date(Date.parse(later) + 60_000).toISOString(); clock.mockReturnValue(Date.parse(retryAt));
      const recovered = await runServerBaseline(persisted, io, { now: () => retryAt });
      expect(recovered.ready).toBe(true);
      expect(io.judge).toHaveBeenCalledTimes(2);
      expect(recovered.baseline.plannedRefresh).toBeUndefined();
      expect(recovered.project.stage).toBe("plan");
      expect(recovered.project.candidates).toEqual(p.candidates);
      expect(recovered.project.finalHoldout).toEqual(p.finalHoldout);
      expect(recovered.project.campaign.checkpoint).toEqual(p.campaign.checkpoint);
      expect(recovered.project.campaign.startedAt).toBe(p.campaign.startedAt);
      expect(recovered.project.campaign.stopCriteria).toEqual(p.campaign.stopCriteria);
      expect(recovered.project.artifactAcceptance.attempts).toBe(p.artifactAcceptance.attempts);
    } finally { clock.mockRestore(); }
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
    expect(result.baseline.plannedRefresh).toMatchObject({ status: "retryable", failureKind: "original-binding", originalReferences: [old] });
  });

  it.each([
    ["unknown running attempt", (p: EvolveProject) => {
      p.baselineRun.plannedRefresh!.status = "refreshing";
      delete p.baselineRun.plannedRefresh!.failedAt; delete p.baselineRun.plannedRefresh!.failureKind;
    }],
    ["orphaned receipt", (p: EvolveProject) => { p.campaign.checkpoint = undefined; }],
    ["changed plan fingerprint", (p: EvolveProject) => { p.baselineRun.plannedRefresh!.planFingerprint = "changed"; }],
    ["failure timestamp still in the future", (p: EvolveProject) => { p.baselineRun.plannedRefresh!.failedAt = new Date(Date.parse(later) + 60_000).toISOString(); }],
    ["changed Candidate contents", (p: EvolveProject) => { p.candidates[0]!.change += "different instructions"; }],
    ["extended budget", (p: EvolveProject) => { p.campaign.stopCriteria.maxWallMinutes = 60; }],
    ["changed checkpoint", (p: EvolveProject) => { p.campaign.checkpoint!.at = later; }],
    ["changed Original receipt", (p: EvolveProject) => {
      p.baselineRun.plannedRefresh!.originalReferences = [{ schemaVersion: "original-artifact-reference-v1", missionId: p.id,
        sourceArtifactId: "source", blobId: "original", sha256: "a".repeat(64), sizeBytes: 40 }];
    }],
  ] as const)("blocks recovery after %s before calling an external service", async (_label, change) => {
    const p = planned(), failedPorts = ports(); failedPorts.judge.mockRejectedValueOnce(rejectedRequest());
    const failed = await runServerBaseline(p, failedPorts, { now: () => later });
    expect(failed.baseline.plannedRefresh?.status).toBe("retryable");
    change(failed.project);
    const retryPorts = ports(), retry = await runServerBaseline(failed.project, retryPorts, { now: () => later });
    expect(retry.ready).toBe(false);
    expect(retryPorts.judge).not.toHaveBeenCalled();
    expect(retryPorts.executeExternalBatch).not.toHaveBeenCalled();
    expect(retry.project.candidates).toEqual(failed.project.candidates);
    expect(retry.project.finalHoldout).toEqual(failed.project.finalHoldout);
  });

  it("does not treat a pending continuation as reusable even when someone attaches positive scores", async () => {
    const p = planned(), io = ports(); io.judge.mockRejectedValueOnce(Error("temporary failure"));
    const failed = await runServerBaseline(p, io, { now: () => later });
    const pending = { ...failed.project, baselineRun: { ...p.baselineRun, completedAt: later, plannedRefresh: failed.baseline.plannedRefresh } };
    expect(canReuseServerBaseline(pending, route, Date.parse(later))).toBe(false);
  });

  it.each(["execution", "incomplete-review"] as const)("can retry a persisted %s gap without changing the Plan", async kind => {
    const p = EvolveProjectSchema.parse(planned()), io = ports();
    p.finalHoldout!.contractFingerprint = finalHoldoutContractFingerprint(p);
    p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
    if (kind === "execution") io.executeExternalBatch.mockRejectedValueOnce(rejectedRequest());
    else io.judge.mockResolvedValueOnce({ accuracy: 70, evidence: 80, riskCoverage: 80, completeness: 70, safety: "PASS", notes: [], failures: [], cases: [], criteria: [] });
    const failed = await runServerBaseline(p, io, { now: () => later });
    expect(failed.ready).toBe(false);
    expect(failed.baseline.plannedRefresh).toMatchObject({ status: "retryable", failureKind: "evidence" });
    expect(canReuseServerBaseline(failed.project, route, Date.parse(later) + 1)).toBe(false);
    const persisted = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(failed.project)));
    const retry = await runServerBaseline(persisted, io, { now: () => new Date(Date.parse(later) + 60_000).toISOString() });
    expect(retry.ready).toBe(true);
    expect(retry.project.candidates).toEqual(p.candidates);
    expect(retry.project.campaign.checkpoint).toEqual(p.campaign.checkpoint);
    expect(retry.project.finalHoldout).toEqual(p.finalHoldout);
    expect(retry.baseline.plannedRefresh).toBeUndefined();
  });

  it("does not restart the original clock when a persisted refresh is retried", async () => {
    const p = planned(), io = ports(); p.campaign.startedAt = experimentRecoveryAt; p.campaign.stopCriteria.maxWallMinutes = 30;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(later));
    try {
      io.judge.mockRejectedValueOnce(rejectedRequest());
      const failed = await runServerBaseline(p, io, { now: () => later });
      expect(plannedBaselineRefresh(failed.project, route, later)?.checkpoint).toEqual(p.campaign.checkpoint);
      const expired = new Date(Date.parse(experimentRecoveryAt) + 31 * 60_000).toISOString(); clock.mockReturnValue(Date.parse(expired));
      const retryPorts = ports(), retry = await runServerBaseline(failed.project, retryPorts, { now: () => expired });
      expect(retry.ready).toBe(false);
      expect(retryPorts.executeExternalBatch).not.toHaveBeenCalled();
      expect(retry.project.campaign.startedAt).toBe(experimentRecoveryAt);
    } finally { clock.mockRestore(); }
  });

  it.each(["judge-timeout", "runner-network-error", "semantic-timeout", "native-timeout"] as const)("keeps %s unsettled and does not repeat it", async kind => {
    const p = planned(), io = { ...ports(), executeNativeHtmlBatch: vi.fn(async () => []) };
    if (kind === "judge-timeout") io.judge.mockRejectedValueOnce(Object.assign(Error("timeout"), { code: "SERVER_AI_PROVIDER_TIMEOUT" }));
    else if (kind === "runner-network-error") io.executeExternalBatch.mockRejectedValueOnce(Object.assign(Error("network"), { code: "SERVER_AI_PROVIDER_NETWORK_ERROR" }));
    else if (kind === "native-timeout") {
      p.evalSuite[0]!.tags = ["source-grounded-html-assertions"];
      p.acceptanceRubric.forEach(criterion => { criterion.validationMethod = "semantic-judge"; });
      p.finalHoldout!.contractFingerprint = finalHoldoutContractFingerprint(p);
      p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
      io.executeNativeHtmlBatch.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    } else {
      p.evalSuite[0]!.executionMode = "artifact-runtime";
      p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
      io.executeSemanticBatch.mockRejectedValueOnce(Object.assign(Error("timeout"), { code: "SERVER_AI_PROVIDER_TIMEOUT" }));
    }
    const failed = await runServerBaseline(p, io, { now: () => later });
    expect(failed.ready).toBe(false);
    expect(failed.baseline.plannedRefresh?.status).toBe("unsettled");
    if (kind !== "judge-timeout") expect(io.judge).not.toHaveBeenCalled();
    if (kind === "native-timeout") {
      expect(io.executeExternalBatch).not.toHaveBeenCalled();
      expect(io.executeSemanticBatch).not.toHaveBeenCalled();
    }
    const retryPorts = ports(), retry = await runServerBaseline(failed.project, retryPorts, { now: () => later });
    expect(retry.ready).toBe(false);
    expect(retryPorts.judge).not.toHaveBeenCalled();
    expect(retryPorts.executeExternalBatch).not.toHaveBeenCalled();
    expect(retryPorts.executeSemanticBatch).not.toHaveBeenCalled();
  });

  it("recovers the original physical binding from its receipt after the failed measurement lost current references", async () => {
    let p = planned(); p.sourceArtifacts[0]!.storageRef = "original"; p.evalSuite[0]!.executionMode = "artifact-runtime";
    p.acceptanceRubric.forEach(criterion => { criterion.validationMethod = "semantic-judge"; });
    p = EvolveProjectSchema.parse(p);
    const original = { schemaVersion: "original-artifact-reference-v1" as const, missionId: p.id, sourceArtifactId: "source", blobId: "original", sha256: "a".repeat(64), sizeBytes: p.sourceArtifacts[0]!.size };
    p.baselineRun.originalReferences = [original]; p.finalHoldout!.contractFingerprint = finalHoldoutContractFingerprint(p);
    p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
    const io = { ...ports(), buildCurrentArtifactContext: async () => [{ id: "source", artifactSha256: original.sha256, originalReference: original,
      content: "Complete synthetic Original text", originalChars: 32, projectionChars: 32, truncated: false,
      contextRepresentation: "complete-html-static-text-projection", excludes: ["scripts", "styles", "visual-fidelity", "runtime-behavior"] }] };
    io.judge.mockRejectedValueOnce(rejectedRequest());
    const failed = await runServerBaseline(p, io, { now: () => later });
    expect(failed.baseline.originalReferences).toBeUndefined();
    expect(failed.baseline.plannedRefresh?.originalReferences).toEqual([original]);
    const persisted = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(failed.project)));
    const retryAt = new Date(Date.parse(later) + 60_000).toISOString();
    const retry = await runServerBaseline(persisted, io, { now: () => retryAt });
    expect(retry.ready).toBe(true);
    expect(retry.baseline.originalReferences).toEqual([original]);
    expect(retry.baseline.plannedRefresh).toBeUndefined();
    expect(retry.project.candidates).toEqual(p.candidates);
    expect(retry.project.finalHoldout).toEqual(p.finalHoldout);
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
