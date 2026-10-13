import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion, EvaluateAiResult, EvolveProject } from "@evolution/contracts";
import { settleAiEvaluation } from "./evaluation-settlement";
import { HTML_PROTECTION_SCOPE_GAP, htmlProtectionAcceptanceBlocker } from "./html-protection-scope";
import { assessOriginalHtmlBaselineDiagnosticEligibility, originalHtmlBaselineDiagnosticCase, originalHtmlBaselineDiagnosticEligibility,
  type OriginalHtmlBaselineDiagnosticBinding } from "./original-html-baseline-diagnostic";
const digest = "a".repeat(64);
function fixture() {
  const integrity: AcceptanceCriterion = { id: "SYS-INTEGRITY", title: "成果完整性",
    requirement: "最终成果必须完整、无截断、无占位符、无未处理 TODO，且不能因进化丢失未授权内容。",
    source: "system-integrity", weight: 8, hardGate: true, judgeType: "integrity", validationMethod: "static-structure", minScore: 95,
    evidenceExpected: ["完整成果", "无 truncation / placeholder / unresolved TODO"], protectedConstraint: true, artifactIds: [], category: "integrity" };
  const goal: AcceptanceCriterion = { id: "DETAIL", title: "解释配置", requirement: "当前说明列明配置",
    source: "user-command", weight: 92, hardGate: true, judgeType: "llm", validationMethod: "semantic-judge", minScore: 90,
    evidenceExpected: ["配置说明"], protectedConstraint: false, artifactIds: ["source"], category: "outcome" };
  const project = { id: "mission", version: "V1", campaign: { currentRound: 0 }, protectedItems: [],
    sourceArtifacts: [{ id: "source", role: "target", extension: "html", name: "source.html", inputMode: "upload", size: 123,
      artifactKind: "document", mimeType: "text/html" }], targetConnection: { adapter: "artifact" },
    acceptanceRubric: [goal, integrity],
    evalSuite: [{ id: "G", hidden: false, criterionIds: [goal.id], executionMode: "artifact-runtime", tags: [] },
      { id: "I", hidden: false, criterionIds: [integrity.id], executionMode: "static-evidence", tags: [] }],
    baselineRun: { id: "baseline", status: "completed", runs: ["G", "I"].map(testCaseId => ({ testCaseId,
      output: "Actual current file observations. Required configuration explanation absent.", artifactHash: digest,
      verificationStatus: "verified", trace: [], latencyMs: 1, cost: 0 })) },
  } as unknown as EvolveProject;
  const independentJudge: EvaluateAiResult = { accuracy: 70, evidence: 90, riskCoverage: 70, completeness: 70, safety: "PASS", notes: [], failures: [],
    cases: ["G", "I"].map(testCaseId => ({ testCaseId, accuracy: 70, evidence: 90, completeness: 70, reason: "Current file inspected" })),
    criteria: [{ criterionId: goal.id, score: 70, pass: false, evidence: ["G: Config explanation absent"], gaps: ["Config incomplete"], testCaseIds: ["G"] },
      { criterionId: integrity.id, score: 95, pass: true, evidence: ["I: Complete static source"], gaps: [], testCaseIds: ["I"] }] };
  project.baselineRun.result = settleAiEvaluation({ criteria: project.acceptanceRubric, testCases: project.evalSuite,
    runs: project.baselineRun.runs, ai: independentJudge, scope: project });
  const initialBinding: OriginalHtmlBaselineDiagnosticBinding = { schemaVersion: "original-html-baseline-diagnostic-binding-v1", binding: {
    missionId: project.id, testCaseId: "I", criterionId: integrity.id, paperSha256: "b".repeat(64),
    original: { sourceArtifactId: "source", sha256: digest, byteLength: 123 },
    executed: { sourceArtifactId: "source", sha256: digest, byteLength: 123 }, subject: { kind: "current", versionId: "V1" } } };
  return { project, independentJudge, initialBinding, finalBinding: structuredClone(initialBinding) };
}
describe("fresh original HTML diagnosis qualification is not protection acceptance", () => {
  it("admits a verified current goal deficit while preserving whole partial/pass false and release blocker", () => {
    const args = fixture(), scores = structuredClone(args.project.baselineRun.result!.criterionScores);
    const eligible = originalHtmlBaselineDiagnosticEligibility(args);
    expect(eligible).toMatchObject({ policyVersion: "original-html-baseline-diagnostic-v1", pendingCriterionIds: ["SYS-INTEGRITY"] });
    expect(args.project.baselineRun.result!.criterionScores).toEqual(scores);
    expect(scores!.find(item => item.criterionId === "SYS-INTEGRITY")).toMatchObject({ verificationStatus: "partial", pass: false });
    expect(scores!.find(item => item.criterionId === "DETAIL")).toMatchObject({ verificationStatus: "verified", pass: false });
    expect(htmlProtectionAcceptanceBlocker(args.project)).toBe(HTML_PROTECTION_SCOPE_GAP);
    expect(eligible).not.toHaveProperty("wholeProtectionPassed");
  });
  it.each<Partial<AcceptanceCriterion>>([{ title: "Renamed" }, { requirement: "All runtime functions work" }, { source: "user-command" },
    { hardGate: false }, { judgeType: "llm" }, { validationMethod: "manual-review" }, { protectedConstraint: false }, { category: "protected" },
    { artifactIds: ["source"] }, { evidenceExpected: ["完整成果"] }, { minScore: 90 }])("rejects a noncanonical same-ID contract %j", patch => {
    const args = fixture(); Object.assign(args.project.acceptanceRubric[1]!, patch);
    expect(originalHtmlBaselineDiagnosticCase(args.project)).toBeUndefined();
    expect(originalHtmlBaselineDiagnosticEligibility(args)).toBeUndefined();
  });
  it.each(["later-round", "champion", "non-html", "package", "missing-target", "multi-target", "paste", "duplicate-source", "duplicate-case", "hidden-case"])("rejects %s initial scope", variant => {
    const args = fixture(), source = args.project.sourceArtifacts[0]!;
    if (variant === "later-round") args.project.campaign.currentRound = 1;
    if (variant === "champion") args.project.searchChampion = {} as NonNullable<EvolveProject["searchChampion"]>;
    if (variant === "non-html") source.extension = "md";
    if (variant === "package") source.artifactKind = "codebase";
    if (variant === "missing-target") args.project.sourceArtifacts = [];
    if (variant === "multi-target") args.project.sourceArtifacts.push({ ...source, id: "extra" });
    if (variant === "paste") source.inputMode = "paste";
    if (variant === "duplicate-source") args.project.sourceArtifacts.push(source);
    if (variant === "duplicate-case") args.project.evalSuite.push(args.project.evalSuite[0]!);
    if (variant === "hidden-case") args.project.evalSuite[0]!.hidden = true;
    expect(originalHtmlBaselineDiagnosticEligibility(args)).toBeUndefined();
  });
  it.each(["missing-port", "final-drift", "foreign-mission", "candidate", "wrong-version", "wrong-test", "wrong-paper", "size", "sha-label"])("rejects %s physical material", variant => {
    const args = fixture();
    if (variant === "missing-port") return expect(originalHtmlBaselineDiagnosticEligibility({ ...args, initialBinding: undefined })).toBeUndefined();
    const binding = args.finalBinding.binding;
    if (variant === "final-drift") binding.executed.sha256 = "c".repeat(64);
    if (variant === "foreign-mission") binding.missionId = "other";
    if (variant === "candidate") binding.subject = { kind: "candidate", candidateId: "candidate" };
    if (variant === "wrong-version") binding.subject = { kind: "current", versionId: "V2" };
    if (variant === "wrong-test") binding.testCaseId = "G";
    if (variant === "wrong-paper") binding.paperSha256 = "c".repeat(64);
    if (variant === "size") binding.original.byteLength++;
    if (variant === "sha-label") { binding.original.sha256 = "c".repeat(64); binding.executed.sha256 = "c".repeat(64); args.initialBinding = structuredClone(args.finalBinding); }
    expect(originalHtmlBaselineDiagnosticEligibility(args)).toBeUndefined();
  });
  it.each(["unverified", "partial", "failed", "error", "unbound", "missing", "duplicate", "foreign-run", "source-search-tag"])("does not waive %s current observations", variant => {
    const args = fixture(), run = args.project.baselineRun.runs[0]!;
    if (["unverified", "partial", "failed"].includes(variant)) run.verificationStatus = variant as "unverified" | "partial" | "failed";
    if (variant === "error") run.error = "Execution failed";
    if (variant === "unbound") run.artifactHash = undefined;
    if (variant === "missing") args.project.baselineRun.runs.pop();
    if (variant === "duplicate") args.project.baselineRun.runs.push(run);
    if (variant === "foreign-run") args.project.baselineRun.runs.push({ ...run, testCaseId: "foreign" });
    if (variant === "source-search-tag") args.project.evalSuite[1]!.tags = [...args.project.evalSuite[1]!.tags, "source-grounded-html-assertions"];
    expect(originalHtmlBaselineDiagnosticEligibility(args)).toBeUndefined();
  });
  it.each(["absent", "FAIL", "REVIEW", "missing-criterion", "foreign-case", "duplicate-case", "wrong-mapping", "duplicate-mapping", "missing-mapping", "deterministic-safety", "other-hard-gap"])("rejects %s Judge/decision material", variant => {
    const args = fixture();
    if (variant === "absent") return expect(originalHtmlBaselineDiagnosticEligibility({ ...args, independentJudge: undefined })).toBeUndefined();
    if (variant === "FAIL" || variant === "REVIEW") args.independentJudge.safety = variant;
    if (variant === "missing-criterion") args.independentJudge.criteria.pop();
    if (variant === "foreign-case") args.independentJudge.cases[0]!.testCaseId = "foreign";
    if (variant === "duplicate-case") args.independentJudge.cases.push(args.independentJudge.cases[0]!);
    if (variant === "wrong-mapping") args.independentJudge.criteria[1]!.testCaseIds = ["G"];
    if (variant === "duplicate-mapping") args.independentJudge.criteria[1]!.testCaseIds = ["I", "I"];
    if (variant === "missing-mapping") args.independentJudge.criteria[1]!.testCaseIds = [];
    if (variant === "deterministic-safety") args.project.baselineRun.result!.safety = "REVIEW";
    if (variant === "other-hard-gap") args.project.baselineRun.result!.criterionScores![0]!.verificationStatus = "unverified";
    expect(originalHtmlBaselineDiagnosticEligibility(args)).toBeUndefined();
  });
});


describe("traceable original Baseline diagnosis refusals", () => {
  it("returns the unchanged qualification through both entry points", () => {
    const args = fixture(), before = JSON.stringify(args);
    const assessed = assessOriginalHtmlBaselineDiagnosticEligibility(args);
    expect(assessed.status).toBe("eligible");
    if (assessed.status === "eligible") expect(assessed.eligibility).toEqual(originalHtmlBaselineDiagnosticEligibility(args));
    expect(JSON.stringify(args)).toBe(before);
  });
  it.each(["criterion", "case", "criterion-case"])("preserves a settled score but rejects raw Judge %s coverage mismatch", variant => {
    const args = fixture();
    if (variant === "criterion") args.independentJudge.criteria[0]!.criterionId = "foreign";
    if (variant === "case") args.independentJudge.cases[0]!.testCaseId = "foreign";
    if (variant === "criterion-case") args.independentJudge.criteria[0]!.testCaseIds.push("I");
    const before = JSON.stringify(args.project.baselineRun.result);
    const assessed = assessOriginalHtmlBaselineDiagnosticEligibility(args);
    expect(assessed).toEqual({ status: "pending", reason: "judge-" + variant + "-coverage-mismatch" });
    expect(originalHtmlBaselineDiagnosticEligibility(args)).toBeUndefined();
    expect(JSON.stringify(args.project.baselineRun.result)).toBe(before);
  });
  it("reports changed physical binding without emitting supplied values", () => {
    const args = fixture(); args.finalBinding.binding.paperSha256 = "c".repeat(64);
    const assessed = assessOriginalHtmlBaselineDiagnosticEligibility(args);
    expect(assessed).toEqual({ status: "pending", reason: "physical-binding-changed" });
    expect(JSON.stringify(assessed)).not.toContain("c".repeat(64));
  });
  it("reports invalid material without retaining private text", () => {
    const args = fixture();
    const assessed = assessOriginalHtmlBaselineDiagnosticEligibility({ ...args, initialBinding: { privateError: "do-not-retain-private-data" } });
    expect(assessed).toEqual({ status: "pending", reason: "binding-or-judge-boundary-invalid" });
    expect(JSON.stringify(assessed)).not.toContain("do-not-retain-private-data");
  });
});
