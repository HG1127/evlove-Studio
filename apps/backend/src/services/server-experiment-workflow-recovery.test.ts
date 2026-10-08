// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolveProjectSchema, EvolutionJobSchema, InputUnderstandingSchema, type Candidate, type EvolveProject, type TestCase } from "@evolution/contracts";
import { deriveAttentionRequest, serverBaselineFingerprint } from "@evolution/harness";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { runServerMissionExperiment } from "./server-experiment";
import { executeServerControlStep, planMissionStep } from "../../../../workflows/evolution-mission/steps";
const m = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), get: vi.fn(), put: vi.fn(), ai: vi.fn(), browser: vi.fn(), mission: vi.fn(), save: vi.fn(), job: vi.fn(), jobPut: vi.fn(), append: vi.fn(), probe: vi.fn() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: m.get, put: m.put }) }));
vi.mock("./ai-gateway", async (original) => ({ ...await original<typeof import("./ai-gateway")>(), runServerAi: m.ai, serverAiScoringRouteFingerprint: () => "b".repeat(64) }));
vi.mock("./server-ai-health", () => ({ probeServerAiRuntime: m.probe }));
vi.mock("./server-html-artifact-execution", () => ({ serverHtmlArtifactTargetEnabled: () => true, runServerHtmlArtifactBatch: m.browser }));
vi.mock("./connector-target-source", () => ({ serverConnectorTargetEnabled: () => false }));
vi.mock("./server-http-target-execution", () => ({ serverHttpTargetEnabled: () => false }));
vi.mock("./production-runtime", () => ({ getServerProductionRuntime: () => ({ missions: { get: m.mission, save: m.save }, jobs: { get: m.job, put: m.jobPut }, events: { append: m.append } }) }));
vi.mock("../server-env", async (original) => ({ ...await original<typeof import("../server-env")>(), serverAiConfigured: () => true }));
const input = { missionId: "mission", controlJobId: "control", requestedAt: at };
const job = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: "control", missionId: "mission", type: "campaign", status: "running", label: "control", idempotencyKey: "workflow-control:control", generation: 1, attempts: 1, priority: 70, createdAt: at, updatedAt: at });
let stored: EvolveProject;
function project() {
  const x = experimentRecoveryFixture();
  for (const [id, blob] of x.blobs) m.blobs.set(id, blob);
  const p = x.project;
  p.campaign = { ...p.campaign, startedAt: at, noImprovementRounds: 1, estimatedCost: .5, stopCriteria: { ...p.campaign.stopCriteria, maxWallMinutes: 30, maxEstimatedCost: 10 } };
  p.inputUnderstanding = InputUnderstandingSchema.parse({ status: "ready", confidence: .9 });
  p.acceptanceRubric = ["CONTENT", "QUALITY", "SAFETY"].map((id, i) => ({ ...p.acceptanceRubric[0]!, id, weight: i === 0 ? 40 : 30 }));
  p.evalSuite[0]!.criterionIds = p.acceptanceRubric.map(c => c.id);
  p.hiddenEvalSuite = [{ ...p.evalSuite[0]!, id: "H1", hidden: true }];
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: at });
  p.candidates[0]!.patches = [{ id: "edit", component: "code", operation: "update", target: "original input", artifactId: "source", content: "improved actual content", rationale: "complete exact edit" }];
  p.baselineRun.result!.criterionScores = p.acceptanceRubric.map(c => ({ ...p.baselineRun.result!.criterionScores![0]!, criterionId: c.id }));
  p.baselineRun.completedAt = at;
  p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, "b".repeat(64));
  return p;
}
async function paused() {
  const first = await runServerMissionExperiment(project());
  expect(first.reason).toContain("experiment-judge-pending");
  stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(first.project)));
  const request = deriveAttentionRequest(stored)!;
  expect(request.type).toBe("capability");
  stored.attentionRequests = [request];
  return first;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "workflow-recovery-v1");
  m.blobs.clear();
  for (const v of Object.values(m)) if (vi.isMockFunction(v)) v.mockReset();
  m.get.mockImplementation(async (id: string) => m.blobs.get(id));
  m.put.mockImplementation(async (id: string, blob: Blob) => { m.blobs.set(id, blob); });
  m.mission.mockImplementation(async () => structuredClone(stored));
  m.save.mockImplementation(async (p: EvolveProject) => { stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(p))); });
  m.job.mockResolvedValue(job);
  m.probe.mockResolvedValue({ ready: true, status: "ready" });
  m.ai.mockRejectedValueOnce(new Error("independent model timeout")).mockImplementation(async () => ({ accuracy: 92, evidence: 92, riskCoverage: 92, completeness: 92, safety: "PASS", notes: [], failures: [], cases: [{ testCaseId: "V1", accuracy: 92, evidence: 92, completeness: 92, reason: "improved" }], criteria: stored.acceptanceRubric.map(c => ({ criterionId: c.id, score: 92, pass: true, evidence: ["improved actual content"], gaps: [], testCaseIds: ["V1"] })) }));
  m.browser.mockImplementation(async (_p: EvolveProject, tests: TestCase[], c: Candidate) => tests.map(t => ({ testCaseId: t.id, output: "improved actual content", artifactHash: c.artifactSnapshots[0]!.frozenArtifact!.sha256, verificationStatus: "verified", cost: 0, latencyMs: 1, trace: [] })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("explicit durable run restores the stored Experiment Judge checkpoint", () => {
  it("replans and executes the same frozen file and observation through the real Workflow steps", async () => {
    const first = await paused();
    vi.setSystemTime(new Date("2026-10-09T02:01:00.000Z"));
    const next = await planMissionStep(input, 0);
    expect(next.decision.action).toBe("run-campaign");
    expect(m.probe).toHaveBeenCalledExactlyOnceWith(undefined, { force: true });
    expect(stored.campaign).toEqual({ ...first.project.campaign, status: "idle", stopReason: undefined });
    expect(stored.attentionRequests![0]!.status).toBe("resolved");
    expect(stored.experimentRun).toEqual(first.experiment);
    expect(await executeServerControlStep(input, next, 0)).toEqual({ control: "continue" });
    expect(stored.campaign.checkpoint?.completedPhase).toBe("experiment");
    expect(stored.experimentRun.status).toBe("completed");
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(first.project.candidates[0]!.artifactSnapshots);
    expect(m.put).toHaveBeenCalledTimes(1); expect(m.browser).toHaveBeenCalledTimes(1);
    expect(m.ai.mock.calls.map(c => c[0])).toEqual(["evaluate", "evaluate"]);
  });
  it("retains the exact wait when a fresh healthy probe is unavailable", async () => {
    await paused(); const original = structuredClone(stored);
    m.probe.mockResolvedValue({ ready: false, status: "unavailable", reasonCode: "customer-verification-required" });
    expect((await planMissionStep(input, 0)).decision.action).toBe("wait-human");
    expect(stored).toEqual(original); expect(m.save).not.toHaveBeenCalled();
    expect(m.probe).toHaveBeenCalledOnce(); expect(m.put).toHaveBeenCalledTimes(1);
  });
  it("recovers a failure persisted before its generic attention was projected", async () => {
    await paused(); stored.attentionRequests = [];
    expect((await planMissionStep(input, 0)).decision.action).toBe("run-campaign");
    expect(stored.campaign.status).toBe("idle"); expect(m.probe).toHaveBeenCalledOnce();
  });
  it.each(["user-pause", "reason-mismatch", "round-mismatch", "phase-mismatch", "experiment-id", "experiment-completed", "foreign-checkpoint", "duplicate-checkpoint", "missing-execution", "missing-candidate", "other-approval", "budget", "time-window"])("keeps an unrelated or unsafe %s pause without probing", async kind => {
    await paused();
    if (kind === "user-pause") stored.campaign.stopReason = "用户暂停";
    if (kind === "reason-mismatch") stored.experimentRun.summary = "unrelated";
    if (kind === "round-mismatch") stored.campaign.checkpoint!.round = 8;
    if (kind === "phase-mismatch") stored.campaign.checkpoint!.completedPhase = "validation";
    if (kind === "experiment-id") stored.experimentRun.id = "foreign-experiment";
    if (kind === "experiment-completed") stored.experimentRun.status = "completed";
    if (kind === "foreign-checkpoint") stored.experimentRun.executionCheckpoints![0]!.candidateId = "foreign";
    if (kind === "duplicate-checkpoint") stored.experimentRun.executionCheckpoints!.push({ ...stored.experimentRun.executionCheckpoints![0]! });
    if (kind === "missing-execution") stored.experimentRun.executionCheckpoints![0]!.execution = undefined;
    if (kind === "missing-candidate") stored.candidates = [];
    if (kind === "other-approval") stored.attentionRequests!.push({ ...stored.attentionRequests![0]!, id: "human-approval", type: "authorization", reason: "explicit approval required" });
    if (kind === "budget") stored.campaign.stopCriteria.maxEstimatedCost = 0;
    if (kind === "time-window") { stored.campaign.stopCriteria.maxWallMinutes = 1; stored.campaign.startedAt = "2026-10-08T00:00:00Z"; }
    const original = structuredClone(stored);
    await planMissionStep(input, 0);
    expect(stored).toEqual(original); expect(m.probe).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...job, status: "cancelled" }, { ...job, generation: 2 }, { ...job, missionId: "foreign" }])("cannot reopen an inactive or replaced control Job", async current => {
    await paused(); m.job.mockResolvedValue(current);
    await expect(planMissionStep(input, 0)).rejects.toThrow("控制 Job 不再活动");
    expect(m.probe).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); expect(m.append).not.toHaveBeenCalled();
  });
  it("leaves an unknown model probe error on the ordinary retry path", async () => {
    await paused(); m.probe.mockResolvedValue({ ready: false, status: "error" });
    await expect(planMissionStep(input, 0)).rejects.toThrow("健康探测未通过");
    expect(m.save).not.toHaveBeenCalled(); expect(m.append).not.toHaveBeenCalled();
  });
  it("does not replace frozen files when physical readback fails after the probe recovers", async () => {
    const first = await paused();
    const frozen = first.project.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!;
    const next = await planMissionStep(input, 0);
    m.blobs.delete(frozen.blobId);
    const outcome = await executeServerControlStep(input, next, 0);
    expect(outcome).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(stored.candidates[0]!.artifactBuildStatus).toBe("ready");
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(first.project.candidates[0]!.artifactSnapshots);
    expect(m.put).toHaveBeenCalledTimes(1); expect(m.browser).toHaveBeenCalledTimes(1); expect(m.ai).toHaveBeenCalledTimes(1);
  });
});
