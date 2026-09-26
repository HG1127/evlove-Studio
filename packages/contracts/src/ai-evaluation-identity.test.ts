import { describe, expect, it } from "vitest";
import { EvaluateAiResultSchema } from "./ai-schemas";

const row = (criterionId: string) => ({ criterionId, score: 90, pass: true, evidence: [], gaps: [], testCaseIds: ["H1"] });
const caseRow = (testCaseId: string) => ({ testCaseId, accuracy: 90, evidence: 90, completeness: 90, reason: "observed" });
const result = (criteria = [row("C1")], cases = [caseRow("H1")]) => ({
  accuracy: 90, evidence: 90, riskCoverage: 90, completeness: 90, safety: "PASS",
  notes: [], failures: [], cases, criteria,
});

describe("evaluator result identity boundary", () => {
  it("accepts distinct Criterion and Test Case IDs", () => {
    expect(EvaluateAiResultSchema.safeParse(result([row("C1"), row("C2")], [caseRow("H1"), caseRow("H2")])).success).toBe(true);
  });

  it("rejects repeated Criterion IDs before settlement", () => {
    const parsed = EvaluateAiResultSchema.safeParse(result([row("C1"), row("C1")]));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["criteria", 1, "criterionId"]);
  });

  it("rejects repeated Test Case IDs before settlement", () => {
    const parsed = EvaluateAiResultSchema.safeParse(result(undefined, [caseRow("H1"), caseRow("H1")]));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["cases", 1, "testCaseId"]);
  });
});
