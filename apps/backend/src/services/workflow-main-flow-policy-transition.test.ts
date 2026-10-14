// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolutionJobSchema, missionEnvelope, type EvolveProject, type EvolutionEvent } from "@evolution/contracts";
import { baselinePolicyTransitionFixture, experimentRecoveryAt as at } from "@evolution/testkit";
import { SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION as legacy, serverMainFlowContextFingerprint } from "@evolution/harness";
import { serverMainFlowRecoveryDigest } from "./server-main-flow-recovery";
import { planMissionStep, executeServerControlStep } from "../../../../workflows/evolution-mission/steps";
const m = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), envelope: vi.fn(), job: vi.fn(), put: vi.fn(), append: vi.fn(),
  readEvent: vi.fn(), requireAi: vi.fn(), ai: vi.fn(), route: vi.fn(), baseline: vi.fn(), unavailable: class extends Error {} }));
vi.mock("./production-runtime", () => ({ getServerProductionRuntime: () => ({
  missions: { get: m.get, save: m.save }, jobs: { get: m.job, put: m.put }, events: { append: m.append },
}), getServerMissionEnvelope: m.envelope, getServerEventById: m.readEvent }));
vi.mock("./server-control-ai", () => ({ requireServerControlAi: m.requireAi, runServerControlAi: m.ai, ServerControlAiUnavailableError: m.unavailable }));
vi.mock("./ai-gateway", async original => ({ ...await original<typeof import("./ai-gateway")>(), serverAiScoringRouteFingerprint: m.route }));
vi.mock("./server-baseline", () => ({ runServerMissionBaseline: m.baseline }));
vi.mock("../server-env", async original => ({ ...await original<typeof import("../server-env")>(), serverAiConfigured: () => true, getServerAiConfig:()=>({mode:"openai-compatible",apiKey:"synthetic-never-used",model:"synthetic-policy-model",baseUrl:"https://synthetic.invalid/v1",timeoutMs:1000}) }));
const input = { missionId: "mission", controlJobId: "new-control", requestedAt: at, controlOwnerKey: "workflow-control:mission:normal-recovery" };
const job = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: input.controlJobId, missionId: input.missionId, type: "campaign", status: "running",
  label: "New normal control", idempotencyKey: input.controlOwnerKey, generation: 1, metadata: { runId: "new-run" }, outputRef: "new-run", createdAt: at, updatedAt: at });
let persisted: EvolveProject, events: Map<string, EvolutionEvent>, order: string[], failAudit: boolean;
function paused() {
  const p = baselinePolicyTransitionFixture(), reason = p.campaign.stopReason!;
  p.campaign.serverRecoveryWait = { schemaVersion: "server-campaign-recovery-v1", controlJobId: "prior-control", missionId: p.id,
    status: "waiting", stage: p.stage, round: 1, marker: "baseline-judge-pending", reason,
    contextFingerprint: serverMainFlowContextFingerprint(p, legacy), inputFingerprint: serverMainFlowRecoveryDigest(p, legacy) };
  p.campaign.serverControlOwner = { schemaVersion: "server-workflow-control-owner-v1", controlJobId: input.controlJobId,
    operationKey: input.controlOwnerKey, sourceUpdatedAt: p.updatedAt, inputFingerprint: serverMainFlowRecoveryDigest(p), requestedAt: at,
    phase: "bound", runId: "new-run" };
  return p;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  persisted = paused(); events = new Map(); order = []; failAudit = false;
  m.get.mockImplementation(async () => structuredClone(persisted)); m.envelope.mockImplementation(async () => missionEnvelope(persisted, 43));
  m.job.mockResolvedValue(job); m.requireAi.mockResolvedValue(undefined); m.route.mockResolvedValue("new-current-route");
  m.save.mockImplementation(async (next: EvolveProject) => { order.push("save"); persisted = structuredClone(next); });
  m.readEvent.mockImplementation(async (id: string) => events.get(id));
  m.append.mockImplementation(async (event: EvolutionEvent) => {
    if (event.payload.action === "baseline-policy-transition") {
      order.push("policy-transition"); if (failAudit) throw new Error("audit unavailable");
    }
    const prior = events.get(event.id); if (prior) expect(event).toEqual(prior);
    events.set(event.id, structuredClone(event));
  });
});
afterEach(() => vi.useRealTimers());
describe("normal durable control legacy Baseline transition composition", () => {
  it("commits the fixed policy audit before saving recovery, without changing prior rows", async () => {
    const before = structuredClone(persisted); const plan = await planMissionStep(input, 0);
    expect(order.slice(0, 2)).toEqual(["policy-transition", "save"]);
    expect(plan.decision.action).toBe("run-campaign");
    const audit = events.get("evt-new-control-baseline-policy-transition-v1")!;
    expect(audit.at).toBe(input.requestedAt); expect(audit.payload.priorBaselineRun).toEqual(before.baselineRun);
    expect(audit.payload.priorCheckpoint).toEqual(before.campaign.checkpoint);
    expect(persisted.baselineRun).toEqual(before.baselineRun); expect(persisted.candidates).toEqual(before.candidates);
    expect(persisted.campaign.serverRecoveryWait?.resumedByControlJobId).toBe(input.controlJobId);
    expect(m.put).not.toHaveBeenCalled(); expect(m.baseline).not.toHaveBeenCalled();
  });
  it("does not save or launch execution if the required audit cannot persist", async () => {
    const before = structuredClone(persisted); failAudit = true;
    await expect(planMissionStep(input, 0)).rejects.toThrow("audit unavailable");
    expect(persisted).toEqual(before); expect(m.save).not.toHaveBeenCalled(); expect(m.baseline).not.toHaveBeenCalled();
    expect(m.put).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "completed", "partial", "failed", "missing", "generation", "operation", "run"])("does not save recovery when control %s changes during the durable audit", async kind => {
    const before = structuredClone(persisted);
    m.append.mockImplementationOnce(async (event: EvolutionEvent) => {
      expect(event.payload.action).toBe("baseline-policy-transition");
      events.set(event.id, structuredClone(event));
      if (kind === "missing") m.job.mockResolvedValue(undefined);
      else if (kind === "generation") m.job.mockResolvedValue({ ...job, generation: 2 });
      else if (kind === "operation") m.job.mockResolvedValue({ ...job, idempotencyKey: "other-operation" });
      else if (kind === "run") m.job.mockResolvedValue({ ...job, metadata: { runId: "other-run" }, outputRef: "other-run" });
      else m.job.mockResolvedValue({ ...job, status: kind });
    });
    await expect(planMissionStep(input, 0)).rejects.toThrow("控制 Job");
    expect(events.get("evt-new-control-baseline-policy-transition-v1")?.payload.priorBaselineRun).toEqual(before.baselineRun);
    expect(persisted).toEqual(before); expect(m.save).not.toHaveBeenCalled();
    expect(m.baseline).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
  });
  it("re-enters the normal Baseline runner under current policy rather than accepting old observations", async () => {
    const plan = await planMissionStep(input, 0), oldId = persisted.baselineRun.id;
    m.baseline.mockImplementation(async (p: EvolveProject) => {
      const baseline = { ...p.baselineRun, id: "new-current-policy-baseline", status: "failed" as const, result: undefined,
        runs: [{ testCaseId: p.evalSuite[0]!.id, output: "synthetic newly executed row", latencyMs: 1, cost: 0, verificationStatus: "verified" as const, trace: [] }] };
      const reason = "[server-campaign-baseline-judge-pending] synthetic current Judge unavailable";
      return { project: { ...p, baselineRun: baseline, campaign: { ...p.campaign, status: "paused", stopReason: reason } }, baseline,
        ready: false, reason, capabilityGaps: ["server-judge"] };
    });
    const outcome = await executeServerControlStep(input, plan, 0);
    expect(m.baseline).toHaveBeenCalledOnce(); expect(outcome).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(persisted.baselineRun.id).not.toBe(oldId); expect(persisted.baselineRun.result).toBeUndefined();
    expect(persisted.baselineRun.runs).toHaveLength(1);
    expect(persisted.campaign.serverRecoveryWait?.contextFingerprint).toBe(serverMainFlowContextFingerprint(persisted));
    expect(events.get("evt-new-control-baseline-policy-transition-v1")?.payload.priorRunsReusedAsNewPolicyEvidence).toBe(false);
  });
});
