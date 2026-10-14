// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CandidateSchema, EvolveProjectSchema, EvolutionJobSchema, InputUnderstandingSchema, missionEnvelope,
  type EvaluateAiResult, type EvolveProject, type EvolutionEvent, type EvolutionWorkflowRunInput,
} from "@evolution/contracts";
import { LIVE_TARGET_OBSERVATION_MAX_AGE_MS, type OriginalHtmlBaselineDiagnosticBinding } from "@evolution/core";
import { buildServerHarnessPlan, canReuseServerBaseline, runServerBaseline, type ServerBaselineOutcome } from "@evolution/harness";
import type { ServerDiagnosticContinuation } from "./server-diagnostic-continuation";
import { executeServerControlStep } from "../../../../workflows/evolution-mission/steps";

// Synthetic local regression only. Real Harness Baseline/preparation run here; all external
// storage/model and downstream execution ports are mocked. This is not real Mission acceptance.
const m = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), envelope: vi.fn(), getJob: vi.fn(), putJob: vi.fn(),
  append: vi.fn(), readEvent: vi.fn(), ai: vi.fn(), route: vi.fn(), baseline: vi.fn(), binding: vi.fn(),
  experiment: vi.fn(), holdout: vi.fn(), acceptance: vi.fn(), unavailable: class extends Error {} }));
vi.mock("./production-runtime", () => ({ getServerProductionRuntime: () => ({
  missions: { get: m.get, save: m.save }, jobs: { get: m.getJob, put: m.putJob }, events: { append: m.append },
}), getServerMissionEnvelope: m.envelope, getServerEventById: m.readEvent }));
vi.mock("./server-control-ai", () => ({ requireServerControlAi: async () => undefined,
  runServerControlAi: m.ai, ServerControlAiUnavailableError: m.unavailable }));
vi.mock("./server-ai-connection", () => ({ serverAiConnectionConfigured: async () => true, withServerAiConnection: async (work:()=>Promise<unknown>)=>work() }));
vi.mock("./ai-gateway", () => ({ serverAiScoringRouteFingerprint: m.route }));
vi.mock("./server-baseline", () => ({ runServerMissionBaseline: m.baseline }));
vi.mock("./server-original-html-baseline-diagnostic", () => ({ readServerOriginalHtmlBaselineDiagnosticBinding: m.binding }));
vi.mock("./server-experiment", () => ({ runServerMissionExperiment: m.experiment }));
vi.mock("./server-holdout", () => ({ runServerMissionHoldout: m.holdout }));
vi.mock("./server-artifact-acceptance", () => ({ runServerMissionArtifactAcceptance: m.acceptance }));

const at = "2026-10-14T05:00:00.000Z", route = "synthetic-direct-model-route";
const html = "<!doctype html><html><body><p>Current instructions omit configuration.</p></body></html>";
const physical = { sourceArtifactId: "source", sha256: createHash("sha256").update(html).digest("hex"), byteLength: Buffer.byteLength(html) };
const input: EvolutionWorkflowRunInput = { missionId: "diagnostic-mission", controlJobId: "diagnostic-control", requestedAt: at,
  controlOwnerKey: "workflow-control:diagnostic-mission:synthetic-continuation" };
const owner = { schemaVersion: "server-workflow-control-owner-v1" as const, controlJobId: input.controlJobId,
  operationKey: input.controlOwnerKey!, runId: "synthetic-run", phase: "bound" as const,
  sourceUpdatedAt: at, inputFingerprint: "a".repeat(64), requestedAt: at };
const initialJob = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: input.controlJobId, missionId: input.missionId,
  type: "campaign", status: "running", label: "Synthetic diagnostic continuation", generation: 1,
  idempotencyKey: input.controlOwnerKey, metadata: { runId: owner.runId }, outputRef: owner.runId, createdAt: at, updatedAt: at });

function fixture(): EvolveProject {
  return EvolveProjectSchema.parse({
    id: input.missionId, name: "Synthetic diagnostic loop", objectType: "document", department: "test", version: "V1", currentVersionId: "V1",
    goal: "Complete configuration instructions", evolutionCommand: "Add configuration instructions without losing existing content",
    protectedItems: ["facts"], editableItems: ["instructions"], metrics: [], stage: "baseline", updatedAt: at,
    sourceArtifacts: [{ id: "source", name: "synthetic.html", extension: "html", mimeType: "text/html", role: "target", artifactKind: "document",
      inputMode: "upload", storageRef: "synthetic-original-blob", size: physical.byteLength, parseStatus: "ready", textContent: html, createdAt: at }],
    inputUnderstanding: InputUnderstandingSchema.parse({ status: "ready", confidence: .9 }),
    acceptanceRubric: [
      { id: "CONTENT", title: "Configuration instructions", requirement: "Instructions include configuration details", source: "user-command",
        weight: 82, hardGate: true, judgeType: "llm", validationMethod: "semantic-judge", minScore: 85,
        evidenceExpected: ["Configuration details"], protectedConstraint: false, artifactIds: ["source"], category: "outcome" },
      { id: "SYS-INTEGRITY", title: "成果完整性", requirement: "最终成果必须完整、无截断、无占位符、无未处理 TODO，且不能因进化丢失未授权内容。",
        source: "system-integrity", weight: 8, hardGate: true, judgeType: "integrity", validationMethod: "static-structure", minScore: 95,
        evidenceExpected: ["完整成果", "无 truncation / placeholder / unresolved TODO"], protectedConstraint: true, artifactIds: [], category: "integrity" },
      { id: "READABLE", title: "Readable body", requirement: "Current body contains readable instructions", source: "user-command",
        weight: 10, hardGate: false, judgeType: "structural", validationMethod: "static-structure", minScore: 70,
        evidenceExpected: ["Readable current body"], protectedConstraint: false, artifactIds: ["source"], category: "integrity" },
    ],
    acceptanceRubricState: { status: "ready", summary: "Synthetic complete contract", version: 1, weightTotal: 100,
      uncoveredCriterionIds: [], warnings: [], confirmedAt: at },
    evalSuite: [
      { id: "V1", title: "Current instructions", input: "Read current configuration instructions", expected: ["Configuration details"],
        criterionIds: ["CONTENT"], executionMode: "artifact-runtime", evidenceScope: "product-behavior" },
      { id: "I", title: "Current integrity", input: "Inspect full current file", expected: ["Full readable file"],
        criterionIds: ["SYS-INTEGRITY", "READABLE"], executionMode: "static-evidence", evidenceScope: "implementation" },
    ],
    hiddenEvalSuite: [
      { id: "H1", title: "Hidden instructions", input: "Inspect configuration independently", expected: ["Configuration details"], hidden: true,
        criterionIds: ["CONTENT"], executionMode: "artifact-runtime", evidenceScope: "product-behavior" },
      { id: "H-I", title: "Hidden integrity", input: "Inspect exact paired files", expected: ["No unauthorized loss"], hidden: true,
        criterionIds: ["SYS-INTEGRITY", "READABLE"], executionMode: "static-evidence", evidenceScope: "implementation" },
    ],
    gates: [{ id: "target-ready", status: "approved", approvedAt: at }, { id: "experiment-ready", status: "pending" },
      { id: "artifact-ready", status: "pending" }, { id: "release-ready", status: "pending" }],
    baselineRun: { id: "initial-baseline", status: "idle", suiteName: "Synthetic core paper", totalCases: 2 },
    problems: [], candidates: [], experimentPolicy: {}, lessons: [],
    experimentRun: { id: "initial-experiment", status: "idle" }, validationRun: { id: "initial-hidden", status: "idle" },
    artifactAcceptance: { id: "initial-acceptance", status: "idle", hardGatePass: false },
    release: { status: "idle", history: [] }, targetConnection: { adapter: "artifact", connectionId: "artifact", status: "connected" },
    campaign: { status: "running", currentRound: 0, candidateCount: 1, searchMode: "focused", autoApproveOfflineExperiment: true,
      stopCriteria: { maxRounds: 3, patienceRounds: 2, stopWhenAcceptanceMet: true, stopOnSafetyFailure: true, stopWhenMetricTargetsMet: false },
      serverControlOwner: owner },
  });
}
function binding(): OriginalHtmlBaselineDiagnosticBinding {
  return { schemaVersion: "original-html-baseline-diagnostic-binding-v1", binding: {
    missionId: input.missionId, testCaseId: "I", criterionId: "SYS-INTEGRITY", paperSha256: "b".repeat(64),
    original: physical, executed: { ...physical }, subject: { kind: "current", versionId: "V1" },
  } };
}
const judged: EvaluateAiResult = {
  accuracy: 72, evidence: 95, riskCoverage: 85, completeness: 72, safety: "PASS", notes: [], failures: ["Configuration details absent"],
  cases: [{ testCaseId: "V1", accuracy: 72, evidence: 95, completeness: 72, reason: "Current instructions omit configuration" },
    { testCaseId: "I", accuracy: 95, evidence: 95, completeness: 95, reason: "Full synthetic file inspected" }],
  criteria: [{ criterionId: "CONTENT", score: 72, pass: false, evidence: ["V1: Current instructions omit configuration"], gaps: ["Configuration details absent"], testCaseIds: ["V1"] },
    { criterionId: "SYS-INTEGRITY", score: 95, pass: true, evidence: ["I: Full current file"], gaps: [], testCaseIds: ["I"] },
    { criterionId: "READABLE", score: 95, pass: true, evidence: ["I: Readable current body"], gaps: [], testCaseIds: ["I"] }],
};
const plannedCandidate = CandidateSchema.parse({ id: "C1", name: "Synthetic configuration proposal", change: "Add missing configuration steps",
  status: "draft", artifactBuildStatus: "idle", safety: "REVIEW", patches: [{ id: "P1", component: "code", operation: "update", target: "source",
    artifactId: "source", content: "Add configuration instructions", rationale: "Address observed missing configuration" }],
  designRationale: { sourceEvidence: ["Current instructions omit configuration"], commandAlignment: "Add configuration instructions",
    mechanism: "Configuration details become observable in the file", coveredCriteria: ["CONTENT"], protectedCompliance: "Preserve existing facts",
    falsifier: "Hidden configuration evidence remains absent" } });
let persisted: EvolveProject, job: typeof initialJob, events: Map<string, EvolutionEvent>, measured: ServerBaselineOutcome | undefined;
function assertUnpromotedBaseline(expected?: EvolveProject["baselineRun"]) {
  if (expected) expect(persisted.baselineRun).toEqual(expected);
  expect(persisted.baselineRun.result?.criterionScores?.find(row => row.criterionId === "SYS-INTEGRITY"))
    .toMatchObject({ verificationStatus: "partial", pass: false });
  expect(canReuseServerBaseline(persisted, route, Date.now())).toBe(false);
  expect(persisted.artifactAcceptance.status).not.toBe("passed");
  expect(persisted.artifactAcceptance.hardGatePass).toBe(false);
  expect(JSON.stringify(persisted)).not.toContain("diagnosticContinuation");
  expect(JSON.stringify([...events.values()])).not.toContain("diagnosticContinuation");
  expect(JSON.stringify(job)).not.toContain("diagnosticContinuation");
}
function campaignPlan() {
  const plan = buildServerHarnessPlan(persisted);
  expect(plan.decision.action).toBe("run-campaign");
  return plan;
}
async function firstContinuation() {
  const first = await executeServerControlStep(input, campaignPlan(), 0);
  expect(first.control).toBe("continue");
  expect(first.diagnosticContinuation).toBeDefined();
  expect(measured?.ready).toBe(true); expect(measured?.diagnosticEligibility).toBeDefined();
  expect(persisted.campaign.checkpoint?.completedPhase).toBe("problem");
  assertUnpromotedBaseline();
  return first.diagnosticContinuation!;
}
function assertNoLaterPorts() {
  expect(m.baseline).toHaveBeenCalledOnce(); expect(m.ai).not.toHaveBeenCalled();
  expect(m.experiment).not.toHaveBeenCalled(); expect(m.holdout).not.toHaveBeenCalled(); expect(m.acceptance).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  persisted = fixture(); job = structuredClone(initialJob); events = new Map(); measured = undefined;
  m.get.mockImplementation(async () => structuredClone(persisted));
  m.envelope.mockImplementation(async () => missionEnvelope(structuredClone(persisted), 29));
  m.save.mockImplementation(async (next: EvolveProject) => { persisted = structuredClone(next); });
  m.getJob.mockImplementation(async () => structuredClone(job));
  m.putJob.mockImplementation(async (next: typeof initialJob) => { job = structuredClone(next); });
  m.append.mockImplementation(async (event: EvolutionEvent) => { events.set(event.id, structuredClone(event)); });
  m.readEvent.mockImplementation(async (id: string) => events.get(id));
  m.route.mockResolvedValue(route); m.binding.mockImplementation(async () => structuredClone(binding()));
  m.baseline.mockImplementation(async (project: EvolveProject) => {
    measured = await runServerBaseline(project, {
      scoringRouteFingerprint: route, readOriginalHtmlDiagnosticBinding: m.binding,
      buildCurrentArtifactContext: async () => [{ id: "source", content: html, artifactSha256: physical.sha256, truncated: false }],
      executeStoredEvidence: async ({ testCase }) => ({ testCaseId: testCase.id, artifactHash: physical.sha256,
        output: "Complete synthetic current HTML statically indexed; runtime remains unverified", latencyMs: 1, cost: 0, verificationStatus: "verified", trace: [] }),
      executeSemanticBatch: async ({ testCases }) => ({ results: testCases.map(testCase => ({ testCaseId: testCase.id,
        output: "Current instructions omit configuration", trace: [] })) }),
      judge: async () => structuredClone(judged),
    });
    return measured;
  });
  m.ai.mockImplementation(async (operation: string, payload: unknown) => {
    if (operation === "diagnose") return { problemId: (payload as { problem: { id: string } }).problem.id,
      rootCause: "Configuration details are absent", summary: "Add the missing instructions", affectedComponent: "source", confidence: .9,
      evidence: ["Current instructions omit configuration"], counterEvidence: [], falsifier: "Configuration still absent", suggestedScopes: ["code"], trace: [] };
    if (operation === "plan") return { candidates: [structuredClone(plannedCandidate)], recommendedCandidateIds: ["C1"],
      summary: "Synthetic grounded proposal", experimentDesign: ["Same paper comparison", "Independent hidden verification"] };
    throw new Error("Unexpected synthetic AI phase: " + operation);
  });
  m.experiment.mockImplementation(async (project: EvolveProject) => {
    const next = { ...project, stage: "experiment" as const, campaign: { ...project.campaign, checkpoint: { round: 1, completedPhase: "experiment" as const, at } },
      experimentRun: { ...project.experimentRun, status: "completed" as const, winnerId: "C1" } };
    return { control: "continue", project: next, reason: "Mock experiment branch only", readyForHoldout: true, winnerId: "C1", builtCount: 0, buildFailureCount: 0 };
  });
  m.holdout.mockImplementation(async (project: EvolveProject) => {
    const validation = { ...project.validationRun, status: "completed" as const, candidateId: "C1", recommendation: "hold" as const };
    return { control: "continue", project: { ...project, stage: "validation", validationRun: validation,
      campaign: { ...project.campaign, checkpoint: { round: 1, completedPhase: "validation", at } } },
      validation, readyForArtifactAcceptance: false, evidenceIncomplete: true, reason: "Mock Hidden branch only; no verified execution" };
  });
  m.acceptance.mockImplementation(async (project: EvolveProject) => {
    const reason = "[server-campaign-artifact-acceptance-evidence-pending] Synthetic whole protection remains unverified";
    return { control: "stop", project: { ...project, artifactAcceptance: { ...project.artifactAcceptance,
      status: "unverified", candidateId: "C1", hardGatePass: false, summary: reason }, campaign: { ...project.campaign, status: "paused", stopReason: reason } },
      accepted: false, repaired: false, championChanged: false, reason };
  });
});
afterEach(() => vi.useRealTimers());

describe("internal fresh original diagnostic continuation through durable Campaign phases", () => {
  it("measures once through Problem, Diagnosis, Plan, Experiment, Hidden and pending Acceptance without granting strict reuse", async () => {
    let context: ServerDiagnosticContinuation | undefined = await firstContinuation();
    const baseline = structuredClone(persisted.baselineRun), deadline = context.observedAt;
    const generations = new Set([context.generationSha256]);
    const checkpoints = ["diagnose", "plan", "experiment", "validation"];
    for (let iteration = 1; iteration <= 4; iteration++) {
      const outcome = await executeServerControlStep(input, campaignPlan(), iteration, context);
      expect(outcome.control).toBe("continue"); context = outcome.diagnosticContinuation;
      expect(context).toBeDefined(); expect(context!.observedAt).toBe(deadline);
      generations.add(context!.generationSha256);
      expect(persisted.campaign.checkpoint?.completedPhase).toBe(checkpoints[iteration - 1]);
      assertUnpromotedBaseline(baseline);
    }
    const final = await executeServerControlStep(input, campaignPlan(), 5, context);
    expect(final).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(final.diagnosticContinuation).toBeUndefined();
    expect(m.baseline).toHaveBeenCalledOnce(); expect(m.binding).toHaveBeenCalledTimes(7);
    expect(m.ai.mock.calls.map(call => call[0])).toEqual(["diagnose", "plan"]);
    expect(m.experiment).toHaveBeenCalledOnce(); expect(m.holdout).toHaveBeenCalledOnce(); expect(m.acceptance).toHaveBeenCalledOnce();
    expect(generations.size).toBe(5); assertUnpromotedBaseline(baseline);
  });
  it("does not reconstruct authority from a saved partial Baseline when the private SDK context is absent", async () => {
    await firstContinuation(); const prior = persisted.baselineRun.id;
    vi.setSystemTime(Date.parse(at) + 1000);
    await executeServerControlStep(input, campaignPlan(), 1);
    expect(m.baseline).toHaveBeenCalledTimes(2); expect(persisted.baselineRun.id).not.toBe(prior);
    expect(m.ai).not.toHaveBeenCalled(); assertUnpromotedBaseline();
  });
  it.each(["goal", "visible", "hidden", "rubric", "source", "profile", "policy", "baseline", "candidate", "checkpoint"])("stops a changed %s generation without repeating measurement or entering later phases", async kind => {
    const context = await firstContinuation(), plan = campaignPlan(), baseline = structuredClone(persisted.baselineRun);
    if (kind === "goal") persisted.goal += " changed";
    if (kind === "visible") persisted.evalSuite[0]!.expected.push("New visible requirement");
    if (kind === "hidden") persisted.hiddenEvalSuite[0]!.input += " changed";
    if (kind === "rubric") persisted.acceptanceRubric[0]!.requirement += " changed";
    if (kind === "source") persisted.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "profile") persisted.aiProfile = { mode: "project" };
    if (kind === "policy") persisted.experimentPolicy.batchSize++;
    if (kind === "baseline") persisted.baselineRun.runs[0]!.output += " changed";
    if (kind === "candidate") persisted.candidates = [structuredClone(plannedCandidate)];
    if (kind === "checkpoint") {
      persisted.campaign.checkpoint = { round: 1, completedPhase: "experiment", at };
      persisted.experimentRun = { ...persisted.experimentRun, status: "completed", winnerId: "C1" };
    }
    const snapshot = structuredClone(persisted.baselineRun);
    const outcome = await executeServerControlStep(input, plan, 1, context);
    expect(outcome).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(outcome.diagnosticContinuation).toBeUndefined();
    expect(persisted.baselineRun).toEqual(snapshot); if (kind !== "baseline") expect(snapshot).toEqual(baseline);
    expect(persisted.campaign.status).toBe("paused"); assertNoLaterPorts(); assertUnpromotedBaseline();
  });
  it.each(["route", "expired", "context-run", "context-operation", "physical", "read-deadline", "read-route"])("refuses %s without extending the original observation", async kind => {
    const context = await firstContinuation(), plan = campaignPlan(), baseline = structuredClone(persisted.baselineRun);
    if (kind === "route") m.route.mockResolvedValue("other-route");
    if (kind === "expired") vi.setSystemTime(Date.parse(context.observedAt) + LIVE_TARGET_OBSERVATION_MAX_AGE_MS);
    if (kind === "context-run") context.runId = "foreign-run";
    if (kind === "context-operation") context.operationKey = "foreign-operation";
    if (kind === "physical") m.binding.mockImplementation(async () => { const b = binding(); b.binding.executed.sha256 = "c".repeat(64); return b; });
    if (kind === "read-deadline") m.binding.mockImplementation(async () => { vi.setSystemTime(Date.parse(context.observedAt) + LIVE_TARGET_OBSERVATION_MAX_AGE_MS); return binding(); });
    if (kind === "read-route") m.binding.mockImplementation(async () => { m.route.mockResolvedValue("other-route-after-read"); return binding(); });
    const outcome = await executeServerControlStep(input, plan, 1, context);
    expect(outcome).toMatchObject({ control: "stop", result: { status: "waiting-action" } });
    expect(outcome.diagnosticContinuation).toBeUndefined(); assertNoLaterPorts(); assertUnpromotedBaseline(baseline);
  });
  it.each(["owner", "job-run", "read-owner"])("retains the real control owner guard for %s", async kind => {
    const context = await firstContinuation(), plan = campaignPlan(), beforeSaves = m.save.mock.calls.length;
    if (kind === "owner") persisted.campaign.serverControlOwner!.controlJobId = "foreign-control";
    if (kind === "job-run") { job.outputRef = "foreign-run"; job.metadata = { runId: "foreign-run" }; }
    if (kind === "read-owner") m.binding.mockImplementation(async () => { persisted.campaign.serverControlOwner!.controlJobId = "foreign-control"; return binding(); });
    await expect(executeServerControlStep(input, plan, 1, context)).rejects.toThrow();
    expect(m.save).toHaveBeenCalledTimes(beforeSaves); assertNoLaterPorts();
  });
  it.each(["safety", "target-ready", "budget"])("does not use continuation to bypass a changed %s pause", async kind => {
    const context = await firstContinuation(), plan = campaignPlan();
    if (kind === "safety") persisted.baselineRun.result!.safety = "FAIL";
    if (kind === "target-ready") persisted.gates.find(gate => gate.id === "target-ready")!.status = "blocked";
    if (kind === "budget") { persisted.campaign.stopCriteria.maxEstimatedCost = 1; persisted.campaign.estimatedCost = 2; }
    const baseline = structuredClone(persisted.baselineRun);
    const outcome = await executeServerControlStep(input, plan, 1, context);
    expect(outcome.control).toBe("stop"); expect(outcome.diagnosticContinuation).toBeUndefined();
    expect(persisted.campaign.status).toBe("paused"); assertNoLaterPorts(); assertUnpromotedBaseline(baseline);
  });

  it("rechecks fixed TTL after the final asynchronous owner Job read",async()=>{
    const context=await firstContinuation(), baseline=structuredClone(persisted.baselineRun);
    vi.setSystemTime(Date.parse(context.observedAt)+LIVE_TARGET_OBSERVATION_MAX_AGE_MS-1);
    let reads=0;
    m.getJob.mockImplementation(async()=>{if(++reads===2)vi.setSystemTime(Date.parse(context.observedAt)+LIVE_TARGET_OBSERVATION_MAX_AGE_MS);return structuredClone(job);});
    const outcome=await executeServerControlStep(input,campaignPlan(),1,context);
    expect(outcome.control).toBe("stop");expect(outcome.result?.reason).toContain("observation-expired");
    assertNoLaterPorts();assertUnpromotedBaseline(baseline);
  });
  it("rechecks wall budget after physical I/O without extending a still-valid TTL",async()=>{
    persisted.campaign.stopCriteria.maxWallMinutes=1;
    const context=await firstContinuation(), baseline=structuredClone(persisted.baselineRun);
    m.binding.mockImplementation(async()=>{vi.setSystemTime(Date.parse(context.observedAt)+60_000);return binding();});
    const outcome=await executeServerControlStep(input,campaignPlan(),1,context);
    expect(outcome.control).toBe("stop");expect(outcome.result?.reason).toContain("policy-boundary");
    assertNoLaterPorts();assertUnpromotedBaseline(baseline);
  });

  it("blocks a changed Candidate during the final route await before any old-generation action",async()=>{
    const context=await firstContinuation(), beforeSaves=m.save.mock.calls.length;
    let routeReads=0;
    m.route.mockImplementation(async()=>{if(++routeReads===2)persisted.candidates=[structuredClone(plannedCandidate)];return route;});
    await expect(executeServerControlStep(input,campaignPlan(),1,context)).rejects.toThrow("完整输入或断点");
    expect(m.save).toHaveBeenCalledTimes(beforeSaves);expect(persisted.candidates.map(candidate=>candidate.id)).toEqual(["C1"]);
    assertNoLaterPorts();assertUnpromotedBaseline();
  });
  it("rechecks a newly minted carrier after slow baseline persistence before Problem",async()=>{
    m.putJob.mockImplementation(async(next:typeof initialJob)=>{job=structuredClone(next);
      if(next.progress?.percent===30)vi.setSystemTime(Date.parse(persisted.baselineRun.completedAt!)+LIVE_TARGET_OBSERVATION_MAX_AGE_MS);});
    const outcome=await executeServerControlStep(input,campaignPlan(),0);
    expect(outcome.control).toBe("stop");expect(outcome.result?.reason).toContain("observation-expired");
    expect(persisted.campaign.checkpoint?.completedPhase).toBe("baseline");expect(persisted.problems).toEqual([]);
    assertNoLaterPorts();assertUnpromotedBaseline();
  });
});
