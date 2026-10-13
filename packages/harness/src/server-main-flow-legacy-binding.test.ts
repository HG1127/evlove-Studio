// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputUnderstandingSchema } from "@evolution/contracts";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { HTML_PROTECTION_SETTLEMENT_POLICY } from "@evolution/core";
import { SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION as legacy, recoverServerMainFlowWait, serverMainFlowContextFingerprint,
  serverMainFlowRecoveryActive, serverMainFlowRecoveryBindingVersion, serverMainFlowRecoveryCheckpoint, serverMainFlowRecoveryWait } from "./server-main-flow-wait";
function paused() {
  const p = experimentRecoveryFixture().project;
  p.inputUnderstanding = InputUnderstandingSchema.parse({ status: "ready", confidence: .9 });
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: at });
  p.stage = "baseline"; p.baselineRun = { ...p.baselineRun, status: "failed", result: undefined };
  const reason = "[server-campaign-baseline-judge-pending] malformed synthetic Judge response";
  p.campaign = { ...p.campaign, status: "paused", stopReason: reason };
  p.campaign.serverRecoveryWait = { schemaVersion: "server-campaign-recovery-v1", controlJobId: "prior-control", missionId: p.id,
    status: "waiting", stage: p.stage, round: 1, marker: "baseline-judge-pending", reason,
    contextFingerprint: serverMainFlowContextFingerprint(p, legacy), inputFingerprint: "a".repeat(64) };
  return p;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); });
afterEach(() => vi.useRealTimers());
describe("exact legacy Baseline context recognition", () => {
  it("recognizes legacy identity without rewriting the stored receipt or promoting old rows", () => {
    const p = paused(), before = structuredClone(p);
    expect(serverMainFlowRecoveryBindingVersion(p)).toBe(legacy);
    expect(serverMainFlowRecoveryWait(p)).toBeDefined(); expect(p).toEqual(before);
    const recovered = recoverServerMainFlowWait(p, at, "new-control");
    expect(serverMainFlowRecoveryActive(recovered)).toBe(true);
    expect(serverMainFlowRecoveryCheckpoint(recovered)).toEqual(before.campaign.checkpoint);
    expect(recovered.baselineRun).toBe(p.baselineRun);
    expect(recovered.baselineRun.status).toBe("failed"); expect(recovered.baselineRun.result).toBeUndefined();
    expect(recovered.campaign.serverRecoveryWait?.contextFingerprint).toBe(before.campaign.serverRecoveryWait!.contextFingerprint);
  });
  it("preserves current-version recognition and newly written policy identity", () => {
    const p = paused(); p.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(p);
    expect(serverMainFlowRecoveryBindingVersion(p)).toBe(HTML_PROTECTION_SETTLEMENT_POLICY);
    expect(serverMainFlowRecoveryWait(p)).toBeDefined();
  });
  it.each(["source", "goal", "exam", "hidden", "target", "candidate", "parent", "baseline", "checkpoint", "profile", "metric", "rubric"])("rejects a changed %s generation", kind => {
    const p = paused();
    if (kind === "source") p.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "goal") p.goal += " changed";
    if (kind === "exam") p.evalSuite[0]!.input += " changed";
    if (kind === "hidden") p.hiddenEvalSuite[0]!.input += " changed";
    if (kind === "target") p.targetConnection.connectionId += " changed";
    if (kind === "candidate") p.candidates[0]!.change += " changed";
    if (kind === "parent") p.currentVersionId = "another-parent";
    if (kind === "baseline") p.baselineRun.runs[0]!.output += " changed";
    if (kind === "checkpoint") p.campaign.checkpoint!.at = "2026-10-10T00:00:00Z";
    if (kind === "profile") p.aiProfile = { mode: "project", primary: { connectionId: "other", model: "other", label: "other" } };
    if (kind === "metric") p.metrics.push({ key: "quality", label: "target", unit: "%", value: 50, target: 90, direction: "higher" });
    if (kind === "rubric") p.acceptanceRubric[0]!.requirement += " changed";
    expect(serverMainFlowRecoveryBindingVersion(p)).toBeUndefined(); expect(serverMainFlowRecoveryWait(p)).toBeUndefined();
  });
  it.each(["other-marker", "other-stage", "later-round", "completed-baseline"])("never downgrades %s to legacy policy", kind => {
    const p = paused();
    if (kind === "other-marker") p.campaign.serverRecoveryWait!.marker = "ai-pending";
    if (kind === "other-stage") { p.stage = "plan"; p.campaign.serverRecoveryWait!.stage = "plan"; }
    if (kind === "later-round") { p.campaign.currentRound = 1; p.campaign.serverRecoveryWait!.round = 2; }
    if (kind === "completed-baseline") p.baselineRun.status = "completed";
    p.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(p, legacy);
    expect(serverMainFlowRecoveryBindingVersion(p)).toBeUndefined(); expect(serverMainFlowRecoveryWait(p)).toBeUndefined();
  });
  it.each(["budget", "time", "safety", "protected-failure", "manual-failure", "patience", "attention", "goal", "gate", "marker", "round"])("retains the %s guard even with a matched legacy context", kind => {
    const p = paused();
    if (kind === "budget") p.campaign.stopCriteria.maxEstimatedCost = 0;
    if (kind === "time") { p.campaign.startedAt = "2026-10-08T00:00:00Z"; p.campaign.stopCriteria.maxWallMinutes = 1; }
    if (kind === "safety") { p.validationRun.evaluation = { ...experimentRecoveryFixture().project.baselineRun.result!, safety: "FAIL" }; p.campaign.stopCriteria.stopOnSafetyFailure = false; }
    if (kind === "protected-failure" || kind === "manual-failure") {
      p.validationRun.evaluation = structuredClone(experimentRecoveryFixture().project.baselineRun.result!);
      if (kind === "protected-failure") p.acceptanceRubric[0]!.protectedConstraint = true;
      else p.acceptanceRubric[0]!.validationMethod = "manual-review";
    }
    if (kind === "patience") p.campaign.noImprovementRounds = p.campaign.stopCriteria.patienceRounds;
    if (kind === "attention") p.attentionRequests = [{ id: "approval", type: "authorization", status: "pending", blocking: true, reason: "approval", title: "Approve", stage: p.stage, riskLevel: "high", questions: [], criterionIds: [], createdAt: at }];
    if (kind === "goal") p.goal = "";
    if (kind === "gate") p.gates.find(g => g.id === "target-ready")!.status = "ready";
    if (kind === "marker") p.campaign.stopReason = "User pause";
    if (kind === "round") p.campaign.checkpoint!.round = 2;
    p.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(p, legacy);
    expect(serverMainFlowRecoveryWait(p)).toBeUndefined();
  });
});
