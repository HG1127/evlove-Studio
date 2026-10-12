// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, DiagnosisSchema, EvolveProjectSchema, EvolutionJobSchema, InputUnderstandingSchema,
  type EvolveProject } from "@evolution/contracts";
import { buildServerHarnessPlan, serverBaselineFingerprint, serverMainFlowRecoveryActive } from "@evolution/harness";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { executeServerControlStep, planMissionStep } from "../../workflows/evolution-mission/steps";

const m = vi.hoisted(() => ({ ai: vi.fn(), probe: vi.fn(), mission: vi.fn(), save: vi.fn(), job: vi.fn(),
  jobPut: vi.fn(), append: vi.fn() }));
vi.mock("../../apps/backend/src/services/ai-gateway", async original => ({
  ...await original<typeof import("../../apps/backend/src/services/ai-gateway")>(),
  runServerAi: m.ai, serverAiScoringRouteFingerprint: () => "b".repeat(64),
}));
vi.mock("../../apps/backend/src/services/server-ai-health", () => ({ probeServerAiRuntime: m.probe }));
vi.mock("../../apps/backend/src/services/server-ai-connection", async original => ({
  ...await original<typeof import("../../apps/backend/src/services/server-ai-connection")>(),
  serverAiConnectionConfigured: async () => true,
  withServerAiConnection: async (work: () => Promise<unknown>) => work(),
}));
vi.mock("../../apps/backend/src/services/production-runtime", async original => ({
  ...await original<typeof import("../../apps/backend/src/services/production-runtime")>(),
  getServerProductionRuntime: () => ({ missions: { get: m.mission, save: m.save }, jobs: { get: m.job, put: m.jobPut },
    events: { append: m.append } }),
}));
const input = { missionId: "mission", controlJobId: "control", requestedAt: at };
const job = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: input.controlJobId, missionId: input.missionId,
  type: "campaign", status: "running", label: "Control", idempotencyKey: "workflow-control:control", generation: 1,
  attempts: 1, priority: 70, createdAt: at, updatedAt: at });
let stored: EvolveProject;
function project() {
  const p = experimentRecoveryFixture().project;
  p.inputUnderstanding = InputUnderstandingSchema.parse({ status: "ready", confidence: .9 });
  p.campaign = { ...p.campaign, startedAt: at, estimatedCost: .5, checkpoint: { round: 1, completedPhase: "diagnose", at },
    stopCriteria: { ...p.campaign.stopCriteria, maxWallMinutes: 30, maxEstimatedCost: 10 } };
  p.acceptanceRubric = ["CONTENT", "QUALITY", "SAFETY"].map((id, i) => ({ ...p.acceptanceRubric[0]!, id,
    weight: i === 0 ? 40 : 30 }));
  p.evalSuite[0]!.criterionIds = p.acceptanceRubric.map(c => c.id);
  p.hiddenEvalSuite = [{ ...p.evalSuite[0]!, id: "H1", hidden: true }];
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: at });
  p.baselineRun.result!.criterionScores = p.acceptanceRubric.map(c => ({ ...p.baselineRun.result!.criterionScores![0]!, criterionId: c.id }));
  p.baselineRun.completedAt = at;
  p.diagnosis = DiagnosisSchema.parse({ problemId: "P", rootCause: "Missing detail", summary: "Add detail", affectedComponent: "source",
    confidence: .9, evidence: ["original input"], evidenceRefs: [{ id: "diagnosis-source", claim: "Missing detail", kind: "source", artifactId: "source", excerpt: "original input", verified: true }],
    falsifier: "Detail remains missing", suggestedScopes: ["code"] });
  p.candidates[0] = CandidateSchema.parse({ ...p.candidates[0]!, designRationale: { sourceEvidence: ["original input"],
    mechanism: "Replace the incomplete text to add observed detail", commandAlignment: "improve content",
    coveredCriteria: p.acceptanceRubric.map(c => c.title), protectedCompliance: "preserved", falsifier: "Detail remains missing" } });
  p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, "b".repeat(64));
  return p;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  for (const mock of Object.values(m)) mock.mockReset();
  stored = project();
  m.mission.mockImplementation(async () => structuredClone(stored));
  m.save.mockImplementation(async (p: EvolveProject) => { stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(p))); });
  m.job.mockResolvedValue(job);
  m.probe.mockResolvedValue({ ready: false, status: "unavailable", reasonCode: "provider-unavailable" });
  m.ai.mockImplementation(async (operation: string) => {
    if (operation !== "plan") throw new Error("Unexpected AI operation: " + operation);
    return { candidates: structuredClone(stored.candidates), recommendedCandidateIds: stored.selectedCandidateIds,
      summary: "Same grounded Candidate", experimentDesign: [] };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function pauseControlAi() {
  const initial = structuredClone(stored), plan = buildServerHarnessPlan(stored);
  expect(plan.decision.action).toBe("run-campaign");
  expect(await executeServerControlStep(input, plan, 0)).toMatchObject({ control: "stop", result: { status: "waiting-human" } });
  expect(stored.campaign.serverRecoveryWait).toMatchObject({ marker: "control-ai", status: "waiting", controlJobId: input.controlJobId,
    controlAiAttentionRequestId: "server-ai-capability-" + plan.checkpoint.id });
  expect(stored.candidates).toEqual(initial.candidates);
  expect(stored.campaign.checkpoint).toEqual(initial.campaign.checkpoint);
  expect(stored.diagnosis).toEqual(initial.diagnosis);
  expect(stored.baselineRun).toEqual(initial.baselineRun);
  expect(m.ai).not.toHaveBeenCalled();
}

describe("control AI capability recovery through durable plan and execute", () => {
  it("resolves the exact request and executes a different healthy Job without replacing retained evidence", async () => {
    await pauseControlAi();
    const old = structuredClone(stored), request = stored.attentionRequests!.find(r => r.status === "pending")!;
    stored.attentionRequests!.push({ ...request, id: "server-ai-capability-server-checkpoint-history", status: "resolved",
      resolvedAt: "2026-10-08T00:00:00.000Z" });
    const retry = { ...input, controlJobId: "new-control" };
    m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    m.probe.mockResolvedValue({ ready: true, status: "ready" });
    const plan = await planMissionStep(retry, 0);
    expect(plan.decision.action).toBe("run-campaign");
    expect(stored.campaign.serverRecoveryWait).toMatchObject({ status: "recovering", resumedByControlJobId: retry.controlJobId,
      controlAiAttentionRequestId: request.id });
    expect(stored.attentionRequests!.find(r => r.id === request.id)).toMatchObject({ status: "resolved", resolvedAt: at });
    expect(serverMainFlowRecoveryActive(stored)).toBe(true);
    expect(stored.candidates).toEqual(old.candidates);
    expect(stored.campaign.checkpoint).toEqual(old.campaign.checkpoint);
    expect(stored.diagnosis).toEqual(old.diagnosis);
    expect(stored.baselineRun).toEqual(old.baselineRun);
    await expect(planMissionStep({ ...input, controlJobId: "parallel-control" }, 0)).rejects.toThrow("另一控制 Job");
    expect(await executeServerControlStep(retry, plan, 0)).toEqual({ control: "continue" });
    expect(m.ai).toHaveBeenCalledOnce(); expect(m.ai.mock.calls[0]![0]).toBe("plan");
    expect(stored.candidates).toEqual(old.candidates);
    expect(stored.diagnosis).toEqual(old.diagnosis);
    expect(stored.baselineRun).toEqual(old.baselineRun);
    expect(stored.campaign.checkpoint).toMatchObject({ round: 1, completedPhase: "plan" });
    expect(stored.campaign.startedAt).toBe(old.campaign.startedAt);
    expect(stored.campaign.estimatedCost).toBe(old.campaign.estimatedCost);
    expect(stored.campaign.serverRecoveryWait).toBeUndefined();
  });

  it.each(["cancelled", "approval", "changed-input", "changed-request", "old-job"])("rechecks %s at the execution boundary", async kind => {
    await pauseControlAi();
    const retry = { ...input, controlJobId: "new-control" };
    m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    m.probe.mockResolvedValue({ ready: true, status: "ready" });
    const plan = await planMissionStep(retry, 0);
    if (kind === "cancelled") m.job.mockResolvedValue({ ...job, id: retry.controlJobId, status: "cancelled" });
    if (kind === "approval") stored.attentionRequests!.push({ ...stored.attentionRequests![0]!, id: "approval", type: "authorization", status: "pending" });
    if (kind === "changed-input") stored.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "changed-request") stored.attentionRequests![0]!.id += " changed";
    const before = structuredClone(stored); m.save.mockClear(); m.ai.mockClear();
    await expect(executeServerControlStep(kind === "old-job" ? input : retry, plan, 0)).rejects.toThrow(
      kind === "cancelled" ? "控制 Job 不再活动" : "恢复断点");
    expect(m.save).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled(); expect(stored).toEqual(before);
  });

  it("does not probe or admit the original paused control Job", async () => {
    await pauseControlAi(); const paused = structuredClone(stored);
    m.probe.mockClear(); m.save.mockClear();
    expect((await planMissionStep(input, 0)).decision.action).toBe("wait-human");
    expect(m.probe).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); expect(stored).toEqual(paused);
  });

  it.each(["cancelled", "approval", "safety", "changed-input", "missing-id", "foreign-id"])("keeps %s recovery closed", async kind => {
    await pauseControlAi();
    const retry = { ...input, controlJobId: "new-control" };
    m.job.mockResolvedValue({ ...job, id: retry.controlJobId, status: kind === "cancelled" ? "cancelled" : "running" });
    m.probe.mockResolvedValue({ ready: true, status: "ready" });
    if (kind === "approval") stored.attentionRequests!.push({ ...stored.attentionRequests![0]!, id: "approval", type: "authorization" });
    if (kind === "safety") stored.validationRun.evaluation = { ...stored.baselineRun.result!, safety: "FAIL" };
    if (kind === "changed-input") stored.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "missing-id") stored.campaign.serverRecoveryWait!.controlAiAttentionRequestId = undefined;
    if (kind === "foreign-id") stored.campaign.serverRecoveryWait!.controlAiAttentionRequestId = "foreign-capability";
    const paused = structuredClone(stored); m.probe.mockClear(); m.save.mockClear();
    if (kind === "cancelled") await expect(planMissionStep(retry, 0)).rejects.toThrow("控制 Job 不再活动");
    else expect((await planMissionStep(retry, 0)).decision.action).not.toBe("run-campaign");
    expect(m.probe).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled();
    expect(stored).toEqual(paused);
  });
});
