// @vitest-environment node
import { createHash } from "node:crypto";

import { checkpointServerMainFlowWait } from "../../apps/backend/src/services/server-main-flow-recovery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolveProjectSchema, EvolutionJobSchema, InputUnderstandingSchema, type Candidate, type EvolveProject, type TestCase } from "@evolution/contracts";
import { buildServerHarnessPlan, serverBaselineFingerprint, serverHoldoutExecutionEvidenceFingerprint } from "@evolution/harness";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { runServerMissionExperiment } from "../../apps/backend/src/services/server-experiment";
import { executeServerControlStep, planMissionStep } from "../../workflows/evolution-mission/steps";
const m = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), get: vi.fn(), put: vi.fn(), ai: vi.fn(), browser: vi.fn(), mission: vi.fn(), save: vi.fn(), job: vi.fn(), jobPut: vi.fn(), append: vi.fn(), probe: vi.fn(), route: vi.fn(), start: vi.fn(), getRun: vi.fn(), create: vi.fn(), bind: vi.fn(), lookup: vi.fn() }));
vi.mock("../../apps/backend/src/services/artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: m.get, put: m.put }) }));
vi.mock("../../apps/backend/src/services/ai-gateway", async (original) => ({ ...await original<typeof import("../../apps/backend/src/services/ai-gateway")>(), runServerAi: m.ai, serverAiScoringRouteFingerprint: m.route }));
vi.mock("../../apps/backend/src/services/server-ai-health", () => ({ probeServerAiRuntime: m.probe }));
vi.mock("../../apps/backend/src/services/server-html-artifact-execution", () => ({ serverHtmlArtifactTargetEnabled: () => true, runServerHtmlArtifactBatch: m.browser }));
vi.mock("../../apps/backend/src/services/connector-target-source", () => ({ serverConnectorTargetEnabled: () => false }));
vi.mock("../../apps/backend/src/services/server-http-target-execution", () => ({ serverHttpTargetEnabled: () => false }));
vi.mock("../../apps/backend/src/services/production-runtime", async original => ({ ...await original<typeof import("../../apps/backend/src/services/production-runtime")>(), createServerJobIdempotentReceipt: m.create, getServerJobByIdempotencyKey: m.lookup, bindServerJobWorkflowRun: m.bind, getServerProductionRuntime: () => ({ missions: { get: m.mission, save: m.save }, jobs: { get: m.job, put: m.jobPut }, events: { append: m.append } }) }));
vi.mock("../../apps/backend/src/server-env", async (original) => ({ ...await original<typeof import("../../apps/backend/src/server-env")>(), serverAiConfigured: () => true }));
vi.mock("workflow/api", () => ({ start: m.start, getRun: m.getRun }));
vi.mock("../../workflows/evolution-mission", () => ({ evolutionMissionWorkflow: vi.fn() }));
vi.mock("../../apps/backend/src/services/security-policy", () => ({ requireGovernedEvolutionPermission: vi.fn(async () => undefined) }));
vi.mock("../../src/features/evolve/runtime/production-runtime", () => ({ productionRuntimeMode: () => "http" }));
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
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: at }, { id: "artifact-ready", status: "pending" }, { id: "release-ready", status: "pending" });
  p.candidates[0]!.patches = [{ id: "edit", component: "code", operation: "update", target: "original input", artifactId: "source", content: "improved actual content", rationale: "complete exact edit" }];
  p.baselineRun.result!.criterionScores = p.acceptanceRubric.map(c => ({ ...p.baselineRun.result!.criterionScores![0]!, criterionId: c.id }));
  p.baselineRun.completedAt = at;
  p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, "b".repeat(64));
  return p;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "workflow-recovery-v1");
  m.blobs.clear();
  for (const v of Object.values(m)) if (vi.isMockFunction(v)) v.mockReset();
  m.route.mockReturnValue("b".repeat(64));
  m.get.mockImplementation(async (id: string) => m.blobs.get(id));
  m.put.mockImplementation(async (id: string, blob: Blob) => { m.blobs.set(id, blob); });
  m.mission.mockImplementation(async () => structuredClone(stored));
  m.save.mockImplementation(async (p: EvolveProject) => { stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(p))); });
  m.job.mockResolvedValue(job);
  m.probe.mockResolvedValue({ ready: true, status: "ready" });
  m.ai.mockRejectedValueOnce(new Error("independent model timeout")).mockImplementation(async (_role: string, payload: { mode?: string }) => {
    const score = payload.mode === "server-baseline" ? 60 : 92;
    const output = payload.mode === "server-baseline" ? "original content" : "improved actual content";
    return { accuracy: score, evidence: score, riskCoverage: score, completeness: score, safety: "PASS", notes: [], failures: [], cases: [{ testCaseId: "V1", accuracy: score, evidence: score, completeness: score, reason: output }], criteria: stored.acceptanceRubric.map(c => ({ criterionId: c.id, score, pass: score >= 80, evidence: [output], gaps: [], testCaseIds: ["V1"] })) };
  });
  m.browser.mockImplementation(async (p: EvolveProject, tests: TestCase[], c?: Candidate) => tests.map(t => ({ testCaseId: t.id, output: c ? "improved actual content" : "original content", artifactHash: c?.artifactSnapshots[0]!.frozenArtifact!.sha256 ?? createHash("sha256").update(p.sourceArtifacts[0]!.textContent!).digest("hex"), verificationStatus: "verified", cost: 0, latencyMs: 1, trace: [] })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function healthyModel() {
  m.ai.mockReset().mockImplementation(async (role: string, payload: { mode?: string; testCases?: TestCase[] }) => {
    if (role === "release-review") return { recommendation: "release", summary: "independent accepted review" };
    const ids = (payload.testCases ?? []).map(t => t.id);
    const isBaseline = payload.mode?.includes("baseline"), score = isBaseline ? 60 : 92;
    const evidence = isBaseline ? "original input" : "improved actual content";
    return { accuracy: score, evidence: score, riskCoverage: score, completeness: score, safety: "PASS", notes: [],
      failures: isBaseline ? ["missing detail"] : [],
      cases: ids.map(testCaseId => ({ testCaseId, accuracy: score, evidence: score, completeness: score, reason: evidence })),
      criteria: stored.acceptanceRubric.map(c => ({ criterionId: c.id, score, pass: score >= 80, evidence: [evidence], gaps: [], testCaseIds: ids })) };
  });
}
async function pausedGateF() {
  stored = project(); healthyModel();
  const experiment = await runServerMissionExperiment(stored);
  stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(experiment.project)));
  await executeServerControlStep(input, buildServerHarnessPlan(stored), 0);
  m.get.mockResolvedValueOnce(undefined);
  expect(await executeServerControlStep(input, buildServerHarnessPlan(stored), 1))
    .toMatchObject({ result: { status: "waiting-action" } });
  expect(stored.campaign.serverRecoveryWait?.marker).toBe("artifact-acceptance-evidence-pending");
  expect(stored.artifactAcceptance.status).toBe("unverified");
  const retry = { ...input, controlJobId: "offline-readback-control" };
  m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
  m.probe.mockClear().mockResolvedValue({ ready: false, status: "unavailable", reasonCode: "provider-unavailable" });
  m.ai.mockClear().mockRejectedValue(new Error("model provider remains offline"));
  m.browser.mockClear(); m.put.mockClear(); m.get.mockClear();
  return retry;
}

describe("Gate F file recovery when the configured model is offline", () => {
  it("recovers actual frozen readback without another model probe, execution or write", async () => {
    const retry = await pausedGateF();
    const hidden = structuredClone(stored.validationRun);
    const snapshots = structuredClone(stored.candidates[0]!.artifactSnapshots);
    const failedAcceptance = structuredClone(stored.artifactAcceptance);
    const originalBytes = await m.blobs.get(snapshots[0]!.frozenArtifact!.blobId)!.arrayBuffer();
    const plan = await planMissionStep(retry, 0);
    expect(plan.decision.action).toBe("run-campaign");
    expect(stored.artifactAcceptance).toEqual(failedAcceptance);
    expect(await executeServerControlStep(retry, plan, 0)).toEqual({ control: "continue" });
    expect(stored.artifactAcceptance).toMatchObject({ status: "passed", hardGatePass: true, candidateId: hidden.candidateId });
    expect(stored.artifactAcceptance.frozenArtifacts).toEqual(snapshots.map(s => s.frozenArtifact));
    expect(stored.validationRun).toEqual(hidden);
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(snapshots);
    expect(await m.blobs.get(snapshots[0]!.frozenArtifact!.blobId)!.arrayBuffer()).toEqual(originalBytes);
    expect(m.get).toHaveBeenCalled();
    expect(m.probe).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled();
    expect(m.browser).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
    expect(stored.gates.find(g => g.id === "release-ready")?.status).toBe("ready");
    expect(stored.campaign.serverRecoveryWait).toBeUndefined();
  });
  it.each(["hidden-expired", "visible-expired", "review-missing", "route-unknown", "route-changed"])("keeps %s waiting when fresh AI work would be needed", async kind => {
    const retry = await pausedGateF();
    if (kind === "hidden-expired") {
      stored.validationRun.baselineObservedAt = Date.parse(at) - 11 * 60_000;
      stored.validationRun.executionEvidenceFingerprint = serverHoldoutExecutionEvidenceFingerprint(stored.validationRun);
    }
    if (kind === "visible-expired") stored.baselineRun.completedAt = new Date(Date.parse(at) - 11 * 60_000).toISOString();
    if (kind === "review-missing") stored.validationRun.recommendation = "hold";
    if (kind === "route-unknown") m.route.mockReturnValue(undefined);
    if (kind === "route-changed") m.route.mockReturnValue("c".repeat(64));
    stored = checkpointServerMainFlowWait(stored, input.controlJobId);
    const before = structuredClone(stored);
    expect((await planMissionStep(retry, 0)).decision.action).toBe("wait-human");
    expect(stored).toEqual(before);
    expect(m.probe).toHaveBeenCalledTimes(1);
    expect(m.ai).not.toHaveBeenCalled(); expect(m.browser).not.toHaveBeenCalled();
    expect(m.get).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
  });

  it("rechecks observation age between planning and execution before any new measurement", async () => {
    const retry = await pausedGateF();
    const hidden = structuredClone(stored.validationRun), snapshots = structuredClone(stored.candidates[0]!.artifactSnapshots);
    const plan = await planMissionStep(retry, 0);
    expect(plan.decision.action).toBe("run-campaign");
    vi.setSystemTime(new Date(Date.parse(at) + 11 * 60_000));
    expect(await executeServerControlStep(retry, plan, 0)).toMatchObject({ result: { status: "waiting-human" } });
    expect(stored.artifactAcceptance.status).toBe("unverified");
    expect(stored.validationRun).toEqual(hidden); expect(stored.candidates[0]!.artifactSnapshots).toEqual(snapshots);
    expect(m.probe).toHaveBeenCalledTimes(1); expect(m.ai).not.toHaveBeenCalled();
    expect(m.browser).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
  });

  it.each(["source", "candidate"])("blocks changed physical %s bytes without accepting old paired evidence", async kind => {
    const retry = await pausedGateF();
    const hidden = structuredClone(stored.validationRun);
    const plan = await planMissionStep(retry, 0);
    expect(plan.decision.action).toBe("run-campaign");
    const id = kind === "source" ? (stored.sourceArtifacts[0]!.storageRef || stored.sourceArtifacts[0]!.id) : stored.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!.blobId;
    const content = kind === "source" ? stored.sourceArtifacts[0]!.textContent!.replace("original input", "tampered input") : "changed physical bytes";
    m.blobs.set(id, new Blob([content], { type: "text/html" }));
    expect(await executeServerControlStep(retry, plan, 0)).toMatchObject({ result: { status: "waiting-action" } });
    expect(stored.artifactAcceptance.status).not.toBe("passed");
    if (kind === "source") {
      expect(stored.artifactAcceptance.status).toBe("failed");
      expect(stored.campaign.serverRecoveryWait).toBeUndefined();
    }
    expect(stored.gates.find(g => g.id === "artifact-ready")?.status).not.toBe("approved");
    expect(stored.validationRun).toEqual(hidden);
    expect(m.probe).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled();
    expect(m.browser).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
  });

  it("retains exact evidence when physical readback is still missing", async () => {
    const retry = await pausedGateF();
    const hidden = structuredClone(stored.validationRun), snapshots = structuredClone(stored.candidates[0]!.artifactSnapshots);
    const plan = await planMissionStep(retry, 0);
    m.get.mockResolvedValueOnce(undefined);
    expect(await executeServerControlStep(retry, plan, 0)).toMatchObject({ result: { status: "waiting-action" } });
    expect(stored.artifactAcceptance.status).toBe("unverified");
    expect(stored.validationRun).toEqual(hidden); expect(stored.candidates[0]!.artifactSnapshots).toEqual(snapshots);
    expect(stored.campaign.serverRecoveryWait?.marker).toBe("artifact-acceptance-evidence-pending");
    expect(m.probe).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled();
    expect(m.browser).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled"])("does not restore a %s control Job", async status => {
    const retry = await pausedGateF(); m.job.mockResolvedValue({ ...job, id: retry.controlJobId, status });
    const before = structuredClone(stored);
    await expect(planMissionStep(retry, 0)).rejects.toThrow("控制 Job 不再活动");
    expect(stored).toEqual(before); expect(m.probe).not.toHaveBeenCalled(); expect(m.get).not.toHaveBeenCalled();
  });
  it.each([undefined, "c".repeat(64)])("rechecks scoring route between planning and execution (%s)", async route => {
    const retry = await pausedGateF(), hidden = structuredClone(stored.validationRun);
    const plan = await planMissionStep(retry, 0);
    expect(plan.decision.action).toBe("run-campaign");
    m.route.mockReturnValue(route);
    expect(await executeServerControlStep(retry, plan, 0)).toMatchObject({ result: { status: "waiting-human" } });
    expect(stored.validationRun).toEqual(hidden); expect(stored.artifactAcceptance.status).toBe("unverified");
    expect(m.probe).toHaveBeenCalledTimes(1); expect(m.ai).not.toHaveBeenCalled();
    expect(m.browser).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled"])("rejects a %s control Job after readback planning", async status => {
    const retry = await pausedGateF();
    const plan = await planMissionStep(retry, 0), before = structuredClone(stored);
    m.job.mockResolvedValue({ ...job, id: retry.controlJobId, status });
    await expect(executeServerControlStep(retry, plan, 0)).rejects.toThrow("控制 Job 不再活动");
    expect(stored).toEqual(before); expect(m.get).not.toHaveBeenCalled(); expect(m.probe).not.toHaveBeenCalled();
  });
  it("rechecks age after a physical read crosses the live observation expiry", async () => {
    const retry = await pausedGateF(), hidden = structuredClone(stored.validationRun);
    const plan = await planMissionStep(retry, 0);
    vi.setSystemTime(new Date(Date.parse(at) + 9 * 60_000 + 59_000));
    m.get.mockImplementationOnce(async (id: string) => {
      vi.setSystemTime(new Date(Date.parse(at) + 10 * 60_000 + 1_000));
      return m.blobs.get(id);
    });
    const outcome = await executeServerControlStep(retry, plan, 0);
    expect(m.browser).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ result: { status: "waiting-human" } });
    expect(stored.validationRun).toEqual(hidden); expect(stored.artifactAcceptance.status).toBe("unverified");
    expect(m.probe).toHaveBeenCalledTimes(1);
  });
});