import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema, CriterionScoreSchema, SourceArtifactSchema, type TargetRunResult, type TestCase } from "@evolution/contracts";
import { deriveCriterionScores, settleAiEvaluation, settleDeterministicEvaluation } from "./evaluation-settlement";
import { applyDeterministicRoundtripEvidence, hasDeterministicRoundtripProof } from "./deterministic-criterion-evidence";

const criterion = (id: string, overrides: Record<string, unknown> = {}) => AcceptanceCriterionSchema.parse({
  id, title: id, requirement: "must pass", hardGate: true, minScore: 95, ...overrides,
});
const test = (id: string, criterionIds: string[], overrides: Record<string, unknown> = {}) => ({
  id, title: id, input: "inspect", expected: ["observed"], tags: [], hidden: true,
  criterionIds, executionMode: "external-runner", evidenceScope: "product-behavior", ...overrides,
}) as TestCase;
const execution = (t: TestCase, overrides: Partial<TargetRunResult> = {}) => ({
  testCaseId: t.id, output: "search/structure assertions passed", latencyMs: 1, cost: 0, trace: [],
  verificationStatus: "verified", ...overrides,
}) as TargetRunResult;
const judged = (ids: string[], caseId: string) => ({
  accuracy: 100, evidence: 100, riskCoverage: 100, completeness: 100, safety: "PASS" as const,
  cases: [], notes: [], failures: [], criteria: ids.map(criterionId => ({
    criterionId, score: 100, pass: true, evidence: ["all observed"], gaps: [], testCaseIds: [caseId],
  })),
});

describe("whole protection cannot be inferred from case metadata", () => {
  it.each(["PROTECT-ALL", "SYS-INTEGRITY"])("caps untagged search-only %s for both hard and soft criteria", id => {
    for (const hardGate of [true, false]) {
      const c = criterion(id, { hardGate });
      const t = test("search", [id], { browserSteps: [{ action: "visible", selector: "#search" }] });
      const r = execution(t);
      const result = settleAiEvaluation({ criteria: [c], testCases: [t], runs: [r], ai: judged([id], t.id) });
      expect(result.criterionScores?.[0]).toMatchObject({ score: 100, pass: false, verificationStatus: "partial" });
      expect(result.verifiedRubricCoverage).toBe(0);
      expect(r.verificationStatus).toBe("verified");
    }
  });

  it("caps mixed PROTECT-ALL/SYS-INTEGRITY even when the complete static index and Judge are verified", () => {
    const criteria = ["PROTECT-ALL", "SYS-INTEGRITY"].map(id => criterion(id, { validationMethod: "static-structure" }));
    const t = test("static", criteria.map(c => c.id), { executionMode: "static-evidence", evidenceScope: "implementation" });
    const result = settleAiEvaluation({ criteria, testCases: [t], runs: [execution(t)], ai: judged(t.criterionIds, t.id) });
    expect(result.criterionScores?.every(c => c.pass === false && c.verificationStatus === "partial")).toBe(true);
    expect(result.unverifiedCriterionIds).toEqual(["PROTECT-ALL", "SYS-INTEGRITY"]);
  });

  it("caps equivalent declared protection under a custom ID", () => {
    const c = criterion("KEEP-EVERYTHING", { source: "protected-item", protectedConstraint: true, requirement: "Preserve all original content and behaviors" });
    const t = test("search", [c.id]);
    expect(deriveCriterionScores([c], [t], [], [execution(t)], judged([c.id], t.id).criteria).criterionScores[0])
      .toMatchObject({ pass: false, verificationStatus: "partial" });
  });

  it("does not use a transport proof or AI prose as independent execution authority", () => {
    const c = criterion("PROTECT-ALL");
    const t = test("claim", [c.id]);
    const r = execution(t);
    // Deliberately malformed/self-authored proof: even the claimed status must not unlock scoring.
    Object.assign(r, { htmlProtectionProof: { verificationStatus: "verified", receipts: [] } });
    const result = deriveCriterionScores([c], [t], [], [r], judged([c.id], t.id).criteria);
    expect(result.criterionScores[0]).toMatchObject({ pass: false, verificationStatus: "partial" });
  });

  it.each(["PROTECT-ALL", "SYS-INTEGRITY"])("a changed validationMethod cannot make %s a format shortcut", id => {
    const c = criterion(id, { validationMethod: "format-roundtrip" });
    const t = test("roundtrip", [id], { executionMode: "roundtrip", evidenceScope: "format" });
    const r = execution(t, { trace: [{ id: "rt", stage: "format-roundtrip", summary: "same bytes", status: "pass" }] });
    expect(hasDeterministicRoundtripProof(c, [t], [r])).toBe(false);
    const result = settleDeterministicEvaluation({ criteria: [c], testCases: [t], runs: [r] });
    expect(result.criterionScores?.[0].pass).toBe(false);
    expect(applyDeterministicRoundtripEvidence({ criteria: [c], testCases: [t], runs: [r], evaluation: result }).settledCriterionIds).toEqual([]);
  });

  it("keeps an observed protection violation as a schema-valid verified rejection despite a Judge score of 100", () => {
    const c = criterion("PROTECT-ALL"); const t = test("violation", [c.id]);
    const r = execution(t, { verificationStatus: "failed", output: "native assertion: original card is missing", trace: [{ id: "native", stage: "browser-assertion", summary: "original card missing", status: "fail" }] });
    const result = deriveCriterionScores([c], [t], [], [r], judged([c.id], t.id).criteria);
    expect(CriterionScoreSchema.parse(result.criterionScores[0])).toMatchObject({ score: 0, pass: false, verificationStatus: "verified" });
    expect(result.criterionScores[0].evidence.join(" ")).toContain("original card is missing");
  });

  it("leaves transport timeout with no product observation unverified, rather than starting product repair", () => {
    const c = criterion("PROTECT-ALL"); const t = test("timeout", [c.id]);
    const r = execution(t, { verificationStatus: "failed", output: "", error: "adapter timed out", trace: [] });
    expect(deriveCriterionScores([c], [t], [], [r], judged([c.id], t.id).criteria).criterionScores[0]).toMatchObject({ pass: false, verificationStatus: "unverified" });
  });

  it("preserves explicitly known non-HTML settlement while leaving unknown scope conservative", () => {
    const c = criterion("SYS-INTEGRITY"); const t = test("text", [c.id]); const r = execution(t);
    const scope = { sourceArtifacts: [SourceArtifactSchema.parse({ id: "A", name: "a.md", extension: "md", role: "target", textContent: "plain text", createdAt: "2026-10-13T00:00:00Z" })] };
    expect(settleAiEvaluation({ criteria: [c], testCases: [t], runs: [r], ai: judged([c.id], t.id), scope }).criterionScores?.[0]).toMatchObject({ pass: true, verificationStatus: "verified" });
    expect(settleAiEvaluation({ criteria: [c], testCases: [t], runs: [r], ai: judged([c.id], t.id) }).criterionScores?.[0]).toMatchObject({ pass: false, verificationStatus: "partial" });
  });

  it.each(["保留全部原有输出并支持格式往返", "Keep existing response payload unchanged and support format roundtrip"])("does not exempt mixed preservation/format contracts: %s", requirement => {
    const c = criterion("FORMAT", { title: "preservation", protectedConstraint: true, category: "artifact-specific", judgeType: "integrity", validationMethod: "format-roundtrip", requirement });
    const t = test("mixed-format", [c.id], { executionMode: "roundtrip", evidenceScope: "format" });
    const r = execution(t, { trace: [{ id: "rt", stage: "format-roundtrip", summary: "roundtrip", status: "pass" }] });
    expect(hasDeterministicRoundtripProof(c, [t], [r])).toBe(false);
    expect(deriveCriterionScores([c], [t], [], [r], judged([c.id], t.id).criteria).criterionScores[0]).toMatchObject({ pass: false, verificationStatus: "partial" });
  });

  it("retains an actual browser-step violation that includes error text", () => {
    const c = criterion("PROTECT-ALL"); const t = test("browser", [c.id]);
    const r = execution(t, { verificationStatus: "failed", error: "元素不可见:#actual", trace: [{ id: "native", stage: "browser-step", summary: "actual assertion failed", status: "fail" }] });
    expect(deriveCriterionScores([c], [t], [], [r], judged([c.id], t.id).criteria).criterionScores[0]).toMatchObject({ pass: false, verificationStatus: "verified" });
  });

  it("does not upgrade an infrastructure failure just because a generic error trace exists", () => {
    const c = criterion("PROTECT-ALL"); const t = test("infra", [c.id]);
    const r = execution(t, { verificationStatus: "failed", error: "timeout", trace: [{ id: "api", stage: "request", summary: "API timed out", status: "fail" }] });
    expect(deriveCriterionScores([c], [t], [], [r], judged([c.id], t.id).criteria).criterionScores[0]).toMatchObject({ pass: false, verificationStatus: "unverified" });
  });

  it("retains a separate exact FORMAT proof and a narrow unrelated semantic criterion", () => {
    const c = criterion("FORMAT", { validationMethod: "format-roundtrip", category: "artifact-specific" });
    const t = test("rt", [c.id], { executionMode: "roundtrip", evidenceScope: "format" });
    const r = execution(t, { trace: [{ id: "rt", stage: "format-roundtrip", summary: "same bytes", status: "pass" }] });
    expect(settleDeterministicEvaluation({ criteria: [c], testCases: [t], runs: [r] }).criterionScores?.[0])
      .toMatchObject({ pass: true, verificationStatus: "verified" });
    const narrow = criterion("SEARCH-LABEL", { requirement: "Search button is labelled Find" });
    expect(deriveCriterionScores([narrow], [test("one", [narrow.id])], [], [execution(test("one", [narrow.id]))], judged([narrow.id], "one").criteria).criterionScores[0])
      .toMatchObject({ pass: true, verificationStatus: "verified" });
  });
});
