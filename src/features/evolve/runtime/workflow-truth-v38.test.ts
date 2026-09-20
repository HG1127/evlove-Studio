import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { EvolveProjectSchema } from "../schemas";
import { baselineReadiness, reusableBaselineRuns } from "./baseline-readiness";
import { resolveEvidenceRefs } from "./evidence-provenance";
import { candidateImprovesBaseline, hypothesisGroundingScore, validationRegression } from "./run-local";
import { deriveWorkflowSteps, workflowRequiresOnlineRelease } from "./workflow-engine";
import { beginReleaseCycle } from "@evolution/core";

const project = () => EvolveProjectSchema.parse(structuredClone(demoProject));

describe("workflow truth gates", () => {
  it("requires complete, usable baseline evidence before diagnosis", () => {
    const p = project();
    p.baselineRun.runs = p.evalSuite.map((testCase) => ({
      testCaseId: testCase.id,
      output: "已执行并返回可用证据",
      latencyMs: 10,
      cost: 0,
      trace: [],
      verificationStatus: "verified",
    }));
    p.baselineRun.totalCases = p.evalSuite.length;
    p.baselineRun.status = "completed";
    p.baselineRun.result = { ...p.baselineRun.result!, demoJudged: false };
    expect(baselineReadiness(p).ready).toBe(true);

    p.baselineRun.runs[0] = { ...p.baselineRun.runs[0], error: "timeout", verificationStatus: "failed" };
    expect(baselineReadiness(p).ready).toBe(false);
    expect(baselineReadiness(p).blockers.join(" ")).toContain("执行失败");
  });

  it("does not accept demo-judged baseline as diagnostic truth", () => {
    const p = project();
    p.baselineRun.result = { ...p.baselineRun.result!, demoJudged: true };
    expect(baselineReadiness(p).blockers.join(" ")).toContain("演示兜底");
  });

  it("resolves model claims to concrete source evidence", () => {
    const p = project();
    const [ref] = resolveEvidenceRefs(p, ["最终生成阶段缺少逐 Claim 的 Evidence Gate"]);
    expect(ref.verified).toBe(true);
    expect(ref.artifactId).toBe("demo-prompt");
    expect(ref.contentHash).toBeTruthy();
  });

  it("keeps the baseline when the best candidate is not materially better", () => {
    const p = project();
    const baseline = { ...p.baselineRun.result!, rubricScore: 80, verifiedRubricCoverage: 100, demoJudged: false };
    expect(candidateImprovesBaseline(p, { ...baseline }, baseline)).toBe(false);
    expect(candidateImprovesBaseline(p, { ...baseline, rubricScore: 82 }, baseline)).toBe(true);
    expect(candidateImprovesBaseline(p, { ...baseline, rubricScore: 90, safety: "FAIL" }, baseline)).toBe(false);
    expect(candidateImprovesBaseline(p, { ...baseline, rubricScore: 90, verifiedRubricCoverage: 80 }, baseline)).toBe(false);
  });

  it("allows a focused local improvement when paired global evidence has no material regression", () => {
    const p = project();
    p.acceptanceRubric = [
      { id: "READ", title: "正文可读性", category: "ux", requirement: "正文易读", weight: 50, minScore: 70, hardGate: false, source: "user-command", evidenceExpected: ["字号和行高"], validationMethod: "static-structure", artifactIds: [], judgeType: "structural", protectedConstraint: false },
      { id: "KEEP", title: "内容保持", category: "protected", requirement: "内容不丢失", weight: 50, minScore: 70, hardGate: false, source: "protected-item", evidenceExpected: ["章节完整"], validationMethod: "static-structure", artifactIds: [], judgeType: "structural", protectedConstraint: true },
    ];
    const baseline = { ...p.baselineRun.result!, rubricScore: 80, verifiedRubricCoverage: 100, demoJudged: false, criterionScores: [
      { criterionId: "READ", score: 70, pass: true, verificationStatus: "verified" as const, evidence: [], gaps: [], testCaseIds: ["a"] },
      { criterionId: "KEEP", score: 90, pass: true, verificationStatus: "verified" as const, evidence: [], gaps: [], testCaseIds: ["b"] },
    ] };
    const candidate = { ...pCandidate("focused"), designRationale: { sourceEvidence: ["body 14px"], commandAlignment: "提升可读性", mechanism: "增大字号", coveredCriteria: ["正文可读性"], protectedCompliance: "不改内容", falsifier: "可读性不升" } };
    const evaluation = { ...baseline, rubricScore: 79, criterionScores: [
      { criterionId: "READ", score: 76, pass: true, verificationStatus: "verified" as const, evidence: [], gaps: [], testCaseIds: ["a"] },
      { criterionId: "KEEP", score: 88, pass: true, verificationStatus: "verified" as const, evidence: [], gaps: [], testCaseIds: ["b"] },
    ] };
    expect(candidateImprovesBaseline(p, evaluation, baseline, candidate)).toBe(true);
    expect(validationRegression(p, { ...evaluation, accuracy: 10, completeness: 10 }, baseline)).toBe(false);
    expect(validationRegression(p, { ...evaluation, criterionScores: evaluation.criterionScores.map((item) => ({ ...item, score: 10 })) }, baseline)).toBe(true);
    // An unpaired aggregate coverage change must not erase a demonstrated local gain.
    expect(candidateImprovesBaseline(p, { ...evaluation, verifiedRubricCoverage: 19 }, { ...baseline, verifiedRubricCoverage: 38 }, candidate)).toBe(true);
    expect(candidateImprovesBaseline(p, { ...evaluation, criterionScores: evaluation.criterionScores.map((item) => item.criterionId === "KEEP" ? { ...item, verificationStatus: "unverified" as const } : item) }, baseline, candidate)).toBe(false);
  });

  it("ranks grounded hypotheses before expensive artifact construction", () => {
    const grounded = {
      ...pCandidate("grounded"),
      recommended: true,
      designRationale: { sourceEvidence: ["源文件第 3 节"], commandAlignment: "对应核心要求", mechanism: "改动会减少遗漏", coveredCriteria: ["完整性"], protectedCompliance: "不改结构", falsifier: "遗漏率未下降" },
    };
    expect(hypothesisGroundingScore(grounded)).toBeGreaterThan(hypothesisGroundingScore(pCandidate("weak")));
  });
});


it("skips fake canary stages for a Vercel preview-promote release target", () => {
  const p = project();
  p.releaseTarget = {
    provider: "vercel",
    mode: "preview-promote",
    status: "connected",
    label: "Vercel · test",
    projectId: "prj_test",
    productionUrl: "https://example.vercel.app",
    healthPath: "/",
  };
  p.release = { ...p.release, status: "shadow", trafficPercent: 0, healthy: true, observationStatus: "healthy" };
  const steps = deriveWorkflowSteps(p);
  expect(workflowRequiresOnlineRelease(p)).toBe(true);
  expect(steps.find((step) => step.id === "19")?.state).toBe("completed");
  expect(steps.find((step) => step.id === "20")?.state).toBe("skipped");
  expect(steps.find((step) => step.id === "21")?.state).toBe("ready");

  const progressive = project();
  progressive.releaseTarget = undefined;
  progressive.targetConnection = { ...progressive.targetConnection, adapter: "http" };
  progressive.release = { ...progressive.release, status: "shadow", trafficPercent: 0, healthy: true, observationStatus: "healthy" };
  expect(deriveWorkflowSteps(progressive).find((step) => step.id === "20")?.state).toBe("ready");
});


it("starts every new release candidate from an unbound idle cycle while preserving the current production as stable", () => {
  const p = project();
  p.release = {
    ...p.release,
    status: "promoted",
    candidateId: "old-candidate",
    deploymentId: "dpl_current_prod",
    stableDeploymentId: "dpl_previous_prod",
    trafficPercent: 100,
    healthy: true,
    evidenceMode: "live",
    observationStatus: "healthy",
    environment: "production",
    artifactHashes: [{ sourceArtifactId: "source-old", contentHash: "a".repeat(64) }],
    history: [{ at: "2026-09-20T00:00:00.000Z", action: "promote", note: "old production" }],
  };
  const next = beginReleaseCycle(p.release, "new-candidate");
  expect(next.status).toBe("idle");
  expect(next.candidateId).toBe("new-candidate");
  expect(next.deploymentId).toBeUndefined();
  expect(next.stableDeploymentId).toBe("dpl_current_prod");
  expect(next.trafficPercent).toBe(0);
  expect(next.evidenceMode).toBe("none");
  expect(next.history).toHaveLength(1);
});

function pCandidate(id: string) {
  return EvolveProjectSchema.parse(structuredClone(demoProject)).candidates[0] ?? {
    id, name: id, change: "局部修改", patches: [], riskLevel: "medium" as const, accuracy: 0, evidence: 0,
    riskCoverage: 0, costDelta: 0, speedDelta: 0, safety: "REVIEW" as const, recommended: false,
    status: "draft" as const, notes: [], artifactSnapshots: [], artifactBuildStatus: "idle" as const, addressesAdvice: [],
  };
}

it("reuses only successful baseline evidence for unchanged inputs when recovering", () => {
  const p = project();
  p.baselineRun.measurementFingerprint = "same";
  const ids = p.evalSuite.slice(0, 3).map((item) => item.id);
  p.baselineRun.runs = ids.map((testCaseId, index) => ({ testCaseId, output: "evidence", latencyMs: 1, cost: 0, trace: [], verificationStatus: index === 0 ? "verified" : index === 1 ? "failed" : "unverified" }));
  // A measured output with missing criterion judgement must be retried too.
  p.baselineRun.result = undefined;
  expect(reusableBaselineRuns(p, "same", true)).toEqual([]);
  p.evalSuite[0].criterionIds = [];
  expect(reusableBaselineRuns(p, "same", true).map((run) => run.testCaseId)).toEqual([ids[0]]);
  expect(reusableBaselineRuns(p, "changed", true)).toEqual([]);
  expect(reusableBaselineRuns(p, "same", false)).toEqual([]);
});

it("does not require the original to prove improvement over itself", () => {
  const p = project();
  p.acceptanceRubric = [{ ...p.acceptanceRubric[0], id: "READ" }, { ...p.acceptanceRubric[0], id: "SYS-PAIRWISE" }];
  p.evalSuite = [{ ...p.evalSuite[0], id: "read", executionMode: "artifact-runtime", criterionIds: [p.acceptanceRubric[0].id] }, { ...p.evalSuite[0], id: "pairwise", executionMode: "artifact-runtime", criterionIds: ["SYS-PAIRWISE"] }];
  p.baselineRun = { ...p.baselineRun, status: "completed", result: { ...p.baselineRun.result!, demoJudged: false }, runs: [{ testCaseId: "read", output: "observation", latencyMs: 0, cost: 0, trace: [], verificationStatus: "verified" }, { testCaseId: "pairwise", output: "not applicable", latencyMs: 0, cost: 0, trace: [], verificationStatus: "unverified" }] };
  expect(baselineReadiness(p).blockers).toEqual([]);
  expect(baselineReadiness(p).planned).toBe(1);
});
