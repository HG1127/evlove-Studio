import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion, EvaluateAiResult, EvolveProject } from "@evolution/contracts";
import { settleAiEvaluation } from "./evaluation-settlement";
import { HTML_PROTECTION_SCOPE_GAP, htmlProtectionAcceptanceBlocker } from "./html-protection-scope";
import { assessOriginalHtmlBaselineDiagnosticEligibility, originalHtmlBaselineDiagnosticCase, originalHtmlBaselineDiagnosticEligibility, originalHtmlBaselineDiagnosticUsesFixedArtifact,
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
  it.each(["initial", "final"])("distinguishes invalid %s binding without exposing supplied values", side => {
    const args = fixture();
    const assessed = assessOriginalHtmlBaselineDiagnosticEligibility({ ...args,
      [side === "initial" ? "initialBinding" : "finalBinding"]: { privateError: "private-boundary-data" } });
    expect(assessed).toEqual({ status: "pending", reason: "physical-binding-invalid" });
    expect(JSON.stringify(assessed)).not.toContain("private-boundary-data");
  });
  it("distinguishes malformed independent Judge material", () => {
    const assessed = assessOriginalHtmlBaselineDiagnosticEligibility({ ...fixture(), independentJudge: { privateError: "private-judge-data" } });
    expect(assessed).toEqual({ status: "pending", reason: "independent-judge-invalid" });
    expect(JSON.stringify(assessed)).not.toContain("private-judge-data");
  });
  it.each(["FAIL", "REVIEW"] as const)("retains settled/raw %s with specific refusal even at perfect scores and no reasons", safety => {
    const args = fixture();
    args.independentJudge.safety = safety;
    args.independentJudge.accuracy = 100;
    args.independentJudge.evidence = 100;
    args.independentJudge.completeness = 100;
    for (const criterion of args.independentJudge.criteria) { criterion.score = 100; criterion.pass = true; criterion.gaps = []; }
    args.project.baselineRun.result = settleAiEvaluation({ criteria: args.project.acceptanceRubric,
      testCases: args.project.evalSuite, runs: args.project.baselineRun.runs, ai: args.independentJudge, scope: args.project });
    const before = JSON.stringify(args);
    expect(assessOriginalHtmlBaselineDiagnosticEligibility(args)).toEqual({ status: "pending", reason: "independent-judge-safety-" + safety.toLowerCase() });
    expect(originalHtmlBaselineDiagnosticEligibility(args)).toBeUndefined();
    expect(args.project.baselineRun.result).toMatchObject({ safety, notes: [], failures: [] });
    expect(JSON.stringify(args)).toBe(before);
  });
  it.each(["PASS", "FAIL", "REVIEW"] as const)("rejects raw/settled %s mismatch before diagnosing safety", safety => {
    const args = fixture(); args.independentJudge.safety = safety;
    args.project.baselineRun.result!.safety = safety === "PASS" ? "REVIEW" : "PASS";
    expect(assessOriginalHtmlBaselineDiagnosticEligibility(args)).toEqual({ status: "pending", reason: "independent-judge-safety-mismatch" });
  });
  it("preserves an observed protection redline and refuses diagnosis", () => {
    const args = fixture(); args.independentJudge.safety = "FAIL";
    args.independentJudge.notes = ["G: observed unauthorized destruction of protected content"];
    args.independentJudge.failures = ["Explicit protected constraint violated in G"];
    args.project.baselineRun.result = settleAiEvaluation({ criteria: args.project.acceptanceRubric,
      testCases: args.project.evalSuite, runs: args.project.baselineRun.runs, ai: args.independentJudge, scope: args.project });
    const before = JSON.stringify(args);
    expect(assessOriginalHtmlBaselineDiagnosticEligibility(args)).toEqual({ status: "pending", reason: "independent-judge-safety-fail" });
    expect(JSON.stringify(args)).toBe(before);
  });
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
    expect(assessed).toEqual({ status: "pending", reason: "physical-binding-invalid" });
    expect(JSON.stringify(assessed)).not.toContain("do-not-retain-private-data");
  });
});

describe("fixed uploaded original diagnostic reference classification", () => {
  function uploaded() {
    const project = fixture().project;
    project.sourceArtifacts[0]!.storageRef = "synthetic-full-original";
    project.protectedItems = ["original facts"];
    project.acceptanceRubric.push({ id: "PROTECT-ALL", title: "Original facts", requirement: "Preserve original facts",
      source: "protected-item", weight: 0, hardGate: true, judgeType: "pairwise", validationMethod: "semantic-judge", minScore: 95,
      evidenceExpected: ["与原始版本对比确认未破坏：original facts"], protectedConstraint: true, artifactIds: [], category: "protected" });
    project.evalSuite.push({ ...project.evalSuite[0]!, id: "FUTURE", criterionIds: ["PROTECT-ALL"], executionMode: "external-runner",
      browserSteps: [{ action: "click", selector: "#synthetic" }] });
    project.hiddenEvalSuite = [{ ...project.evalSuite[0]!, id: "HIDDEN", hidden: true, executionMode: "visual-review" }];
    return project;
  }
  it("classifies only the fixed current reference, leaving both papers and scores unchanged", () => {
    const project = uploaded(), before = JSON.stringify(project);
    expect(originalHtmlBaselineDiagnosticUsesFixedArtifact(project)).toBe(true);
    expect(JSON.stringify(project)).toBe(before);
    expect(project.baselineRun.result?.criterionScores?.find(row => row.criterionId === "SYS-INTEGRITY"))
      .toMatchObject({ verificationStatus: "partial", pass: false });
    expect(htmlProtectionAcceptanceBlocker(project)).toBeTruthy();
  });
  it.each(["external-runner", "visual-review"] as const)("retains live time for current %s", mode => {
    const project = uploaded(); project.evalSuite[0]!.executionMode = mode;
    expect(originalHtmlBaselineDiagnosticUsesFixedArtifact(project)).toBe(false);
  });
  it.each(["artifact-runtime", "static-evidence"] as const)("rejects browser steps mislabeled %s", mode => {
    const project = uploaded(); project.evalSuite[0]!.executionMode = mode;
    project.evalSuite[0]!.browserSteps = [{ action: "click", selector: "#synthetic" }];
    expect(originalHtmlBaselineDiagnosticUsesFixedArtifact(project)).toBe(false);
  });
  it.each(["mixed", "empty", "noncanonical", "unknown-criterion"])("keeps %s external cases in the current scope", kind => {
    const project = uploaded(), future = project.evalSuite[2]!;
    if (kind === "mixed") future.criterionIds.push("DETAIL");
    if (kind === "empty") future.criterionIds = [];
    if (kind === "noncanonical") project.acceptanceRubric[2]!.source = "user-command";
    if (kind === "unknown-criterion") future.criterionIds = ["unknown"];
    expect(originalHtmlBaselineDiagnosticUsesFixedArtifact(project)).toBe(false);
  });
  it.each(["http", "connector", "remote", "missing-blob", "whitespace-blob", "later-round", "champion", "non-html", "multi-target", "paste", "duplicate-case", "duplicate-rubric"])("does not classify %s as a fixed original reference", kind => {
    const project = uploaded(), source = project.sourceArtifacts[0]!;
    if (kind === "http" || kind === "connector") project.targetConnection.adapter = kind;
    if (kind === "remote") source.inputMode = "remote";
    if (kind === "missing-blob") source.storageRef = undefined;
    if (kind === "whitespace-blob") source.storageRef = "  ";
    if (kind === "later-round") project.campaign.currentRound = 1;
    if (kind === "champion") project.searchChampion = {} as NonNullable<EvolveProject["searchChampion"]>;
    if (kind === "non-html") source.extension = "md";
    if (kind === "multi-target") project.sourceArtifacts.push({ ...source, id: "extra" });
    if (kind === "paste") source.inputMode = "paste";
    if (kind === "duplicate-case") project.evalSuite.push(project.evalSuite[0]!);
    if (kind === "duplicate-rubric") project.acceptanceRubric.push(project.acceptanceRubric[0]!);
    expect(originalHtmlBaselineDiagnosticUsesFixedArtifact(project)).toBe(false);
  });
});