// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimentRecoveryAt as at, experimentRecoveryWaitFixture } from "@evolution/testkit";
import { recoverServerExperimentRecoveryWait, serverExperimentRecoveryWait, serverExperimentJudgeWait } from "./server-experiment-wait";
function readbackWait() {
  const p = experimentRecoveryWaitFixture(), reason = "[server-campaign-experiment-build-pending] frozen file unavailable";
  p.campaign.stopReason = reason; p.experimentRun.summary = reason;
  p.experimentRun.buildFailures = [{ candidateId: p.selectedCandidateIds[0]!, message: "frozen file unavailable" }];
  return p;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); });
afterEach(() => vi.useRealTimers());
describe("checkpoint-bound frozen Experiment recovery wait", () => {
  it("recognizes the retained readback pause through the public compatibility guard", () => {
    const p = readbackWait();
    expect(serverExperimentRecoveryWait(p)).toBe(p.campaign.stopReason);
    expect(serverExperimentJudgeWait(p)).toBe(p.campaign.stopReason);
    const restored = recoverServerExperimentRecoveryWait(p, "2026-10-09T02:01:00.000Z");
    expect(restored.campaign).toEqual({ ...p.campaign, status: "idle", stopReason: undefined });
    expect(restored.experimentRun).toBe(p.experimentRun); expect(restored.candidates).toBe(p.candidates);
  });
  it.each(["ordinary-builder", "no-execution", "unfrozen", "failed-builder", "missing-target", "duplicate-target", "missing-snapshot", "foreign-snapshot", "foreign-receipt", "mismatched-failure", "no-failure", "human-approval", "budget", "time-window", "goal", "round", "phase"])("rejects unsafe %s build pauses", kind => {
    const p = readbackWait(), c = p.candidates[0]!;
    if (kind === "ordinary-builder") p.experimentRun.executionCheckpoints = [];
    if (kind === "no-execution") p.experimentRun.executionCheckpoints![0]!.execution = undefined;
    if (kind === "unfrozen") c.artifactSnapshots[0]!.frozenArtifact = undefined;
    if (kind === "failed-builder") c.artifactBuildStatus = "failed";
    if (kind === "missing-target") p.sourceArtifacts = [];
    if (kind === "duplicate-target") p.sourceArtifacts.push({ ...p.sourceArtifacts[0]! });
    if (kind === "missing-snapshot") c.artifactSnapshots = [];
    if (kind === "foreign-snapshot") c.artifactSnapshots[0]!.sourceArtifactId = "foreign";
    if (kind === "foreign-receipt") c.artifactSnapshots[0]!.frozenArtifact!.sourceArtifactId = "foreign";
    if (kind === "mismatched-failure") p.experimentRun.buildFailures![0]!.candidateId = "foreign";
    if (kind === "no-failure") p.experimentRun.buildFailures = [];
    if (kind === "human-approval") p.attentionRequests = [{ id: "approve", type: "authorization", status: "pending", blocking: true, reason: "approval required", stage: "experiment", title: "Approval", riskLevel: "high", questions: [], criterionIds: [], createdAt: at }];
    if (kind === "budget") p.campaign.stopCriteria.maxEstimatedCost = 0;
    if (kind === "time-window") { p.campaign.stopCriteria.maxWallMinutes = 1; p.campaign.startedAt = "2026-10-08T00:00:00Z"; }
    if (kind === "goal") p.goal = "";
    if (kind === "round") p.campaign.checkpoint!.round = 7;
    if (kind === "phase") p.campaign.checkpoint!.completedPhase = "validation";
    expect(serverExperimentRecoveryWait(p)).toBeUndefined();
    expect(recoverServerExperimentRecoveryWait(p, at)).toBe(p);
  });
});
