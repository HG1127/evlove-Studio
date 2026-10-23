import { describe, expect, it } from "vitest";
import {
  AcceptanceCriterionSchema,
  type EvaluateAiResult,
  type TargetRunResult,
  type TestCase,
} from "@evolution/contracts";
import { criteriaRequiringJudge, deriveCriterionScores, settleAiEvaluation, settleDeterministicEvaluation } from "./evaluation-settlement";

const criterion = (id: string, validationMethod: "semantic-judge" | "format-roundtrip" = "semantic-judge") =>
  AcceptanceCriterionSchema.parse({ id, title: id, requirement: `${id} must pass`, hardGate: true, minScore: 80, validationMethod });
const testCase = (id: string, criterionId: string, executionMode: "artifact-runtime" | "roundtrip" = "artifact-runtime") => ({
  id, title: id, input: "check", expected: ["pass"], tags: [], hidden: true,
  criterionIds: [criterionId], executionMode, evidenceScope: "product-behavior",
}) as TestCase;
const run = (id: string, output = "current artifact evidence") => ({
  testCaseId: id, output, latencyMs: 1, cost: 0, trace: [], verificationStatus: "verified",
}) as TargetRunResult;
const ai = (criteria: EvaluateAiResult["criteria"], cases: EvaluateAiResult["cases"] = []): EvaluateAiResult => ({
  accuracy: 90, evidence: 90, riskCoverage: 90, completeness: 90, safety: "PASS",
  notes: [], failures: [], cases, criteria,
});
const judgement = (criterionId: string, testCaseId: string, score: number) => ({
  criterionId, score, pass: score >= 80, evidence: [`${testCaseId}: current evidence`], gaps: [], testCaseIds: [testCaseId],
});

describe("evaluation result identity", () => {
  it("quarantines a repeated Criterion while retaining a different unique Criterion", () => {
    const result = settleAiEvaluation({
      criteria: [criterion("C1"), criterion("C2")],
      testCases: [testCase("H1", "C1"), testCase("H2", "C2")],
      runs: [run("H1"), run("H2")],
      ai: ai([judgement("C1", "H1", 100), judgement("C1", "H1", 10), judgement("C2", "H2", 90)]),
    });
    expect(result.criterionScores?.find((item) => item.criterionId === "C1")).toMatchObject({ pass: false, verificationStatus: "unverified" });
    expect(result.criterionScores?.find((item) => item.criterionId === "C1")?.gaps.join(" ")).toContain("重复判定");
    expect(result.criterionScores?.find((item) => item.criterionId === "C2")).toMatchObject({ score: 90, pass: true, verificationStatus: "verified" });
    expect(result.unverifiedCriterionIds).toEqual(["C1"]);
  });

  it("removes repeated Case scores and keeps their Criterion unverified", () => {
    const result = settleAiEvaluation({
      criteria: [criterion("C1")], testCases: [testCase("H1", "C1")], runs: [run("H1")],
      ai: ai([], [
        { testCaseId: "H1", accuracy: 100, evidence: 100, completeness: 100, reason: "pass" },
        { testCaseId: "H1", accuracy: 10, evidence: 10, completeness: 10, reason: "fail" },
      ]),
    });
    expect(result.caseScores).toEqual([]);
    expect(result.criterionScores?.[0]).toMatchObject({ pass: false, verificationStatus: "unverified" });
    expect(result.criterionScores?.[0]?.gaps.join(" ")).toContain("重复判定");
  });

  it("does not let a later repeated Run choose the acceptance status", () => {
    const result = deriveCriterionScores(
      [criterion("C1")], [testCase("H1", "C1")], [], [run("H1", "first"), run("H1", "second")],
      [judgement("C1", "H1", 100)],
    );
    expect(result.criterionScores[0]).toMatchObject({ pass: false, verificationStatus: "unverified" });
    expect(result.criterionScores[0]?.gaps.join(" ")).toContain("重复执行结果");
  });

  it("retains independent deterministic roundtrip proof despite repeated Judge rows", () => {
    const formatRun = {
      ...run("H1", "CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED"),
      trace: [{ id: "rt", stage: "format-roundtrip", summary: "preserved", status: "pass" as const, detail: "preserved=true" }],
    };
    const result = deriveCriterionScores(
      [criterion("FORMAT", "format-roundtrip")], [testCase("H1", "FORMAT", "roundtrip")], [], [formatRun],
      [judgement("FORMAT", "H1", 10), judgement("FORMAT", "H1", 100)],
    );
    expect(result.criterionScores[0]).toMatchObject({ score: 100, pass: true, verificationStatus: "verified" });
  });
});


describe("baseline source-negative scoring precedence",()=>{
  const c={...criterion("USER-PRIMARY-INTENT"),source:"user-command" as const,hardGate:true};
  const t=testCase("H-NEGATIVE",c.id);
  const documented={
    ...run(t.id,"VERIFIED DOCUMENTED BASELINE DEFECT (not product success)\\nExact original citation: 重要结论没有证据来源"),
    trace:[{id:"source-quote",stage:"baseline-exact-source-negative-evidence",summary:"完整原文缺陷",status:"pass" as const,detail:"Source exact quote matched"}],
  };
  it("keeps a direct, source-grounded absence as VERIFIED FAIL even if the Judge awards 100",()=>{
    const result=deriveCriterionScores([c],[t],[],[documented],[judgement(c.id,t.id,100)]);
    expect(result.criterionScores[0]).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
    expect(result.criterionScores[0]!.evidence.join(" ")).toContain("Exact original citation");
  });
  it("does not charge an LLM Judge for exact, fully documented baseline failure",()=>{
    expect(criteriaRequiringJudge([c],[t],[documented])).toEqual([]);
    expect(criteriaRequiringJudge([c],[t],[documented,{...documented}])).toEqual([c]);
  });
  it("does not override a candidate without the exact negative-evidence trace",()=>{
    const candidate=deriveCriterionScores([c],[t],[],[run(t.id)],[judgement(c.id,t.id,100)]);
    expect(candidate.criterionScores[0]).toMatchObject({score:100,pass:true,verificationStatus:"verified"});
  });
  it("does not trust legacy VERIFIED rows that omit source output or trace",()=>{
    const incomplete={testCaseId:t.id,verificationStatus:"verified"} as TargetRunResult;
    const noBytes=deriveCriterionScores([c],[t],[],[incomplete],[judgement(c.id,t.id,100)]);
    expect(noBytes.criterionScores[0]).toMatchObject({pass:false,verificationStatus:"unverified"});
    const missingTrace={...run(t.id,"VERIFIED DOCUMENTED BASELINE DEFECT (not product success)"),trace:undefined} as unknown as TargetRunResult;
    const noTrace=deriveCriterionScores([c],[t],[],[missingTrace],[judgement(c.id,t.id,100)]);
    expect(noTrace.criterionScores[0]).toMatchObject({pass:false,verificationStatus:"unverified"});
  });
  it("still fails closed on duplicated original runs",()=>{
    const result=deriveCriterionScores([c],[t],[],[documented,{...documented}],[judgement(c.id,t.id,100)]);
    expect(result.criterionScores[0]).toMatchObject({pass:false,verificationStatus:"unverified"});
  });
});

describe("generated HTML protection coverage", () => {
  it.each([true, false])("keeps search-only proof partial even when the Judge awards 100 (hardGate=%s)", (hardGate) => {
    const c = { ...criterion("PROTECT-ALL"), hardGate };
    const t = { ...testCase("search-smoke", c.id), executionMode: "external-runner" as const, tags: ["source-grounded-html-assertions"] };
    const execution = run(t.id);
    for (const judge of [true, false]) {
      const result = deriveCriterionScores([c], [t], [{ testCaseId: t.id, accuracy: 100, evidence: 100, completeness: 100, reason: "search assertions passed" }], [execution], judge ? [judgement(c.id, t.id, 100)] : undefined);
      expect(result.criterionScores[0]).toMatchObject({ score: 100, pass: false, verificationStatus: "partial" });
      expect(result.criterionScores[0]?.gaps.join(" ")).toContain("搜索交互");
      expect(result.verifiedRubricCoverage).toBe(0);
      expect(execution.verificationStatus).toBe("verified");
    }
    const explicit = deriveCriterionScores([c], [{ ...t, tags: [] }], [], [execution], [judgement(c.id, t.id, 100)]);
    expect(explicit.criterionScores[0]).toMatchObject({ pass: true, verificationStatus: "verified" });
  });
});


describe("deterministic evaluation settlement", () => {
  it("retains format proof while leaving unrelated semantics unmeasured", () => {
    const proof = { ...run("F"), cost: 0.02, latencyMs: 17, trace: [{ id: "rt", stage: "format-roundtrip", status: "pass" as const, summary: "exact roundtrip" }] };
    const result = settleDeterministicEvaluation({
      criteria: [criterion("FORMAT", "format-roundtrip"), criterion("CONTENT")],
      testCases: [testCase("F", "FORMAT", "roundtrip"), testCase("S", "CONTENT")],
      runs: [proof, { ...run("S"), verificationStatus: "unverified", error: "provider unavailable", cost: 999, latencyMs: 999 }],
    });
    expect(result).toMatchObject({ accuracy: 0, evidence: 0, riskCoverage: 0, completeness: 0, caseScores: [], failures: [], averageCost: 0.02, averageLatencyMs: 17 });
    expect(result.criterionScores?.find((score) => score.criterionId === "FORMAT")).toMatchObject({ pass: true, verificationStatus: "verified" });
    expect(result.criterionScores?.find((score) => score.criterionId === "CONTENT")).toMatchObject({ pass: false, verificationStatus: "unverified" });
    expect(result.unverifiedCriterionIds).toEqual(["CONTENT"]);
  });

  it.each(["duplicate", "partial", "no-proof"])("does not promote incomplete format evidence (%s)", (mode) => {
    const proof = { ...run("F"), trace: [{ id: "rt", stage: "format-roundtrip", status: "pass" as const, summary: "roundtrip" }] };
    const runs: TargetRunResult[] = mode === "duplicate" ? [proof, proof]
      : [mode === "partial" ? { ...proof, verificationStatus: "partial" } : { ...proof, trace: [] }];
    const result = settleDeterministicEvaluation({ criteria: [criterion("FORMAT", "format-roundtrip")], testCases: [testCase("F", "FORMAT", "roundtrip")], runs });
    expect(result.criterionScores?.[0]).toMatchObject({ pass: false, verificationStatus: "unverified" });
    expect(result.verifiedRubricCoverage).toBe(0);
  });
});
