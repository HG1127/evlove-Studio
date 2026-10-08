// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvolutionJobSchema, type EvolveProject } from "@evolution/contracts";
import type { ServerHarnessPlan } from "@evolution/harness";
import { executeServerControlStep } from "../../../../workflows/evolution-mission/steps";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), jobGet: vi.fn(), put: vi.fn(), append: vi.fn(), probe: vi.fn(), ai: vi.fn() }));
vi.mock("./production-runtime", () => ({ getServerProductionRuntime: () => ({
  missions: { get: mocks.get, save: mocks.save }, jobs: { get: mocks.jobGet, put: mocks.put }, events: { append: mocks.append },
}) }));
vi.mock("./server-ai-health", () => ({ probeServerAiRuntime: mocks.probe }));
vi.mock("./ai-gateway", async (original) => ({ ...await original<typeof import("./ai-gateway")>(), runServerAi: mocks.ai }));
vi.mock("../server-env", async (original) => ({ ...await original<typeof import("../server-env")>(), serverAiConfigured: () => true }));

const at = "2026-10-08T00:00:00.000Z";
const input = { missionId: "mission", controlJobId: "control", requestedAt: at };
const plan: ServerHarnessPlan = { decision: { action: "understand", stage: "target", reason: "understand" }, checkpoint: { id: "checkpoint", stage: "target", round: 1 }, policy: { mode: "auto" }, sourceRevision: "revision" };
const job = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: "control", missionId: "mission", type: "campaign", status: "running", label: "control", idempotencyKey: "workflow-control:control", generation: 1, attempts: 1, priority: 70, createdAt: at, updatedAt: at });
const mission = {
  id: "mission", stage: "diagnosis", evolutionCommand: "improve", goal: "goal", sourceArtifacts: [], inputClarifications: [], attentionRequests: [],
  campaign: { status: "running", checkpoint: { round: 1, completedPhase: "diagnose", at }, currentRound: 0 },
  candidates: [{ id: "candidate", artifactSnapshots: [{ contentHash: "unchanged" }] }],
  baselineRun: { status: "completed", id: "original-baseline" }, validationRun: { status: "idle" }, updatedAt: at,
} as unknown as EvolveProject;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(structuredClone(mission));
  mocks.jobGet.mockResolvedValue(job);
  mocks.probe.mockResolvedValue({ ready: false, status: "unavailable", reasonCode: "customer-verification-required" });
});
describe("Durable Workflow AI capability wait", () => {
  it("persists a resumable wait with the actual current stage and unchanged evidence", async () => {
    const outcome = await executeServerControlStep(input, plan, 2);
    expect(outcome).toMatchObject({ control: "stop", result: { status: "waiting-human", iterations: 3, checkpointId: "checkpoint" } });
    const saved = mocks.save.mock.calls[0][0];
    expect(saved.stage).toBe("diagnosis");
    expect(saved.candidates).toEqual(mission.candidates);
    expect(saved.baselineRun).toEqual(mission.baselineRun);
    expect(saved.validationRun).toEqual(mission.validationRun);
    expect(saved.campaign).toMatchObject({ status: "paused", checkpoint: mission.campaign.checkpoint });
    expect(saved.attentionRequests[0]).toMatchObject({ type: "capability", status: "pending" });
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ status: "waiting", generation: 1, checkpointId: "checkpoint" }));
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ type: "AttentionRequired", checkpointId: "checkpoint" }));
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "completed", "failed", "partial"])("does not reopen a %s control Job", async (status) => {
    mocks.jobGet.mockResolvedValue({ ...job, status });
    expect(await executeServerControlStep(input, plan, 0)).toMatchObject({ control: "stop", result: { status: "blocked" } });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...job, generation: 2 }, { ...job, missionId: "another" }])("does not overwrite a missing or replaced control Job", async (current) => {
    mocks.jobGet.mockResolvedValue(current);
    expect(await executeServerControlStep(input, plan, 0)).toMatchObject({ result: { status: "blocked" } });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("does not misclassify a database 403 as an AI outage", async () => {
    const error = Object.assign(new Error("database denied"), { status: 403 });
    mocks.get.mockRejectedValue(error);
    await expect(executeServerControlStep(input, plan, 0)).rejects.toBe(error);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("persists capability waiting when availability changes after the healthy probe", async () => {
    mocks.probe.mockResolvedValue({ ready: true, status: "ready" });
    mocks.ai.mockRejectedValue(Object.assign(new Error("private provider response"), { status: 429 }));
    expect(await executeServerControlStep(input, plan, 0)).toMatchObject({ result: { status: "waiting-human" } });
    expect(mocks.save.mock.calls[0][0].campaign.status).toBe("paused");
    expect(JSON.stringify(mocks.save.mock.calls)).not.toContain("private provider response");
  });
  it("propagates ordinary AI failures without writing an artificial wait or result", async () => {
    mocks.probe.mockResolvedValue({ ready: true, status: "ready" });
    const error = new Error("invalid structured result");
    mocks.ai.mockRejectedValue(error);
    await expect(executeServerControlStep(input, plan, 0)).rejects.toBe(error);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("continues the action after AI recovery", async () => {
    mocks.probe.mockResolvedValue({ ready: true, status: "ready" });
    mocks.ai.mockResolvedValue({ summary: "real response", confidence: 0.8 });
    expect(await executeServerControlStep(input, plan, 0)).toEqual({ control: "continue" });
    expect(mocks.save.mock.calls[0][0].inputUnderstanding).toMatchObject({ status: "ready", summary: "real response" });
    expect(mocks.append.mock.calls[0][0].type).toBe("ActionCompleted");
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("keeps non-AI wait actions independent of provider availability", async () => {
    await executeServerControlStep(input, { ...plan, decision: { action: "wait-human", stage: "diagnosis", reason: "approval" } }, 0);
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});
