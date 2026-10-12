// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolveProjectSchema, InputUnderstandingSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { campaignScoringInputFingerprint, evidenceFingerprint } from "@evolution/core";
import { acceptedPackageFixture, experimentRecoveryAt as at } from "@evolution/testkit";
import { canRecoverServerArtifactReadbackWithoutAi } from "./server-artifact-readback-recovery";
import { serverBaselineFingerprint } from "./server-baseline";
import { exactServerHoldoutSuite } from "./server-holdout-preflight";
import { serverHoldoutExecutionEvidenceFingerprint } from "./server-holdout-recovery";
import { recoverServerMainFlowWait, serverMainFlowContextFingerprint, serverMainFlowRecoveryWire } from "./server-main-flow-wait";

const route = "b".repeat(64), now = Date.parse(at);
function seal(project: EvolveProject) {
  project.campaign.serverRecoveryWait!.contextFingerprint = serverMainFlowContextFingerprint(project);
  project.campaign.serverRecoveryWait!.inputFingerprint = createHash("sha256").update(serverMainFlowRecoveryWire(project)).digest("hex");
  return project;
}
function fixture(live = false, format: "markdown" | "html" = "markdown") {
  const p = acceptedPackageFixture(false).project;
  p.candidates = [p.candidates[0]!]; p.selectedCandidateIds = [p.candidates[0]!.id];
  // The positive readback fixture is a known Markdown file. Its protected
  // structure obligation retains the non-HTML policy; HTML whole protection
  // requires independent complete observations and is covered negatively below.
  if (format === "markdown") {
    const source = p.sourceArtifacts[0]!, snapshot = p.candidates[0]!.artifactSnapshots[0]!;
    source.name = "original.md"; source.extension = "md"; source.mimeType = "text/markdown";
    source.textContent = "# Original input\n"; source.size = new TextEncoder().encode(source.textContent).byteLength;
    snapshot.name = "current-evolved.md"; snapshot.mimeType = "text/markdown";
    snapshot.content = "# Newly accepted actual content\n";
    const digest = createHash("sha256").update(snapshot.content).digest("hex");
    snapshot.contentHash = digest;
    snapshot.frozenArtifact = { ...snapshot.frozenArtifact!, name: snapshot.name, mimeType: snapshot.mimeType,
      snapshotHash: digest, sha256: digest, size: new TextEncoder().encode(snapshot.content).byteLength,
      blobId: "server-candidate:" + digest };
  }
  p.inputUnderstanding = InputUnderstandingSchema.parse({ status: "ready", confidence: .9 });
  p.protectedItems = ["preserve document structure"];
  p.acceptanceRubric = ["CONTENT", "SAFETY"].map((id, i) => ({
    id, title: id, requirement: "verified current requirement", source: i ? "protected-item" as const : "user-command" as const,
    weight: i ? 20 : 80, hardGate: true, judgeType: "llm" as const, validationMethod: "executable-test" as const,
    minScore: 80, evidenceExpected: ["actual observation"], protectedConstraint: Boolean(i), artifactIds: ["source"], category: i ? "protected" as const : "outcome" as const,
  }));
  p.acceptanceRubricState = { status: "ready", summary: "ready", version: 1, weightTotal: 100, uncoveredCriterionIds: [], warnings: [], confirmedAt: at };
  const test = TestCaseSchema.parse({ id: "V1", title: "Visible", input: "inspect exact file", expected: ["verified"],
    criterionIds: ["CONTENT", "SAFETY"], executionMode: live ? "external-runner" : "static-evidence" });
  p.evalSuite = [test]; p.hiddenEvalSuite = [{ ...test, id: "H1", hidden: true }];
  const result = structuredClone(p.baselineRun.result!);
  result.criterionScores = p.acceptanceRubric.map(c => ({ criterionId: c.id, score: 92, pass: true, verificationStatus: "verified",
    evidence: ["actual observation"], gaps: [], testCaseIds: ["H1"] }));
  p.baselineRun = { ...p.baselineRun, completedAt: at, runs: [{ testCaseId: "V1", output: "current observation", verificationStatus: "verified", latencyMs: 1, cost: 0, trace: [] }], result };
  p.experimentRun = { ...p.experimentRun, status: "completed", winnerId: p.candidates[0]!.id };
  p.validationRun = { ...p.validationRun, id: "validation-server-r1", completedAt: at, evaluation: structuredClone(result),
    baselineEvaluation: structuredClone(result), baselineObservedAt: now, plannedCases: 1, executedCases: 1, executionArtifactFingerprint: "c".repeat(64) };
  p.artifactAcceptance = { ...p.artifactAcceptance, status: "unverified", hardGatePass: false, frozenArtifacts: undefined,
    acceptedAt: undefined, summary: "frozen readback unavailable", results: [] };
  p.gates = [{ id: "target-ready", status: "approved", approvedAt: at }, { id: "artifact-ready", status: "pending" }, { id: "release-ready", status: "pending" }];
  p.campaign = { ...p.campaign, status: "paused", currentRound: 0, noImprovementRounds: 0, estimatedCost: .1, startedAt: at,
    stopReason: "[server-campaign-artifact-acceptance-evidence-pending] frozen readback unavailable",
    scoringInputFingerprint: campaignScoringInputFingerprint(p), scoringRouteFingerprint: route,
    stopCriteria: { ...p.campaign.stopCriteria, maxRounds: 3, patienceRounds: 3, maxEstimatedCost: 10, maxWallMinutes: 30 },
    checkpoint: { round: 1, completedPhase: "validation", at } };
  p.baselineRun.measurementFingerprint = serverBaselineFingerprint(p, route);
  p.validationRun.baselineContextFingerprint = serverBaselineFingerprint({ ...p, evalSuite: exactServerHoldoutSuite(p) }, route);
  p.validationRun.evidenceFingerprint = evidenceFingerprint(p, p.candidates[0]!);
  p.validationRun.executionEvidenceFingerprint = serverHoldoutExecutionEvidenceFingerprint(p.validationRun);
  p.campaign.serverRecoveryWait = { schemaVersion: "server-campaign-recovery-v1", controlJobId: "original-control", missionId: p.id,
    stage: p.stage, round: 1, marker: "artifact-acceptance-evidence-pending", reason: p.campaign.stopReason!,
    contextFingerprint: "", inputFingerprint: "a".repeat(64), status: "waiting" };
  return EvolveProjectSchema.parse(seal(p));
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at)); });
afterEach(() => vi.useRealTimers());

describe("local artifact readback recovery eligibility", () => {
  it.each([false, true])("does not use HTML whole protection scores to authorize an offline readback (live=%s)", live => {
    const p = fixture(live, "html"), before = structuredClone(p);
    expect(p.sourceArtifacts[0]!.extension).toBe("html");
    expect(p.validationRun.evaluation!.criterionScores!.every(score => score.pass)).toBe(true);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
    expect(p).toEqual(before);
  });
  it.each([false, true])("accepts a complete same-route Gate F boundary while recovering=%s without persisting proof", recovering => {
    const p = recovering ? recoverServerMainFlowWait(fixture(), at, "new-control") : fixture();
    const before = structuredClone(p), acceptance = p.artifactAcceptance;
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route)).toBe(true);
    expect(p).toEqual(before); expect(p.artifactAcceptance).toBe(acceptance);
    expect(p.artifactAcceptance.status).toBe("unverified"); expect(p.artifactAcceptance.acceptedAt).toBeUndefined();
  });
  it("does not impose the live ten-minute expiry on a static frozen file", () => {
    const p = fixture(), later = now + 11 * 60_000;
    vi.setSystemTime(later);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, later)).toBe(true);
  });
  it.each(["visible", "hidden"])("rejects expired live %s observation even with a recent Judge completion", side => {
    const p = fixture(true);
    if (side === "visible") p.baselineRun.completedAt = new Date(now - 10 * 60_000).toISOString();
    else p.validationRun.baselineObservedAt = now - 10 * 60_000;
    p.validationRun.completedAt = at;
    p.validationRun.executionEvidenceFingerprint = serverHoldoutExecutionEvidenceFingerprint(p.validationRun); seal(p);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
  it.each([false, true])("accepts a fresh live boundary while recovering=%s", recovering => {
    const p = recovering ? recoverServerMainFlowWait(fixture(true), at, "new-control") : fixture(true);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now + 60_000)).toBe(true);
  });
  it.each(["visible-future", "hidden-future", "visible-missing", "hidden-missing", "hidden-nan", "hidden-zero"])("rejects %s timestamps", kind => {
    const p = fixture();
    if (kind === "visible-future") p.baselineRun.completedAt = new Date(now + 1).toISOString();
    if (kind === "hidden-future") p.validationRun.baselineObservedAt = now + 1;
    if (kind === "visible-missing") p.baselineRun.completedAt = undefined;
    if (kind === "hidden-missing") p.validationRun.baselineObservedAt = undefined;
    if (kind === "hidden-nan") p.validationRun.baselineObservedAt = NaN;
    if (kind === "hidden-zero") p.validationRun.baselineObservedAt = 0;
    p.validationRun.executionEvidenceFingerprint = serverHoldoutExecutionEvidenceFingerprint(p.validationRun); seal(p);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
  it.each([undefined, "", " ", "changed-route"])("requires a known unchanged configured route (%s)", currentRoute => {
    expect(canRecoverServerArtifactReadbackWithoutAi(fixture(), currentRoute, now)).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE])("rejects invalid current time %s", time => {
    expect(canRecoverServerArtifactReadbackWithoutAi(fixture(), route, time)).toBe(false);
  });
  it.each(["legacy", "digest", "context", "mission", "round", "checkpoint", "stage", "pause", "repair", "ai", "recovering-owner", "recovering-status"])("retains %s receipt guards", kind => {
    let p = fixture();
    if (kind.startsWith("recovering-")) p = recoverServerMainFlowWait(p, at, "new-control");
    const receipt = p.campaign.serverRecoveryWait!;
    if (kind === "legacy") p.campaign.serverRecoveryWait = undefined;
    if (kind === "digest") receipt.inputFingerprint = "invalid";
    if (kind === "context") receipt.contextFingerprint = "different";
    if (kind === "mission") receipt.missionId = "foreign";
    if (kind === "round") receipt.round = 2;
    if (kind === "checkpoint") p.campaign.checkpoint!.completedPhase = "experiment";
    if (kind === "stage") p.stage = "experiment";
    if (kind === "pause") p.campaign.stopReason = "user paused";
    if (kind === "repair" || kind === "ai") {
      receipt.marker = kind === "repair" ? "artifact-repair-pending" : "ai-pending";
      receipt.reason = p.campaign.stopReason = "[server-campaign-" + receipt.marker + "] unavailable"; seal(p);
    }
    if (kind === "recovering-owner") receipt.resumedByControlJobId = receipt.controlJobId;
    if (kind === "recovering-status") p.campaign.status = "running";
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
  it.each(["source", "goal", "hidden", "parent", "candidate"])("does not accept changed %s without rebinding", kind => {
    const p = fixture();
    if (kind === "source") p.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "goal") p.goal += " changed";
    if (kind === "hidden") p.hiddenEvalSuite[0]!.input += " changed";
    if (kind === "parent") p.currentVersionId = "other";
    if (kind === "candidate") p.candidates[0]!.change += " changed";
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
  it.each(["route", "input"])("rejects a later-round %s comparability blocker", kind => {
    const p = fixture();
    p.campaign.currentRound = 1; p.campaign.checkpoint!.round = 2; p.validationRun.id = "validation-server-r2";
    p.campaign.serverRecoveryWait!.round = 2;
    if (kind === "route") p.campaign.scoringRouteFingerprint = "other";
    else p.campaign.scoringInputFingerprint = "other";
    seal(p);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
  it.each(["no-candidate", "duplicate-candidate", "winner", "experiment", "build", "validation-round", "fast-gate", "hold", "judge", "demo",
    "baseline-demo", "baseline-runs", "hidden-runs", "hidden-error", "hidden-unverified", "hidden-context", "execution-binding", "execution-evidence", "visible-incomplete", "visible-route"])("requires complete authoritative evidence: %s", kind => {
    const p = fixture(), v = p.validationRun;
    if (kind === "no-candidate") p.candidates = [];
    if (kind === "duplicate-candidate") p.candidates.push(structuredClone(p.candidates[0]!));
    if (kind === "winner") p.experimentRun.winnerId = "other";
    if (kind === "experiment") p.experimentRun.status = "idle";
    if (kind === "build") p.candidates[0]!.artifactBuildStatus = "failed";
    if (kind === "validation-round") v.id = "validation-server-r2";
    if (kind === "fast-gate") v.validationMode = "fast-gate";
    if (kind === "hold") v.recommendation = "hold";
    if (kind === "judge") v.evaluation = undefined;
    if (kind === "demo") v.evaluation!.demoJudged = true;
    if (kind === "baseline-demo") v.baselineEvaluation!.demoJudged = true;
    if (kind === "baseline-runs") v.baselineRuns = [];
    if (kind === "hidden-runs") v.runs = [];
    if (kind === "hidden-error") { v.runs[0]!.error = "runner failed"; v.runs[0]!.verificationStatus = "failed"; }
    if (kind === "hidden-unverified") v.evaluation!.criterionScores![0]!.verificationStatus = "unverified";
    if (kind === "hidden-context") v.baselineContextFingerprint = "other-paper";
    if (kind === "execution-binding") v.executionArtifactFingerprint = undefined;
    if (kind === "execution-evidence") v.executionEvidenceFingerprint = "wrong";
    if (kind === "visible-incomplete") p.baselineRun.runs = [];
    if (kind === "visible-route") p.baselineRun.measurementFingerprint = "other";
    seal(p);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
  it.each(["missing-frozen", "duplicate-snapshot", "wrong-format", "threshold", "criterion-failure", "missing-criterion", "duplicate-score"])("requires the frozen metadata settlement precheck to pass: %s", kind => {
    const p = fixture(), snapshot = p.candidates[0]!.artifactSnapshots[0]!;
    if (kind === "missing-frozen") snapshot.frozenArtifact = undefined;
    if (kind === "duplicate-snapshot") p.candidates[0]!.artifactSnapshots.push(structuredClone(snapshot));
    if (kind === "wrong-format") { snapshot.name = "result.html"; snapshot.frozenArtifact!.name = "result.html"; }
    if (kind === "threshold") p.validationRun.evaluation!.criterionScores![0]!.score = 85;
    if (kind === "criterion-failure") p.validationRun.evaluation!.criterionScores![0]!.pass = false;
    if (kind === "missing-criterion") p.validationRun.evaluation!.criterionScores!.pop();
    if (kind === "duplicate-score") p.validationRun.evaluation!.criterionScores!.push(structuredClone(p.validationRun.evaluation!.criterionScores![0]!));
    p.validationRun.evidenceFingerprint = evidenceFingerprint(p, p.candidates[0]!); seal(p);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
  it.each(["safety", "protected", "manual", "approval", "budget", "wall-time", "round-limit", "patience", "goal", "target-approval"])("does not bypass %s", kind => {
    const p = fixture();
    if (kind === "safety") { p.validationRun.evaluation!.safety = "FAIL"; p.campaign.stopCriteria.stopOnSafetyFailure = false; }
    if (kind === "protected" || kind === "manual") {
      if (kind === "manual") p.acceptanceRubric[1]!.validationMethod = "manual-review";
      p.validationRun.evaluation!.criterionScores![1]!.pass = false;
    }
    if (kind === "approval") p.attentionRequests = [{ id: "approval", type: "authorization", status: "pending", blocking: true,
      title: "Approve", reason: "approval required", stage: p.stage, riskLevel: "high", questions: [], criterionIds: [], createdAt: at }];
    if (kind === "budget") p.campaign.stopCriteria.maxEstimatedCost = 0;
    if (kind === "wall-time") p.campaign.startedAt = new Date(now - 31 * 60_000).toISOString();
    if (kind === "round-limit") p.campaign.stopCriteria.maxRounds = 0;
    if (kind === "patience") p.campaign.noImprovementRounds = p.campaign.stopCriteria.patienceRounds;
    if (kind === "goal") p.goal = "";
    if (kind === "target-approval") p.gates[0]!.status = "ready";
    seal(p);
    expect(canRecoverServerArtifactReadbackWithoutAi(p, route, now)).toBe(false);
  });
});
