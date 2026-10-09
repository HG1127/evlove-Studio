// @vitest-environment node
import { createHash } from "node:crypto";
import { mockEvent } from "nitro/h3";
import { retryStoredServerExperiment } from "../../src/features/evolve/runtime/server-experiment-retry";
import startRoute from "../../apps/backend/server/api/evolution/start.post";
import { checkpointServerMainFlowWait, serverMainFlowRecoveryDigest } from "../../apps/backend/src/services/server-main-flow-recovery";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, EvolveProjectSchema, EvolutionJobSchema, EvolutionWorkflowRunInputSchema, InputUnderstandingSchema, type Candidate, type EvolveProject, type TestCase } from "@evolution/contracts";
import { buildServerHarnessPlan, serverBaselineFingerprint } from "@evolution/harness";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { runServerMissionExperiment } from "../../apps/backend/src/services/server-experiment";
import { executeServerControlStep, planMissionStep } from "../../workflows/evolution-mission/steps";
const m = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), get: vi.fn(), put: vi.fn(), ai: vi.fn(), browser: vi.fn(), mission: vi.fn(), save: vi.fn(), job: vi.fn(), jobPut: vi.fn(), append: vi.fn(), probe: vi.fn(), start: vi.fn(), getRun: vi.fn(), create: vi.fn(), bind: vi.fn(), lookup: vi.fn() }));
vi.mock("../../apps/backend/src/services/artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: m.get, put: m.put }) }));
vi.mock("../../apps/backend/src/services/ai-gateway", async (original) => ({ ...await original<typeof import("../../apps/backend/src/services/ai-gateway")>(), runServerAi: m.ai, serverAiScoringRouteFingerprint: () => "b".repeat(64) }));
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

function legacy() {
  const p = project(); p.candidates = []; p.selectedCandidateIds = [];
  p.stage = "plan"; p.campaign.status = "paused";
  p.campaign.stopReason = "[server-campaign-plan-grounding-pending] no grounded proposal";
  p.campaign.checkpoint = { round: 1, completedPhase: "diagnose", at };
  return p;
}
function healthyModel() {
  m.ai.mockReset().mockImplementation(async (role: string, payload: { mode?: string; testCases?: TestCase[] }) => {
    if (role === "build-candidate") return { artifacts: [{ sourceArtifactId: stored.sourceArtifacts[0]!.id,
      name: stored.sourceArtifacts[0]!.name, mimeType: stored.sourceArtifacts[0]!.mimeType,
      content: stored.sourceArtifacts[0]!.textContent!.replace("original input", "improved actual content") }], summary: "actual constructed bytes" };
    if (role === "release-review") return { recommendation: "release", summary: "independent accepted review" };
    if (role === "problem-analysis") return { problems: [{ id: "P", title: "Missing detail", impact: 90, severity: "high",
      status: "recommended", summary: "Missing detail", rootCause: "Missing mechanism", evidence: ["original input"],
      evidenceRefs: [], confidence: .9, affectedComponent: "source" }], recommendedProblemId: "P", summary: "observed" };
    if (role === "diagnose") return { problemId: stored.selectedProblemId ?? "P", rootCause: "Missing detail", summary: "Add detail",
      affectedComponent: "source", confidence: .9, evidence: ["original input"], evidenceRefs: [], counterEvidence: [],
      falsifier: "Missing detail remains", suggestedScopes: ["code"], trace: [] };
    if (role === "plan") {
      const c = CandidateSchema.parse({ ...project().candidates[0]!, id: "fresh-candidate", designRationale: {
        sourceEvidence: ["original input"], mechanism: "Exact edit adds missing detail", commandAlignment: "improve",
        coveredCriteria: stored.acceptanceRubric.map(c => c.title), protectedCompliance: "preserved", falsifier: "detail absent" } });
      return { candidates: [c], recommendedCandidateIds: [c.id], summary: "fresh plan", experimentDesign: [] };
    }
    const ids = (payload.testCases ?? []).map(t => t.id);
    const isBaseline = payload.mode?.includes("baseline"), score = isBaseline ? 60 : 92;
    const evidence = isBaseline ? "original input" : "improved actual content";
    return { accuracy: score, evidence: score, riskCoverage: score, completeness: score, safety: "PASS", notes: [],
      failures: isBaseline ? ["missing detail"] : [],
      cases: ids.map(testCaseId => ({ testCaseId, accuracy: score, evidence: score, completeness: score, reason: evidence })),
      criteria: stored.acceptanceRubric.map(c => ({ criterionId: c.id, score, pass: score >= 80, evidence: [evidence], gaps: [], testCaseIds: ids })) };
  });
}
describe("main flow recovery through actual durable entry", () => {
  it("writes a receipt for initial Builder failure and resumes only a different active control generation", async () => {
    stored = project();
    m.ai.mockReset().mockRejectedValue(new Error("materialization provider unavailable"));
    // Force AI construction, rather than the deterministic edit path.
    stored.candidates[0]!.patches = [];
    const first = buildServerHarnessPlan(stored);
    expect(await executeServerControlStep(input, first, 0)).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(stored.campaign.serverRecoveryWait?.marker).toBe("experiment-build-pending");
    expect(stored.experimentRun.executionCheckpoints ?? []).toEqual([]);
    const paused = structuredClone(stored);
    expect((await planMissionStep(input, 0)).decision.action).toBe("wait-human");
    expect(m.probe.mock.calls.filter(c => c[1]?.force)).toHaveLength(0);
    const retry = { ...input, controlJobId: "new-control" }; m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    m.probe.mockResolvedValue({ ready: true, status: "ready" });
    expect((await planMissionStep(retry, 0)).decision.action).toBe("run-campaign");
    expect(stored.candidates).toEqual(paused.candidates);
    expect(stored.baselineRun).toEqual(paused.baselineRun);
    expect(stored.campaign.checkpoint).toEqual(paused.campaign.checkpoint);
    await expect(planMissionStep({ ...input, controlJobId: "parallel-control" }, 0)).rejects.toThrow("另一控制 Job");
  });

  it("admits retained same-paper Hidden Judge recovery through plan and execute without rebuilding bytes", async () => {
    stored = project(); healthyModel();
    const exp = await runServerMissionExperiment(stored); stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(exp.project)));
    const snapshots = structuredClone(stored.candidates[0]!.artifactSnapshots);
    m.ai.mockRejectedValueOnce(new Error("Hidden current Judge unavailable"));
    const first = buildServerHarnessPlan(stored);
    expect(await executeServerControlStep(input, first, 0)).toMatchObject({ result: { status: "waiting-action" } });
    expect(stored.campaign.serverRecoveryWait?.marker).toBe("holdout-judge-pending");
    const pairedRuns = structuredClone([stored.validationRun.baselineRuns, stored.validationRun.runs]);
    const executed = m.browser.mock.calls.length, writes = m.put.mock.calls.length;
    const retry = { ...input, controlJobId: "new-control" }; m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    vi.setSystemTime(new Date(Date.parse(at) + 60_000));
    const plan = await planMissionStep(retry, 0);
    expect(plan.decision.action).toBe("run-campaign");
    expect(await executeServerControlStep(retry, plan, 0)).toEqual({ control: "continue" });
    expect(stored.campaign.checkpoint?.completedPhase).toBe("validation");
    expect([stored.validationRun.baselineRuns, stored.validationRun.runs]).toEqual(pairedRuns);
    expect(m.browser).toHaveBeenCalledTimes(executed); expect(m.put).toHaveBeenCalledTimes(writes);
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(snapshots);
  });

  it("retries Gate F frozen readback while retaining the same Candidate and paired Hidden evidence", async () => {
    stored = project();
    stored.protectedItems = ["preserve original document structure"];
    stored.acceptanceRubric[2] = { ...stored.acceptanceRubric[2]!, source: "protected-item", protectedConstraint: true, category: "protected" };
    stored.baselineRun.measurementFingerprint = serverBaselineFingerprint(stored, "b".repeat(64));
    healthyModel();
    const exp = await runServerMissionExperiment(stored); stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(exp.project)));
    await executeServerControlStep(input, buildServerHarnessPlan(stored), 0);
    const candidateId = stored.validationRun.candidateId, snapshots = structuredClone(stored.candidates[0]!.artifactSnapshots);
    const hidden = structuredClone(stored.validationRun), executions = m.browser.mock.calls.length, writes = m.put.mock.calls.length;
    m.get.mockResolvedValueOnce(undefined);
    expect(await executeServerControlStep(input, buildServerHarnessPlan(stored), 1)).toMatchObject({ result: { status: "waiting-action" } });
    expect(stored.campaign.serverRecoveryWait?.marker).toBe("artifact-acceptance-evidence-pending");
    expect(stored.artifactAcceptance.status).toBe("unverified");
    const failedAcceptance = structuredClone(stored.artifactAcceptance);
    const retry = { ...input, controlJobId: "new-control" }; m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    const plan = await planMissionStep(retry, 0);
    expect(plan.decision.action).toBe("run-campaign");
    expect(stored.artifactAcceptance).toEqual(failedAcceptance);
    expect(await executeServerControlStep(retry, plan, 0)).toEqual({ control: "continue" });
    expect(stored.artifactAcceptance).toMatchObject({ status: "passed", candidateId, hardGatePass: true });
    expect(stored.artifactAcceptance.frozenArtifacts).toEqual(snapshots.map(s => s.frozenArtifact));
    expect(stored.gates.find(g => g.id === "artifact-ready")?.status).toBe("approved");
    expect(stored.validationRun).toEqual(hidden); expect(stored.candidates[0]!.artifactSnapshots).toEqual(snapshots);
    expect(m.browser).toHaveBeenCalledTimes(executions); expect(m.put).toHaveBeenCalledTimes(writes);
    expect(stored.campaign.serverRecoveryWait).toBeUndefined();
  });

  it.each([false, true])("refreshes expired paired Hidden before retrying Gate F and stops new Safety failure (%s)", async safetyFailure => {
    stored = project(); healthyModel();
    const exp = await runServerMissionExperiment(stored); stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(exp.project)));
    await executeServerControlStep(input, buildServerHarnessPlan(stored), 0);
    m.get.mockResolvedValueOnce(undefined);
    await executeServerControlStep(input, buildServerHarnessPlan(stored), 1);
    const oldHidden = structuredClone(stored.validationRun), snapshots = structuredClone(stored.candidates[0]!.artifactSnapshots);
    const executions = m.browser.mock.calls.length, writes = m.put.mock.calls.length;
    vi.setSystemTime(new Date(Date.parse(at) + 11 * 60_000));
    const retry = { ...input, controlJobId: "new-control" }; m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    const plan = await planMissionStep(retry, 0);
    if (safetyFailure) {
      const healthy = m.ai.getMockImplementation()!;
      m.ai.mockImplementation(async (role, payload) => {
        const result = await healthy(role, payload);
        return role === "evaluate" && payload.mode === "server-hidden-holdout-candidate" ? { ...result, safety: "FAIL" } : result;
      });
    }
    const result = await executeServerControlStep(retry, plan, 0);
    expect(m.browser).toHaveBeenCalledTimes(executions + 3); expect(m.put).toHaveBeenCalledTimes(writes);
    expect(stored.candidates[0]!.artifactSnapshots).toEqual(snapshots);
    const source = m.append.mock.calls.find(c => c[0].payload.action === "refresh-hidden-on-resume")![0];
    expect(source.payload.priorValidation).toEqual(oldHidden);
    expect(stored.validationRun.baselineObservedAt).toBe(Date.parse(at) + 11 * 60_000);
    if (safetyFailure) {
      expect(result).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
      expect(stored.validationRun.evaluation?.safety).toBe("FAIL"); expect(stored.artifactAcceptance.status).toBe("unverified");
    } else {
      expect(result).toEqual({ control: "continue" }); expect(stored.artifactAcceptance.status).toBe("passed");
    }
  });
  it("hands a recovered initial Builder to the existing frozen Experiment Judge journal", async () => {
    stored = project(); stored.candidates[0]!.patches = [];
    m.ai.mockReset().mockRejectedValue(new Error("initial Builder unavailable"));
    await executeServerControlStep(input, buildServerHarnessPlan(stored), 0);
    const retry = { ...input, controlJobId: "builder-retry" }; m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    const plan = await planMissionStep(retry, 0); healthyModel();
    const healthy = m.ai.getMockImplementation()!;
    m.ai.mockImplementation(async (role, payload) => {
      if (role === "evaluate") throw new Error("independent Experiment Judge unavailable");
      return healthy(role, payload);
    });
    expect(await executeServerControlStep(retry, plan, 0)).toMatchObject({ result: { status: "waiting-action" } });
    expect(stored.campaign.stopReason).toContain("experiment-judge-pending");
    expect(stored.experimentRun.executionCheckpoints?.[0]?.execution?.runs).toHaveLength(1);
    expect(stored.campaign.serverRecoveryWait).toBeUndefined();
    healthyModel(); const judgeRetry = { ...input, controlJobId: "judge-retry" };
    m.job.mockResolvedValue({ ...job, id: judgeRetry.controlJobId });
    expect((await planMissionStep(judgeRetry, 0)).decision.action).toBe("run-campaign");
  });
  it("remeasures expired Visible and Hidden observations while keeping the checkpoint and physical Candidate", async () => {
    stored = project(); healthyModel();
    const exp = await runServerMissionExperiment(stored); stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(exp.project)));
    m.ai.mockRejectedValueOnce(new Error("Hidden Judge unavailable"));
    await executeServerControlStep(input, buildServerHarnessPlan(stored), 0);
    const candidate = structuredClone(stored.candidates[0]), writes = m.put.mock.calls.length, executions = m.browser.mock.calls.length;
    const retry = { ...input, controlJobId: "new-control" }; m.job.mockResolvedValue({ ...job, id: retry.controlJobId });
    vi.setSystemTime(new Date(Date.parse(at) + 11 * 60_000));
    const plan = await planMissionStep(retry, 0);
    expect(await executeServerControlStep(retry, plan, 0)).toEqual({ control: "continue" });
    expect(stored.candidates[0]).toEqual(candidate);
    expect(stored.campaign.checkpoint?.completedPhase).toBe("validation");
    expect(m.put).toHaveBeenCalledTimes(writes);
    expect(m.browser).toHaveBeenCalledTimes(executions + 3);
  });

  it("does not probe or replan a rebound digest, changed paper or terminal control", async () => {
    for (const kind of ["sha", "paper", "target", "protected", "editable", "metric", "terminal"]) {
      stored = checkpointServerMainFlowWait(legacy(), "original-control");
      if (kind === "sha") stored.campaign.serverRecoveryWait!.inputFingerprint = "f".repeat(64);
      if (kind === "paper") stored.hiddenEvalSuite[0]!.input += " changed";
      if (kind === "target") stored.targetConnection.connectionId += " changed";
      if (kind === "protected") stored.protectedItems.push("new protected contract");
      if (kind === "editable") stored.editableItems.push("new editable contract");
      if (kind === "metric") stored.metrics.push({ key: "accuracy", label: "current target", value: 60, unit: "%", target: 99, direction: "higher" });
      m.probe.mockClear(); m.save.mockClear();
      m.job.mockResolvedValue({ ...job, ...(kind === "terminal" ? { status: "completed" } : {}) });
      if (kind === "terminal") await expect(planMissionStep(input, 0)).rejects.toThrow("控制 Job 不再活动");
      else expect((await planMissionStep(input, 0)).decision.action).toBe("wait-human");
      expect(m.probe).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
    }
  });

  it.each(["cancelled", "budget"])("rechecks %s between recovery planning and execution", async kind => {
    stored = checkpointServerMainFlowWait(legacy(), "original-control");
    const plan = await planMissionStep(input, 0);
    if (kind === "cancelled") m.job.mockResolvedValue({ ...job, status: "cancelled" });
    else stored.campaign.stopCriteria.maxEstimatedCost = 0;
    m.browser.mockClear(); m.ai.mockClear(); m.save.mockClear();
    await expect(executeServerControlStep(input, plan, 0)).rejects.toThrow(kind === "cancelled" ? "控制 Job" : "运行条件");
    expect(m.browser).not.toHaveBeenCalled(); expect(m.ai).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it("explicitly remeasures legacy Plan, archives old evidence once and generates a new proposal", async () => {
    stored = legacy(); const old = structuredClone(stored); healthyModel();
    const fresh = { ...input, freshBaseline: { sourceUpdatedAt: stored.updatedAt, inputFingerprint: serverMainFlowRecoveryDigest(stored) } };
    const plan = await planMissionStep(fresh, 0);
    expect(stored.baselineRun).toMatchObject({ status: "idle", runs: [] });
    expect(stored.campaign.checkpoint).toBeUndefined();
    const archived = m.append.mock.calls.find(c => c[0].payload.action === "remeasure-current-input")![0];
    expect(archived.payload.baselineRun).toEqual(old.baselineRun);
    const firstId = stored.baselineRun.id;
    await planMissionStep(fresh, 0);
    expect(stored.baselineRun.id).toBe(firstId);
    expect(m.append.mock.calls.filter(c => c[0].payload.action === "remeasure-current-input")).toHaveLength(1);
    expect(await executeServerControlStep(fresh, plan, 0)).toEqual({ control: "continue" });
    expect(stored.baselineRun.id).not.toBe(old.baselineRun.id);
    expect(m.browser.mock.calls.some(c => !c[2] && c[1][0].id === "V1")).toBe(true);
    for (let i = 1; i <= 3 && stored.candidates.length === 0; i++) {
      const next = await planMissionStep(fresh, i); await executeServerControlStep(fresh, next, i);
    }
    expect(stored.candidates.map(c => c.id)).toEqual(["fresh-candidate"]);
    expect(stored.evalSuite).toEqual(old.evalSuite); expect(stored.hiddenEvalSuite).toEqual(old.hiddenEvalSuite);
    expect(stored.sourceArtifacts).toEqual(old.sourceArtifacts);
    expect(stored.roundHistory).toEqual(old.roundHistory);
    expect(stored.campaign.estimatedCost).toBe(old.campaign.estimatedCost);
    expect(stored.campaign.startedAt).toBe(old.campaign.startedAt);
  });

  it("does not reopen an unbound legacy control-AI wait that already owns Candidate evidence", async () => {
    stored = project(); stored.campaign.status = "paused"; stored.stage = "experiment";
    stored.campaign.stopReason = "Server AI unavailable";
    stored.attentionRequests = [{ id: "server-ai-capability-server-checkpoint-legacy", type: "capability", status: "pending",
      blocking: true, title: "AI unavailable", reason: stored.campaign.stopReason, stage: stored.stage,
      riskLevel: "medium", questions: [], criterionIds: [], createdAt: at }];
    m.probe.mockClear(); m.save.mockClear();
    expect((await planMissionStep(input, 0)).decision.action).toBe("wait-human");
    expect(m.probe).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it("does not replace old evidence when archive persistence fails or the requested input changed", async () => {
    stored = legacy(); const old = structuredClone(stored);
    const fresh = { ...input, freshBaseline: { sourceUpdatedAt: stored.updatedAt, inputFingerprint: serverMainFlowRecoveryDigest(stored) } };
    m.append.mockRejectedValueOnce(new Error("archive unavailable"));
    await expect(planMissionStep(fresh, 0)).rejects.toThrow("archive unavailable");
    expect(stored).toEqual(old); expect(m.save).not.toHaveBeenCalled();
    stored.hiddenEvalSuite[0]!.input += " changed";
    await expect(planMissionStep(fresh, 0)).rejects.toThrow("当前输入");
    expect(m.save).not.toHaveBeenCalled();
  });
});


describe("recovery persistence and Safety boundaries", () => {
  it("replays the identical archive event after a Mission CAS failure before applying fresh measurement", async () => {
    stored = legacy(); const old = structuredClone(stored);
    const fresh = { ...input, freshBaseline: { sourceUpdatedAt: stored.updatedAt, inputFingerprint: serverMainFlowRecoveryDigest(stored) } };
    const committedEvents = new Map<string, string>();
    m.append.mockImplementation(async (event: { id: string; payload: { action?: string } }) => {
      const wire = JSON.stringify(event), prior = committedEvents.get(event.id);
      if (prior) expect(wire).toBe(prior);
      else committedEvents.set(event.id, wire);
    });
    m.save.mockRejectedValueOnce(new Error("Mission CAS conflict"));
    await expect(planMissionStep(fresh, 0)).rejects.toThrow("CAS conflict");
    expect(stored).toEqual(old);
    const archivedBefore = [...committedEvents.values()].filter(wire => JSON.parse(wire).payload.action === "remeasure-current-input");
    expect(archivedBefore).toHaveLength(1);
    await planMissionStep(fresh, 0);
    const archiveCalls = m.append.mock.calls.filter(c => c[0].payload.action === "remeasure-current-input");
    expect(archiveCalls).toHaveLength(2); expect(archiveCalls[0]![0]).toEqual(archiveCalls[1]![0]);
    expect(stored.campaign.freshBaselineRestartControlJobId).toBe(input.controlJobId);
    expect(stored.baselineRun.status).toBe("idle");
    expect([...committedEvents.values()].filter(wire => JSON.parse(wire).payload.action === "remeasure-current-input")).toHaveLength(1);
  });

  it("keeps a saved Safety failure on an artifact repair wait even with healthy model configuration", async () => {
    stored = project(); healthyModel();
    const exp = await runServerMissionExperiment(stored); stored = EvolveProjectSchema.parse(JSON.parse(JSON.stringify(exp.project)));
    await executeServerControlStep(input, buildServerHarnessPlan(stored), 0);
    stored.validationRun.evaluation = { ...stored.validationRun.evaluation!, safety: "FAIL" };
    stored.campaign.status = "paused"; stored.campaign.stopReason = "[server-campaign-artifact-repair-pending] repair model unavailable";
    stored = checkpointServerMainFlowWait(stored, "original-control");
    m.probe.mockClear(); m.save.mockClear();
    expect((await planMissionStep(input, 0)).decision.action).toBe("wait-human");
    expect(m.probe).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
});
describe("fresh measurement start identity", () => {
  it("reuses a lost response after the fresh intent has already advanced the Mission", async () => {
    stored = legacy(); const old = structuredClone(stored);
    const jobs = new Map<string, typeof job>();
    m.lookup.mockImplementation(async (key: string) => [...jobs.values()].find(j => j.idempotencyKey === key));
    m.create.mockImplementation(async (j: typeof job) => {
      const prior = [...jobs.values()].find(x => x.idempotencyKey === j.idempotencyKey);
      if (prior) return { job: prior, reused: true };
      jobs.set(j.id, j); return { job: j, reused: false };
    });
    m.start.mockImplementation(async () => ({ runId: "fresh-run" }));
    m.bind.mockImplementation(async (id: string, _generation: number, runId: string) => {
      const bound = { ...jobs.get(id)!, outputRef: runId }; jobs.set(id, bound); return bound;
    });
    m.job.mockImplementation(async (id: string) => jobs.get(id));
    m.jobPut.mockImplementation(async (j: typeof job) => { jobs.set(j.id, j); });
    let lose = true;
    const fetch = vi.fn(async (path: string, init: RequestInit) => {
      const response = await startRoute(mockEvent(new Request("http://localhost" + path, init)));
      if (lose) { lose = false; throw new Error("lost acknowledgement"); }
      return new Response(JSON.stringify(response), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(retryStoredServerExperiment(old)).rejects.toThrow("lost acknowledgement");
    const fresh = EvolutionWorkflowRunInputSchema.parse(m.start.mock.calls[0]![1][0]);
    await planMissionStep(fresh, 0);
    expect(stored.stage).toBe("baseline");
    expect((await retryStoredServerExperiment(old)).reused).toBe(true);
    expect(m.start).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1].body).toBe(fetch.mock.calls[1]![1].body);
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toMatchObject({
      intent: "remeasure-current-input", expectedMissionUpdatedAt: old.updatedAt });
  });
  it.each(["changed-version", "candidate", "approval"])( "rejects %s before creating a new Job", async kind => {
    stored = legacy();
    if (kind === "candidate") stored.candidates = project().candidates;
    if (kind === "approval") stored.attentionRequests = [{ id: "authorization", type: "authorization", status: "pending",
      blocking: true, title: "Approval", reason: "approve", stage: "plan", riskLevel: "high", questions: [], criterionIds: [], createdAt: at }];
    const response = await startRoute(mockEvent(new Request("http://localhost/api/evolution/start", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ missionId: stored.id, idempotencyKey: "fresh-key",
        intent: "remeasure-current-input", expectedMissionUpdatedAt: kind === "changed-version" ? "other" : stored.updatedAt }) })));
    expect(response).toHaveProperty("error"); expect(m.create).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
});
