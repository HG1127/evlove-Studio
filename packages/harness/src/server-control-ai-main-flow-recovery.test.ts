// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionRequestSchema, InputUnderstandingSchema } from "@evolution/contracts";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { recoverServerMainFlowWait, serverMainFlowContextFingerprint, serverMainFlowRecoveryActive,
  serverMainFlowRecoveryWait } from "./server-main-flow-wait";

function controlAiWait() {
  const p = experimentRecoveryFixture().project;
  p.inputUnderstanding = InputUnderstandingSchema.parse({ status: "ready", confidence: .9 });
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: at });
  p.campaign.status = "paused";
  p.campaign.stopReason = "Server AI Provider unavailable";
  const request = AttentionRequestSchema.parse({ id: "server-ai-capability-server-checkpoint-owned", type: "capability",
    status: "pending", title: "Server AI", reason: p.campaign.stopReason, stage: p.stage, blocking: true,
    riskLevel: "medium", createdAt: at });
  p.attentionRequests = [request, { ...request, id: "server-ai-capability-server-checkpoint-history", status: "resolved",
    resolvedAt: "2026-10-08T00:00:00.000Z" }];
  p.campaign.serverRecoveryWait = { schemaVersion: "server-campaign-recovery-v1", controlJobId: "original",
    missionId: p.id, round: 1, stage: p.stage, marker: "control-ai", reason: p.campaign.stopReason,
    inputFingerprint: "a".repeat(64), contextFingerprint: serverMainFlowContextFingerprint(p), status: "waiting",
    controlAiAttentionRequestId: request.id };
  return p;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); });
afterEach(() => vi.useRealTimers());

describe("control AI recovery request identity", () => {
  it("recognizes the exact request after resolution despite matching resolved history", () => {
    const p = controlAiWait(), before = structuredClone(p);
    expect(serverMainFlowRecoveryWait(p)).toBeDefined();
    const recovered = recoverServerMainFlowWait(p, at, "new-control");
    expect(serverMainFlowRecoveryActive(recovered)).toBe(true);
    expect(recovered.attentionRequests?.[0]).toMatchObject({ id: p.campaign.serverRecoveryWait!.controlAiAttentionRequestId,
      status: "resolved", resolvedAt: at });
    expect(recovered.attentionRequests?.[1]).toEqual(before.attentionRequests![1]);
    expect(recovered.candidates).toBe(p.candidates);
    expect(recovered.campaign.checkpoint).toBe(p.campaign.checkpoint);
    expect(recovered.baselineRun).toBe(p.baselineRun);
    expect(p).toEqual(before);
    expect(recoverServerMainFlowWait(p, at, "original")).toBe(p);
  });

  it.each(["missing-id", "changed-id", "foreign-namespace", "duplicate-id", "history-pointer"])("rejects %s before recovery", kind => {
    const p = controlAiWait();
    if (kind === "missing-id") p.campaign.serverRecoveryWait!.controlAiAttentionRequestId = undefined;
    if (kind === "changed-id") p.attentionRequests![0]!.id += "-changed";
    if (kind === "history-pointer") p.campaign.serverRecoveryWait!.controlAiAttentionRequestId = p.attentionRequests![1]!.id;
    if (kind === "foreign-namespace") {
      p.attentionRequests![0]!.id = "manual-capability";
      p.campaign.serverRecoveryWait!.controlAiAttentionRequestId = "manual-capability";
    }
    if (kind === "duplicate-id") p.attentionRequests!.push({ ...p.attentionRequests![0]!, status: "resolved" });
    expect(serverMainFlowRecoveryWait(p)).toBeUndefined();
    expect(recoverServerMainFlowWait(p, at, "new-control")).toBe(p);
  });

  it.each(["missing-id", "changed-id", "foreign-namespace", "duplicate-id", "history-pointer", "unresolved", "missing-resolution-time",
    "changed-reason", "changed-stage", "approval", "safety", "input", "old-job"])("rejects %s after recovery", kind => {
    const p = recoverServerMainFlowWait(controlAiWait(), at, "new-control");
    if (kind === "missing-id") p.campaign.serverRecoveryWait!.controlAiAttentionRequestId = undefined;
    if (kind === "changed-id") p.attentionRequests![0]!.id += "-changed";
    if (kind === "history-pointer") p.campaign.serverRecoveryWait!.controlAiAttentionRequestId = p.attentionRequests![1]!.id;
    if (kind === "foreign-namespace") {
      p.attentionRequests![0]!.id = "manual-capability";
      p.campaign.serverRecoveryWait!.controlAiAttentionRequestId = "manual-capability";
    }
    if (kind === "duplicate-id") p.attentionRequests!.push({ ...p.attentionRequests![0]! });
    if (kind === "unresolved") p.attentionRequests![0]!.status = "pending";
    if (kind === "missing-resolution-time") p.attentionRequests![0]!.resolvedAt = undefined;
    if (kind === "changed-reason") p.attentionRequests![0]!.reason += " changed";
    if (kind === "changed-stage") p.attentionRequests![0]!.stage = "validation";
    if (kind === "approval") p.attentionRequests!.push({ ...p.attentionRequests![0]!, id: "approval", type: "authorization", status: "pending" });
    if (kind === "safety") p.validationRun.evaluation = { ...p.baselineRun.result!, safety: "FAIL" };
    if (kind === "input") p.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "old-job") p.campaign.serverRecoveryWait!.resumedByControlJobId = "original";
    expect(serverMainFlowRecoveryActive(p)).toBe(false);
  });
});
