// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimentRecoveryAt as at, experimentRecoveryWaitFixture } from "@evolution/testkit";
import { canRetryStoredServerExperiment, retryStoredServerExperiment } from "./server-experiment-retry";
const m = vi.hoisted(() => ({ mode: vi.fn(), fetch: vi.fn() }));
vi.mock("./production-runtime", () => ({ productionRuntimeMode: m.mode }));
const receipt = { missionId: "mission", controlJobId: "control", runId: "run", status: "queued" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  m.mode.mockReset().mockReturnValue("http");
  m.fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify(receipt), { status: 200 }));
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("explicit stored server Experiment retry", () => {
  it.each([false, true])("sends only Mission identity and a stable SHA key for stored recovery (%s)", async readback => {
    const p = experimentRecoveryWaitFixture();
    if (readback) {
      const reason = "[server-campaign-experiment-build-pending] frozen file unavailable";
      p.campaign.stopReason = reason; p.experimentRun.summary = reason;
      p.experimentRun.buildFailures = [{ candidateId: p.selectedCandidateIds[0]!, message: "frozen file unavailable" }];
    }
    expect(canRetryStoredServerExperiment(p)).toBe(true);
    expect(await retryStoredServerExperiment(p)).toEqual(receipt);
    await retryStoredServerExperiment(structuredClone(p));
    expect(m.fetch.mock.calls.map(c => c[0])).toEqual(["/api/evolution/start", "/api/evolution/start"]);
    const requests = m.fetch.mock.calls.map(c => JSON.parse(c[1].body));
    expect(requests[0]).toEqual(requests[1]);
    expect(Object.keys(requests[0]).sort()).toEqual(["idempotencyKey", "missionId"]);
    expect(requests[0].idempotencyKey).toMatch(/^experiment-judge-retry:[a-f0-9]{64}$/);
  });
  it("retains the same operation after an ambiguous lost response", async () => {
    const p = experimentRecoveryWaitFixture(); m.fetch.mockRejectedValueOnce(new Error("connection lost"));
    await expect(retryStoredServerExperiment(p)).rejects.toThrow("connection lost");
    await retryStoredServerExperiment(p);
    expect(m.fetch.mock.calls[0]![1].body).toBe(m.fetch.mock.calls[1]![1].body);
  });
  it("allows a new request only after the persisted Mission version changes", async () => {
    const p = experimentRecoveryWaitFixture(); await retryStoredServerExperiment(p);
    await retryStoredServerExperiment({ ...p, updatedAt: "2026-10-09T02:01:00.000Z" });
    expect(m.fetch.mock.calls[0]![1].body).not.toBe(m.fetch.mock.calls[1]![1].body);
  });
  it.each(["local", "unrelated", "approval", "goal", "clarification", "budget"])("does not start or fall back for %s state", async kind => {
    const p = experimentRecoveryWaitFixture();
    if (kind === "local") m.mode.mockReturnValue("local");
    if (kind === "unrelated") p.campaign.stopReason = "用户暂停";
    if (kind === "approval") p.attentionRequests = [{ id: "approve", type: "authorization", status: "pending", blocking: true, reason: "approve first", stage: "experiment", title: "Approval", riskLevel: "high", questions: [], criterionIds: [], createdAt: at }];
    if (kind === "goal") p.goal = "";
    if (kind === "clarification") p.inputUnderstanding!.clarifications = [{ question: "scope?", whyItMatters: "changes result", defaultAnswer: "none" }];
    if (kind === "budget") p.campaign.stopCriteria.maxEstimatedCost = 0;
    expect(canRetryStoredServerExperiment(p)).toBe(false);
    await expect(retryStoredServerExperiment(p)).rejects.toThrow("当前不是可恢复");
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it("rejects a successful response for a different Mission", async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ ...receipt, missionId: "foreign" }), { status: 200 }));
    await expect(retryStoredServerExperiment(experimentRecoveryWaitFixture())).rejects.toThrow("identity mismatch");
  });
  it("retains a server rejection as a failure rather than reporting background acceptance", async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "Access required" }), { status: 401 }));
    await expect(retryStoredServerExperiment(experimentRecoveryWaitFixture())).rejects.toThrow("Access required");
  });
});
