import { describe, expect, it } from "vitest";
import {
  AcceptanceCriterionSchema,
  type EvaluateAiResult,
  type TargetRunResult,
  type TestCase,
} from "@evolution/contracts";
import { deriveCriterionScores, settleAiEvaluation } from "./evaluation-settlement";

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
