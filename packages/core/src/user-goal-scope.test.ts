import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema, CandidateDesignRationaleSchema, ExperimentPolicySchema, TestCaseSchema, type EvaluationResult } from "@evolution/contracts";
import { experimentRecoveryFixture } from "@evolution/testkit";
import { candidateWinnerDecision } from "./experiment-winner";
import { campaignScoringInputBlocker, campaignScoringInputFingerprint } from "./campaign-scoring-input";
import { evidenceFingerprint } from "./evidence-binding";
import { finalHoldoutContractFingerprint } from "./independent-final-holdout";
import { originalUserGoalCriteria, USER_GOAL_SCOPE_POLICY, userGoalProgress, userGoalScopeContext,userGoalPlanningScope } from "./user-goal-scope";

function fixture() {
  const { project: p, current: candidate } = experimentRecoveryFixture();
  p.acceptanceRubric = [
    ["CLOSURE", 40], ["UNDERSTAND", 30], ["DETAIL", 20], ["SYSTEM", 10],
  ].map(([id, weight]) => AcceptanceCriterionSchema.parse({
    id, title: id, requirement: `Preserve and improve ${id}`, weight,
    source: id === "SYSTEM" ? "system-integrity" : "user-command",
    protectedConstraint: id === "SYSTEM", hardGate: true, minScore: 80,
  }));
  p.evalSuite = p.acceptanceRubric.map(c => TestCaseSchema.parse({
    id: `V-${c.id}`, title: c.title, input: c.requirement, expected: [c.requirement], criterionIds: [c.id],
  }));
  const measured = (values: number[]): EvaluationResult => ({
    ...p.baselineRun.result!, safety: "PASS", demoJudged: false, verifiedRubricCoverage: 100,
    criterionScores: p.acceptanceRubric.map((c, index) => ({
      criterionId: c.id, score: values[index]!, pass: true, verificationStatus: "verified",
      evidence: ["synthetic paired observation"], gaps: [], testCaseIds: [`V-${c.id}`],
    })),
  });
  const baseline = measured([90, 96, 94, 90]), result = measured([92, 92, 96, 100]);
  candidate.designRationale = CandidateDesignRationaleSchema.parse({ coveredCriteria: ["CLOSURE", "DETAIL", "SYSTEM"] });
  p.experimentPolicy.winnerGoalScope = USER_GOAL_SCOPE_POLICY;
  return { p, candidate, baseline, result, measured };
}

describe("explicit complete user-goal scope", () => {
  it("binds every original user goal and Target for each independent plan, regardless of the selected local problem",()=>{
    const {p}=fixture(),source=p.sourceArtifacts[0]!;
    p.sourceArtifacts=[source,{...source,id:"second-target"},{...source,id:"reference-only",role:"reference"}];
    const before=JSON.stringify(p),scope=userGoalPlanningScope(p)!;
    expect(scope.schemaVersion).toBe("user-goal-planning-scope-v1");
    expect(scope.requiredCriteria.map(c=>c.criterionId)).toEqual(["CLOSURE","UNDERSTAND","DETAIL"]);
    expect(scope.targetArtifactIds).toEqual([source.id,"second-target"]);expect(JSON.stringify(p)).toBe(before);
    delete p.experimentPolicy.winnerGoalScope;expect(userGoalPlanningScope(p)).toBeUndefined();
  });
  it("preserves the old policy and prevents self-selected coverage from excluding a regressed user goal", () => {
    const { p, candidate, baseline, result } = fixture(), original = structuredClone(result);
    delete p.experimentPolicy.winnerGoalScope;
    const legacy = candidateWinnerDecision(p, result, baseline, candidate);
    expect(legacy.eligible).toBe(true); expect(legacy.targetCriterionIds).not.toContain("UNDERSTAND");
    expect(userGoalScopeContext(p)).toBeUndefined();
    p.experimentPolicy.winnerGoalScope = USER_GOAL_SCOPE_POLICY;
    const decision = candidateWinnerDecision(p, result, baseline, candidate);
    expect(decision.eligible).toBe(false);
    expect(decision.targetCriterionIds).toEqual(["CLOSURE", "UNDERSTAND", "DETAIL"]);
    expect(decision.blockers.join(" ")).toContain("UNDERSTAND");
    expect(result).toEqual(original); expect(result.criterionScores!.every(c => c.pass)).toBe(true);
    expect(candidate.designRationale!.coveredCriteria).not.toContain("UNDERSTAND");
  });

  it("cannot compensate a user-goal decline with gains on the other goals or system criteria", () => {
    const { p, candidate, baseline, measured } = fixture(), result = measured([99, 95, 100, 100]);
    expect(userGoalProgress(p, result, baseline).weightedDelta).toBeGreaterThan(1);
    const decision = candidateWinnerDecision(p, result, baseline, candidate);
    expect(decision.globalDelta).toBeGreaterThan(1); expect(decision.eligible).toBe(false);
    expect(decision.blockers.join(" ")).toContain("原始用户目标同卷退步：UNDERSTAND");
  });

  it("requires at least a one-point weighted gain across all user goals, even when system scores improve", () => {
    const { p, candidate, baseline, measured } = fixture();
    const decision = candidateWinnerDecision(p, measured([91, 96, 94, 100]), baseline, candidate);
    expect(decision.globalDelta).toBeGreaterThanOrEqual(1); expect(decision.eligible).toBe(false);
    expect(decision.blockers.join(" ")).toContain("1 分提升门槛");
  });

  it("allows a measured whole-goal improvement without fabricating delivery or user benefit", () => {
    const { p, candidate, baseline, measured } = fixture(), result = measured([94, 96, 96, 100]);
    const progress = userGoalProgress(p, result, baseline), decision = candidateWinnerDecision(p, result, baseline, candidate);
    expect(progress).toMatchObject({ ready: true, regressedCriterionIds: [], pendingCriterionIds: [] });
    expect(progress.weightedDelta).toBeCloseTo(200 / 90); expect(decision.eligible).toBe(true);
    expect(p.outputArtifacts).toHaveLength(0);
    expect(userGoalScopeContext(p)?.requiredCriteria.map(c => c.criterionId)).toEqual(["CLOSURE", "UNDERSTAND", "DETAIL"]);
  });

  it.each(["missing", "unverified", "duplicate", "duplicate-baseline", "wrong-paper", "partial-paper", "extra-case", "duplicate-case", "duplicate-suite", "demo-baseline", "unmapped"])(
    "keeps %s evidence pending rather than turning passing absolute scores into failures", kind => {
      const { p, candidate, baseline, measured } = fixture(), result = measured([94, 96, 96, 100]);
      const score = result.criterionScores![1]!, prior = baseline.criterionScores![1]!;
      if (kind === "missing") result.criterionScores!.splice(1, 1);
      if (kind === "unverified") score.verificationStatus = "partial";
      if (kind === "duplicate") result.criterionScores!.push({ ...score });
      if (kind === "duplicate-baseline") baseline.criterionScores!.push({ ...prior });
      if (kind === "wrong-paper") score.testCaseIds = prior.testCaseIds = ["OTHER"];
      if (kind === "partial-paper") p.evalSuite.push({ ...p.evalSuite[1]!, id: "SECOND-UNDERSTAND" });
      if (kind === "extra-case") score.testCaseIds = prior.testCaseIds = [...score.testCaseIds, "V-DETAIL"];
      if (kind === "duplicate-case") score.testCaseIds.push(score.testCaseIds[0]!);
      if (kind === "duplicate-suite") p.evalSuite.push({ ...p.evalSuite[1]! });
      if (kind === "demo-baseline") baseline.demoJudged = true;
      if (kind === "unmapped") p.evalSuite[1]!.criterionIds = ["DETAIL"];
      const before = structuredClone(result), progress = userGoalProgress(p, result, baseline);
      expect(progress.ready).toBe(false); expect(progress.weightedDelta).toBeUndefined();
      expect(progress.pendingCriterionIds).toContain("UNDERSTAND");
      expect(candidateWinnerDecision(p, result, baseline, candidate).eligible).toBe(false);
      expect(result).toEqual(before); expect(score.pass).toBe(true);
    },
  );

  it("accepts complete criterion-linked case sets in either order and uses the supplied ordinary Hidden paper", () => {
    const { p, baseline, result } = fixture();
    const extra = { ...p.evalSuite[1]!, id: "V-UNDERSTAND-SECOND" };
    p.evalSuite.push(extra); baseline.criterionScores![1]!.testCaseIds.push(extra.id);
    result.criterionScores![1]!.testCaseIds.unshift(extra.id);
    expect(userGoalProgress(p, result, baseline).ready).toBe(true);
    const hidden = p.evalSuite.map(t => ({ ...t, id: `H-${t.id}`, hidden: true }));
    for (const e of [baseline, result]) for (const score of e.criterionScores!) score.testCaseIds = score.testCaseIds.map(id => `H-${id}`);
    expect(userGoalProgress(p, result, baseline).ready).toBe(false);
    expect(userGoalProgress(p, result, baseline, hidden).ready).toBe(true);
  });

  it.each(["missing-goals", "duplicate-goals", "zero-weight"])("blocks %s before the first model call", kind => {
    const { p } = fixture(); p.campaign.currentRound = 0;
    if (kind === "missing-goals") p.acceptanceRubric = p.acceptanceRubric.filter(c => c.source !== "user-command");
    if (kind === "duplicate-goals") p.acceptanceRubric.push({ ...p.acceptanceRubric[0]! });
    if (kind === "zero-weight") for (const goal of originalUserGoalCriteria(p)) goal.weight = 0;
    expect(campaignScoringInputBlocker(p)).toContain("禁止调用模型");
    delete p.experimentPolicy.winnerGoalScope; expect(campaignScoringInputBlocker(p)).toBeUndefined();
  });

  it("keeps schema and legacy identities stable while binding explicit scope to scores, artifacts and final reservation", () => {
    const { p, candidate } = fixture(); delete p.experimentPolicy.winnerGoalScope;
    const identities = () => [campaignScoringInputFingerprint(p), evidenceFingerprint(p, candidate), finalHoldoutContractFingerprint(p)];
    const legacy = identities(); expect(ExperimentPolicySchema.parse(p.experimentPolicy)).not.toHaveProperty("winnerGoalScope");
    p.experimentPolicy.winnerGoalScope = undefined; expect(identities()).toEqual(legacy);
    p.experimentPolicy.winnerGoalScope = USER_GOAL_SCOPE_POLICY;
    expect(ExperimentPolicySchema.parse(p.experimentPolicy).winnerGoalScope).toBe(USER_GOAL_SCOPE_POLICY);
    identities().forEach((id, index) => expect(id).not.toBe(legacy[index]));
    p.campaign.currentRound = 1; p.campaign.scoringInputFingerprint = legacy[0];
    expect(campaignScoringInputBlocker(p)).toContain("重置搜索");
  });
});
