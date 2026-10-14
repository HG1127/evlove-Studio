// @vitest-environment node
import { createHash } from "node:crypto";
import { mockEvent } from "nitro/h3";
import { retryStoredServerExperiment } from "../../src/features/evolve/runtime/server-experiment-retry";
import startRoute from "../../apps/backend/server/api/evolution/start.post";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolveProjectSchema, EvolutionJobSchema, InputUnderstandingSchema, type MissionEnvelope,missionEnvelope,type Candidate, type EvolveProject, type TestCase } from "@evolution/contracts";
import { deriveAttentionRequest, serverBaselineFingerprint } from "@evolution/harness";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { runServerMissionExperiment } from "../../apps/backend/src/services/server-experiment";
import { executeServerControlStep, planMissionStep } from "../../workflows/evolution-mission/steps";
const m = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), get: vi.fn(), put: vi.fn(), ai: vi.fn(), browser: vi.fn(), mission: vi.fn(), save: vi.fn(), job: vi.fn(), jobPut: vi.fn(), append: vi.fn(), probe: vi.fn(), start: vi.fn(), getRun: vi.fn(), create: vi.fn(), bind: vi.fn(), list: vi.fn(), readEnvelope: vi.fn(), cas: vi.fn(), readRun: vi.fn() }));
vi.mock("../../apps/backend/src/services/artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: m.get, put: m.put }) }));
vi.mock("../../apps/backend/src/services/ai-gateway", async (original) => ({ ...await original<typeof import("../../apps/backend/src/services/ai-gateway")>(), runServerAi: m.ai, serverAiScoringRouteFingerprint: () => "b".repeat(64) }));
vi.mock("../../apps/backend/src/services/server-ai-health", () => ({ probeServerAiRuntime: m.probe }));
vi.mock("../../apps/backend/src/services/server-html-artifact-execution", () => ({ serverHtmlArtifactTargetEnabled: () => true, runServerHtmlArtifactBatch: m.browser }));
vi.mock("../../apps/backend/src/services/connector-target-source", () => ({ serverConnectorTargetEnabled: () => false }));
vi.mock("../../apps/backend/src/services/server-http-target-execution", () => ({ serverHttpTargetEnabled: () => false }));
vi.mock("../../apps/backend/src/services/production-runtime", async original => ({ ...await original<typeof import("../../apps/backend/src/services/production-runtime")>(), createServerJobIdempotentReceipt: m.create, bindServerJobWorkflowRun: m.bind, getServerMissionEnvelope:m.readEnvelope,compareAndSwapServerMissionEnvelope:m.cas, getServerProductionRuntime: () => ({ missions: { get: m.mission, save: m.save }, jobs: { get: m.job, put: m.jobPut,list:m.list }, events: { append: m.append } }) }));
vi.mock("../../apps/backend/src/server-env", async (original) => ({ ...await original<typeof import("../../apps/backend/src/server-env")>(), serverAiConfigured: () => true, getServerAiConfig:()=>({mode:"openai-compatible",apiKey:"synthetic-never-used",model:"synthetic-recovery-model",baseUrl:"https://synthetic.invalid/v1",timeoutMs:1000}) }));
vi.mock("workflow/runtime",()=>({getWorld:()=>({runs:{get:m.readRun}})}));
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
  m.list.mockResolvedValue([]);
  let revision=29;
  m.readEnvelope.mockImplementation(async()=>missionEnvelope(stored,revision));
  m.cas.mockImplementation(async(next:MissionEnvelope)=>{if(next.revision!==revision)throw new Error("test CAS conflict");revision++;stored=next.payload;return {...next,revision};});
  m.readRun.mockImplementation(async(runId:string)=>({runId,status:"running"}));
  m.probe.mockResolvedValue({ ready: true, status: "ready" });
  m.ai.mockRejectedValueOnce(new Error("independent model timeout")).mockImplementation(async (_role: string, payload: { mode?: string }) => {
    const score = payload.mode === "server-baseline" ? 60 : 92;
    const output = payload.mode === "server-baseline" ? "original content" : "improved actual content";
    return { accuracy: score, evidence: score, riskCoverage: score, completeness: score, safety: "PASS", notes: [], failures: [], cases: [{ testCaseId: "V1", accuracy: score, evidence: score, completeness: score, reason: output }], criteria: stored.acceptanceRubric.map(c => ({ criterionId: c.id, score, pass: score >= 80, evidence: [output], gaps: [], testCaseIds: ["V1"] })) };
  });
  m.browser.mockImplementation(async (p: EvolveProject, tests: TestCase[], c?: Candidate) => tests.map(t => ({ testCaseId: t.id, output: c ? "improved actual content" : "original content", artifactHash: c?.artifactSnapshots[0]!.frozenArtifact!.sha256 ?? createHash("sha256").update(p.sourceArtifacts[0]!.textContent!).digest("hex"), verificationStatus: "verified", cost: 0, latencyMs: 1, trace: [] })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
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
  it.each(["present", "temporarily-unavailable", "wrong-world"] as const)("dispatches a new explicit attempt after an unavailable run finishes and reuses a lost acknowledgement (%s)", async (lookup) => {
    await paused(); const firstVersion = structuredClone(stored);
    const jobs = new Map<string, typeof job>();
    m.list.mockImplementation(async()=>[...jobs.values()]);
    m.create.mockImplementation(async (j: typeof job) => {
      const prior = [...jobs.values()].find(x => x.idempotencyKey === j.idempotencyKey);
      if (prior) return { job: prior, reused: true };
      jobs.set(j.id, j); return { job: j, reused: false };
    });
    const sdkRuns = new Set<string>();
    m.start.mockImplementation(async () => { const runId = "run-" + m.start.mock.calls.length; sdkRuns.add(runId); return { runId }; });
    m.getRun.mockImplementation((runId: string) => ({ exists: Promise.resolve(sdkRuns.has(runId)) }));
    m.bind.mockImplementation(async (id: string, _generation: number, runId: string) => {
      const bound = { ...jobs.get(id)!, outputRef: runId }; jobs.set(id, bound); return bound;
    });
    m.job.mockImplementation(async (id: string) => jobs.get(id));
    m.jobPut.mockImplementation(async (j: typeof job) => { jobs.set(j.id, j); });
    let loseResponse = true;
    const fetch = vi.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe("/api/evolution/start");
      const event = mockEvent(new Request("http://localhost" + path, init));
      const receipt = await startRoute(event);
      if (loseResponse) { loseResponse = false; throw new Error("lost start acknowledgement"); }
      return new Response(JSON.stringify(receipt), { status: event.res.status ?? 200 });
    });
    vi.stubGlobal("fetch", fetch);
    vi.setSystemTime(new Date(Date.parse(at) + 60_000));
    await expect(retryStoredServerExperiment(firstVersion)).rejects.toThrow("lost start acknowledgement");
    if (lookup !== "present") {
      m.getRun.mockReturnValueOnce(lookup === "wrong-world"
        ? { exists: Promise.resolve(false) }
        : { get exists() { return Promise.reject(new Error("PRIVATE_SDK_LOOKUP_ERROR")); } });
      await expect(retryStoredServerExperiment(firstVersion)).rejects.toThrow(lookup === "wrong-world" ? "当前运行环境中不存在" : "当前无法核验");
      expect(m.start).toHaveBeenCalledOnce();
    }
    const firstReceipt = await retryStoredServerExperiment(firstVersion);
    expect(m.getRun).toHaveBeenCalledWith("run-1");
    expect(fetch.mock.calls.every(call => call[1].body === fetch.mock.calls[0]![1].body)).toBe(true);
    expect(m.start).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    m.probe.mockResolvedValue({ ready: false, status: "unavailable", reasonCode: "customer-verification-required" });
    const firstInput = { ...input, controlJobId: firstReceipt.controlJobId };
    const wait = await planMissionStep(firstInput, 0);
    expect(wait.decision.action).toBe("wait-human");
    expect(await executeServerControlStep(firstInput, wait, 0)).toMatchObject({ control: "stop", result: { status: "waiting-human" } });
    expect(jobs.get(firstReceipt.controlJobId)?.status).toBe("waiting");
    expect(stored.updatedAt).not.toBe(firstVersion.updatedAt);
    expect(stored.experimentRun).toEqual(firstVersion.experimentRun);
    const nextVersion = structuredClone(stored);
    m.readRun.mockImplementation(async(runId:string)=>({runId,status:runId==="run-1"?"completed":"running"}));
    vi.setSystemTime(new Date(Date.parse(at) + 120_000));
    m.probe.mockResolvedValue({ ready: true, status: "ready" });
    const secondReceipt = await retryStoredServerExperiment(nextVersion);
    expect(secondReceipt.controlJobId).not.toBe(firstReceipt.controlJobId);
    expect(m.start).toHaveBeenCalledTimes(2);
    const secondInput = { ...input, controlJobId: secondReceipt.controlJobId };
    const recovered = await planMissionStep(secondInput, 0);
    expect(recovered.decision.action).toBe("run-campaign");
    expect(await executeServerControlStep(secondInput, recovered, 0)).toEqual({ control: "continue" });
    expect(stored.experimentRun.status).toBe("completed");
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(firstVersion.candidates[0]!.artifactSnapshots);
    expect(m.put).toHaveBeenCalledTimes(1); expect(m.browser).toHaveBeenCalledTimes(1); expect(m.ai).toHaveBeenCalledTimes(2);
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
  it.each([1, 11])("recovers both persisted pauses with observations aged %s minutes", async minutes => {
    const first = await paused();
    const frozen = first.project.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!;
    const bytes = m.blobs.get(frozen.blobId)!;
    const next = await planMissionStep(input, 0);
    m.blobs.delete(frozen.blobId);
    const outcome = await executeServerControlStep(input, next, 0);
    expect(outcome).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(stored.candidates[0]!.artifactBuildStatus).toBe("ready");
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(first.project.candidates[0]!.artifactSnapshots);
    expect(m.put).toHaveBeenCalledTimes(1); expect(m.browser).toHaveBeenCalledTimes(1); expect(m.ai).toHaveBeenCalledTimes(1);
    expect(stored.campaign.stopReason).toContain("experiment-build-pending");
    stored.attentionRequests!.push(deriveAttentionRequest(stored)!);
    expect(stored.experimentRun.executionCheckpoints).toEqual(first.experiment.executionCheckpoints);
    const unavailable = await planMissionStep(input, 1);
    expect(unavailable.decision.action).toBe("run-campaign");
    expect(await executeServerControlStep(input, unavailable, 1)).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(stored.experimentRun.executionCheckpoints).toEqual(first.experiment.executionCheckpoints);
    expect(m.put).toHaveBeenCalledTimes(1); expect(m.ai).toHaveBeenCalledTimes(1);
    stored.attentionRequests!.push(deriveAttentionRequest(stored)!);
    m.blobs.set(frozen.blobId, bytes);
    vi.setSystemTime(new Date(Date.parse(at) + minutes * 60_000));
    const recovered = await planMissionStep(input, 1);
    expect(recovered.decision.action).toBe("run-campaign");
    expect(await executeServerControlStep(input, recovered, 1)).toEqual({ control: "continue" });
    expect(stored.experimentRun.status).toBe("completed");
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(first.project.candidates[0]!.artifactSnapshots);
    expect(m.put).toHaveBeenCalledTimes(1); expect(m.browser).toHaveBeenCalledTimes(minutes < 10 ? 1 : 3); expect(m.ai).toHaveBeenCalledTimes(minutes < 10 ? 2 : 3);
    expect(stored.campaign.startedAt).toBe(first.project.campaign.startedAt);
    expect(stored.campaign.currentRound).toBe(first.project.campaign.currentRound);
    expect(stored.campaign.noImprovementRounds).toBe(first.project.campaign.noImprovementRounds);
    expect(m.probe).toHaveBeenCalledTimes(3);
  });
});
