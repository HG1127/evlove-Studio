// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaselineRun, EvolutionEvent } from "@evolution/contracts";
import { baselinePolicyTransitionFixture, experimentRecoveryAt as at } from "@evolution/testkit";
import { HTML_PROTECTION_SETTLEMENT_POLICY } from "@evolution/core";
import { SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION as legacy, canReuseServerBaseline, runServerBaseline,
  serverMainFlowContextFingerprint, serverMainFlowRecoveryActive, serverMainFlowRecoveryWire, type ServerBaselinePorts } from "@evolution/harness";
import { hasServerMainFlowRecoveryBinding, restoreServerMainFlowWait, restoreServerMainFlowWaitWithPolicyAudit,
  serverMainFlowRecoveryDigest } from "./server-main-flow-recovery";
function paused() {
  const p = baselinePolicyTransitionFixture(), reason = p.campaign.stopReason!;
  p.campaign.serverRecoveryWait = { schemaVersion: "server-campaign-recovery-v1", controlJobId: "prior-control", missionId: p.id,
    status: "waiting", stage: p.stage, round: 1, marker: "baseline-judge-pending", reason,
    contextFingerprint: serverMainFlowContextFingerprint(p, legacy), inputFingerprint: serverMainFlowRecoveryDigest(p, legacy) };
  return p;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); });
afterEach(() => vi.useRealTimers());
describe("strongly bound legacy Baseline policy transition", () => {
  it("requires both complete legacy hashes and refuses the sync unaudited path", () => {
    const p = paused(); expect(hasServerMainFlowRecoveryBinding(p)).toBe(true);
    expect(serverMainFlowRecoveryDigest(p)).not.toBe(p.campaign.serverRecoveryWait!.inputFingerprint);
    expect(restoreServerMainFlowWait(p, "new-control", at)).toBe(p);
  });
  it.each(["sha", "context", "current-context-legacy-sha"])("rejects a mismatched %s receipt without append", async kind => {
    const p = paused(), append = vi.fn();
    if (kind === "sha") p.campaign.serverRecoveryWait!.inputFingerprint = "f".repeat(64);
    if (kind === "context") p.campaign.serverRecoveryWait!.contextFingerprint = "unknown-version";
    if (kind === "current-context-legacy-sha") p.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(p);
    expect(hasServerMainFlowRecoveryBinding(p)).toBe(false);
    expect(await restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append })).toBe(p);
    expect(append).not.toHaveBeenCalled();
  });
  it.each(["source", "visible", "hidden", "candidate", "parent", "baseline", "target", "profile"])("rejects changed %s input rather than rebinding", async kind => {
    const p = paused(), append = vi.fn();
    if (kind === "source") p.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "visible") p.evalSuite[0]!.input += " changed";
    if (kind === "hidden") p.hiddenEvalSuite[0]!.input += " changed";
    if (kind === "candidate") p.candidates[0]!.artifactSnapshots[0]!.content += " changed";
    if (kind === "parent") p.currentVersionId = "other-parent";
    if (kind === "baseline") p.baselineRun.runs[0]!.output += " changed";
    if (kind === "target") p.targetConnection.connectionId += " changed";
    if (kind === "profile") p.aiProfile.mode = "project";
    expect(hasServerMainFlowRecoveryBinding(p)).toBe(false);
    expect(await restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append })).toBe(p);
    expect(append).not.toHaveBeenCalled();
  });
  it("rejects current budget exhaustion even when both legacy hashes still match", async () => {
    const p = paused(), append = vi.fn(); p.campaign.stopCriteria.maxEstimatedCost = 0;
    expect(hasServerMainFlowRecoveryBinding(p)).toBe(true);
    expect(await restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append })).toBe(p);
    expect(append).not.toHaveBeenCalled();
  });
  it("rechecks wall time after audit rather than crossing an expired boundary", async () => {
    const p = paused(); p.campaign.startedAt = at; p.campaign.stopCriteria.maxWallMinutes = 1;
    const append = vi.fn(async () => { vi.setSystemTime(new Date("2026-10-09T02:02:00.000Z")); });
    await expect(restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append })).rejects.toThrow("runtime boundary changed");
    expect(p.campaign.serverRecoveryWait!.status).toBe("waiting");
  });
  it("refuses a legacy transition without a durable audit port", async () => {
    const p = paused(), before = structuredClone(p);
    await expect(restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at)).rejects.toThrow("durable audit port");
    expect(p).toEqual(before);
  });
  it("does not return recovery when audit append fails", async () => {
    const p = paused(), before = structuredClone(p), append = vi.fn(async () => { throw new Error("audit unavailable"); });
    await expect(restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append })).rejects.toThrow("audit unavailable");
    expect(p).toEqual(before); expect(p.campaign.serverRecoveryWait!.status).toBe("waiting");
  });
  it("archives all old failed rows and binds one immutable policy transition event per new control", async () => {
    const p = paused(), before = structuredClone(p), events = new Map<string, EvolutionEvent>();
    const append = vi.fn(async (event: EvolutionEvent) => {
      const old = events.get(event.id); if (old) expect(event).toEqual(old);
      events.set(event.id, structuredClone(event));
    });
    const recovered = await restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append });
    await restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", "2026-10-09T02:01:00.000Z", { requestedAt: at, append });
    expect(events.size).toBe(1); const event = [...events.values()][0]!;
    expect(event).toMatchObject({ id: "evt-new-control-baseline-policy-transition-v1", at, jobId: "new-control", type: "ActionPlanned",
      payload: { action: "baseline-policy-transition", fromBindingVersion: legacy, toProtectionPolicy: HTML_PROTECTION_SETTLEMENT_POLICY,
        priorRunsReusedAsNewPolicyEvidence: false, requiredActions: ["execute-current-policy-baseline", "independent-current-policy-baseline-judge"] } });
    expect(event.payload.priorBaselineRun).toEqual(before.baselineRun); expect(event.payload.priorCheckpoint).toEqual(before.campaign.checkpoint);
    expect((event.payload.priorBaselineRun as BaselineRun).runs).toHaveLength(6);
    expect(recovered.baselineRun).toEqual(before.baselineRun); expect(recovered.candidates).toEqual(before.candidates);
    expect(serverMainFlowRecoveryActive(recovered)).toBe(true); expect(canReuseServerBaseline(recovered)).toBe(false);
    expect(p).toEqual(before);
  });
  it("freezes the generation across caller and append-payload mutation while awaiting audit", async () => {
    const p = paused(), before = structuredClone(p); let complete!: () => void;
    const append = vi.fn(async (event: EvolutionEvent) => {
      (event.payload.priorBaselineRun as BaselineRun).runs[0]!.output = "port mutation";
      await new Promise<void>(resolve => { complete = resolve; });
    });
    const pending = restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append });
    p.sourceArtifacts[0]!.textContent += " caller mutation";
    p.campaign.serverRecoveryWait!.controlJobId = "caller-control";
    complete(); const recovered = await pending;
    expect(recovered.sourceArtifacts).toEqual(before.sourceArtifacts); expect(recovered.baselineRun).toEqual(before.baselineRun);
    expect(recovered.campaign.serverRecoveryWait?.controlJobId).toBe("prior-control");
    expect(hasServerMainFlowRecoveryBinding(recovered)).toBe(true);
  });
  it("preserves the current version's sync and audit-free behavior", async () => {
    const p = paused(); p.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(p);
    p.campaign.serverRecoveryWait!.inputFingerprint = serverMainFlowRecoveryDigest(p);
    const recovered = await restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at);
    expect(recovered.campaign.serverRecoveryWait?.status).toBe("recovering"); expect(recovered.baselineRun).toBe(p.baselineRun);
  });
  it("re-executes applicable Baseline observations and independently judges new rows", async () => {
    const p = paused(), oldWire = serverMainFlowRecoveryWire(p, legacy);
    const recovered = await restoreServerMainFlowWaitWithPolicyAudit(p, "new-control", at, { requestedAt: at, append: async () => undefined });
    const execute = vi.fn<NonNullable<ServerBaselinePorts["executeExternalBatch"]>>(async ({ testCases }) => testCases.map(test => ({ testCaseId: test.id, output: "synthetic NEW observed content",
      latencyMs: 1, cost: 0, verificationStatus: "verified" as const, trace: [] })));
    const judge = vi.fn<ServerBaselinePorts["judge"]>(async payload => {
      expect(JSON.stringify(payload)).toContain("synthetic NEW observed content");
      expect(JSON.stringify(payload)).not.toContain("synthetic old observation");
      throw new Error("synthetic new Judge unavailable");
    });
    const outcome = await runServerBaseline(recovered, { executeSemanticBatch: async () => ({ results: [] }), executeExternalBatch: execute, judge },
      { now: () => "2026-10-09T02:05:00.000Z" });
    expect(execute).toHaveBeenCalledOnce(); expect(judge).toHaveBeenCalledOnce();
    expect(outcome.baseline.id).not.toBe(p.baselineRun.id); expect(outcome.baseline.status).toBe("failed");
    expect(outcome.baseline.result).toBeUndefined(); expect(outcome.reason).toContain("baseline-judge-pending");
    expect(outcome.baseline.runs.some(run => run.output.includes("synthetic old observation"))).toBe(false);
    expect(serverMainFlowRecoveryWire(p, legacy)).toBe(oldWire);
  });
});
