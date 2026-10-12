// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolveProjectSchema, InputUnderstandingSchema } from "@evolution/contracts";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { canRemeasureLegacyServerPlan, remeasureLegacyServerPlan, recoverServerMainFlowWait,
  serverMainFlowContextFingerprint, serverMainFlowRecoveryCheckpoint, serverMainFlowRecoveryWait } from "./server-main-flow-wait";

function base() {
  const p = experimentRecoveryFixture().project;
  p.inputUnderstanding = InputUnderstandingSchema.parse({ status: "ready", confidence: .9 });
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: at });
  return p;
}
function builderWait() {
  const p = base(), reason = "[server-campaign-experiment-build-pending] Builder unavailable";
  p.stage = "experiment"; p.campaign.status = "paused"; p.campaign.stopReason = reason;
  p.experimentRun = { id: "experiment-r1-server", status: "failed", candidateResults: [], summary: reason,
    buildFailures: [{ candidateId: p.candidates[0]!.id, message: "Builder unavailable" }] };
  // Structural fixture only; backend tests exercise the actual SHA binding.
  p.campaign.serverRecoveryWait = { schemaVersion: "server-campaign-recovery-v1", controlJobId: "original",
    missionId: p.id, round: 1, stage: p.stage, marker: "experiment-build-pending", reason,
    inputFingerprint: "a".repeat(64), contextFingerprint: serverMainFlowContextFingerprint(p), status: "waiting" };
  return p;
}
function legacyPlan() {
  const p = base();
  p.stage = "plan"; p.candidates = []; p.selectedCandidateIds = [];
  p.campaign = { ...p.campaign, status: "paused", stopReason: "[server-campaign-plan-grounding-pending] no grounded proposal",
    checkpoint: { round: 1, completedPhase: "diagnose", at } };
  return p;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); });
afterEach(() => vi.useRealTimers());

describe("explicit main flow capability recovery", () => {
  it("recognizes an initial Builder pause without fabricated execution or frozen receipts", () => {
    const p = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(builderWait())));
    expect(serverMainFlowRecoveryWait(p)).toBeDefined();
    const recovered = recoverServerMainFlowWait(p, at, "new-control");
    expect(recovered.candidates).toBe(p.candidates);
    expect(recovered.baselineRun).toBe(p.baselineRun);
    expect(recovered.campaign.checkpoint).toBe(p.campaign.checkpoint);
    expect(recovered.campaign.serverRecoveryWait?.status).toBe("recovering");
    expect(recovered.campaign.serverRecoveryWait?.resumedByControlJobId).toBe("new-control");
    expect(recoverServerMainFlowWait(p, at, "original")).toBe(p);
    expect(recovered.campaign.estimatedCost).toBe(p.campaign.estimatedCost);
    expect(serverMainFlowRecoveryCheckpoint(recovered)).toBe(p.campaign.checkpoint);
  });
  it.each(["source", "goal", "exam", "hidden", "target", "protected", "editable", "metric", "parent", "candidate", "checkpoint", "mission", "digest"])( "rejects a changed %s generation", kind => {
    const p = builderWait();
    if (kind === "source") p.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "goal") p.goal += " changed";
    if (kind === "exam") p.evalSuite[0]!.input += " changed";
    if (kind === "hidden") p.hiddenEvalSuite[0]!.input += " changed";
    if (kind === "target") p.targetConnection.connectionId += " changed";
    if (kind === "protected") p.protectedItems.push("new protected contract");
    if (kind === "editable") p.editableItems.push("new editable contract");
    if (kind === "metric") p.metrics.push({ key: "accuracy", label: "target", value: 60, target: 99, unit: "%", direction: "higher" });
    if (kind === "parent") p.currentVersionId = "different-parent";
    if (kind === "candidate") p.candidates[0]!.change += " changed";
    if (kind === "checkpoint") p.campaign.checkpoint!.round = 2;
    if (kind === "mission") p.id = "foreign";
    if (kind === "digest") p.campaign.serverRecoveryWait!.inputFingerprint = "not-a-sha";
    expect(serverMainFlowRecoveryWait(p)).toBeUndefined();
    expect(recoverServerMainFlowWait(p, at, "new-control")).toBe(p);
  });
  it.each(["human-pause", "approval", "budget", "time", "safety", "safety-policy-off", "protected-failure", "manual-failure", "round-limit", "goal", "unapproved"])( "does not cross %s", kind => {
    const p = builderWait();
    if (kind === "human-pause") p.campaign.stopReason = "用户暂停";
    if (kind === "approval") p.attentionRequests = [{ id: "approve", type: "authorization", status: "pending", blocking: true,
      reason: "approval required", title: "Approve", stage: p.stage, riskLevel: "high", questions: [], criterionIds: [], createdAt: at }];
    if (kind === "budget") p.campaign.stopCriteria.maxEstimatedCost = 0;
    if (kind === "time") { p.campaign.startedAt = "2026-10-08T00:00:00Z"; p.campaign.stopCriteria.maxWallMinutes = 1; }
    if (kind === "safety" || kind === "safety-policy-off") p.validationRun.evaluation = { ...p.baselineRun.result!, safety: "FAIL" };
    if (kind === "safety-policy-off") p.campaign.stopCriteria.stopOnSafetyFailure = false;
    if (kind === "protected-failure" || kind === "manual-failure") {
      p.validationRun.evaluation = structuredClone(p.baselineRun.result!);
      if (kind === "protected-failure") p.acceptanceRubric[0]!.protectedConstraint = true;
      else p.acceptanceRubric[0]!.validationMethod = "manual-review";
    }
    if (kind === "round-limit") p.campaign.currentRound = p.campaign.stopCriteria.maxRounds;
    if (kind === "goal") p.goal = "";
    if (kind === "unapproved") p.gates.find(g => g.id === "target-ready")!.status = "ready";
    p.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(p);
    expect(serverMainFlowRecoveryWait(p)).toBeUndefined();
  });
  it("keeps missing protected or manual proof UNVERIFIED rather than treating it as verified FAIL", () => {
    for (const method of ["executable-test", "manual-review"] as const) {
      const p = builderWait(); p.acceptanceRubric[0]!.protectedConstraint = true; p.acceptanceRubric[0]!.validationMethod = method;
      p.artifactAcceptance.status = "unverified";
      p.artifactAcceptance.results = [{ criterionId: p.acceptanceRubric[0]!.id, score: 0, pass: false, evidence: [], gaps: ["proof missing"], note: "" }];
      p.validationRun.evaluation = { ...p.baselineRun.result!, criterionScores: [{ ...p.baselineRun.result!.criterionScores![0]!, verificationStatus: "unverified" }] };
      p.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(p);
      expect(serverMainFlowRecoveryWait(p)).toBeDefined();
    }
  });
  it("does not turn an unbound legacy Builder or downstream record into a resumable receipt", () => {
    const p = builderWait(); p.campaign.serverRecoveryWait = undefined;
    expect(serverMainFlowRecoveryWait(p)).toBeUndefined(); expect(canRemeasureLegacyServerPlan(p)).toBe(false);
  });
});

describe("explicit legacy Plan fresh measurement", () => {
  it("preserves Source, papers, history and budgets while invalidating all old active measurements", () => {
    const p = legacyPlan();
    expect(canRemeasureLegacyServerPlan(p)).toBe(true);
    const restarted = remeasureLegacyServerPlan(p, "new-control", at);
    expect(restarted.sourceArtifacts).toBe(p.sourceArtifacts);
    expect(restarted.evalSuite).toBe(p.evalSuite); expect(restarted.hiddenEvalSuite).toBe(p.hiddenEvalSuite);
    expect(restarted.roundHistory).toBe(p.roundHistory); expect(restarted.evolutionArchive).toBe(p.evolutionArchive);
    expect(restarted.campaign.estimatedCost).toBe(p.campaign.estimatedCost);
    expect(restarted.campaign.startedAt).toBe(p.campaign.startedAt);
    expect(restarted.baselineRun).toMatchObject({ status: "idle", runs: [] });
    expect(restarted.campaign.checkpoint).toBeUndefined();
    expect(restarted.campaign.freshBaselineRestartControlJobId).toBe("new-control");
    expect(restarted.gates.find(g => g.id === "target-ready")).toBe(p.gates.find(g => g.id === "target-ready"));
    expect(restarted.gates.find(g => g.id === "experiment-ready")?.status).toBe("pending");
  });
  it.each(["candidate", "champion", "validation", "accepted", "round", "approval", "budget", "human-pause", "unknown-error"])( "rejects %s legacy restarts", kind => {
    const p = legacyPlan();
    if (kind === "candidate") p.candidates = base().candidates;
    if (kind === "champion") p.searchChampion = { id: "parent", versionLabel: "S1", round: 1, score: 90, reason: "parent", patches: [], selectedAt: at };
    if (kind === "validation") p.validationRun.status = "completed";
    if (kind === "accepted") p.artifactAcceptance.status = "passed";
    if (kind === "round") p.campaign.currentRound = 1;
    if (kind === "approval") p.attentionRequests = [{ id: "approval", type: "authorization", status: "pending", blocking: true,
      reason: p.campaign.stopReason!, title: "Approve", stage: p.stage, riskLevel: "high", questions: [], criterionIds: [], createdAt: at }];
    if (kind === "budget") p.campaign.stopCriteria.maxEstimatedCost = 0;
    if (kind === "human-pause") p.campaign.stopReason = "用户暂停";
    if (kind === "unknown-error") p.campaign.stopReason = "model timeout";
    expect(canRemeasureLegacyServerPlan(p)).toBe(false);
    expect(remeasureLegacyServerPlan(p, "new-control", at)).toBe(p);
  });
});
