import { z } from "zod";
import {
  EvaluateAiResultSchema, HtmlProtectionProofBindingSchema,
  type AcceptanceCriterion, type EvolveProject, type TestCase,
} from "@evolution/contracts";
import { baselineDeferredComparisonCriterionIds } from "./baseline-comparison-phase";
import { baselineReadiness } from "./baseline-readiness";
import { htmlProtectionCoverageGap, isWholeProtectionCriterion, HTML_PROTECTION_SCOPE_GAP } from "./html-protection-scope";
import { criteriaRequiringJudge } from "./evaluation-settlement";
import { indexUniqueById } from "./identity-index";

export const ORIGINAL_HTML_BASELINE_DIAGNOSTIC_POLICY = "original-html-baseline-diagnostic-v1";
/** Internal App port material only. Parsing this DTO does not authenticate physical reads. */
export const OriginalHtmlBaselineDiagnosticBindingSchema = z.object({
  schemaVersion: z.literal("original-html-baseline-diagnostic-binding-v1"),
  binding: HtmlProtectionProofBindingSchema,
}).strict();
export type OriginalHtmlBaselineDiagnosticBinding = z.infer<typeof OriginalHtmlBaselineDiagnosticBindingSchema>;
export type OriginalHtmlBaselineDiagnosticEligibility = OriginalHtmlBaselineDiagnosticBinding & {
  policyVersion: typeof ORIGINAL_HTML_BASELINE_DIAGNOSTIC_POLICY;
  pendingCriterionIds: string[];
  limitations: string[];
};

/** Exact compiler system contract; normalized weight is deliberately not a scope shortcut. */
export function isCanonicalOriginalBaselineIntegrityCriterion(criterion: AcceptanceCriterion): boolean {
  return criterion.id === "SYS-INTEGRITY" && criterion.title === "成果完整性"
    && criterion.requirement === "最终成果必须完整、无截断、无占位符、无未处理 TODO，且不能因进化丢失未授权内容。"
    && criterion.source === "system-integrity" && criterion.hardGate === true
    && criterion.judgeType === "integrity" && criterion.validationMethod === "static-structure"
    && criterion.minScore === 95 && criterion.protectedConstraint === true && criterion.category === "integrity"
    && criterion.artifactIds.length === 0
    && criterion.evidenceExpected.length === 2
    && criterion.evidenceExpected[0] === "完整成果"
    && criterion.evidenceExpected[1] === "无 truncation / placeholder / unresolved TODO";
}

/** Select an unchanged visible case; no Champion, Hidden or other format is admitted. */
export function originalHtmlBaselineDiagnosticCase(project: EvolveProject): TestCase | undefined {
  if (project.campaign?.currentRound !== 0 || project.searchChampion) return undefined;
  const targets = (project.sourceArtifacts ?? []).filter(source => source.role === "target");
  const source = targets[0];
  if (targets.length !== 1 || !source || !/^(html|htm)$/i.test(source.extension)
    || source.artifactKind === "codebase" || ["codebase", "package"].includes(source.artifactDescriptor?.family ?? "")
    || !["upload", "remote"].includes(source.inputMode) || !Number.isInteger(source.size) || source.size <= 0) return undefined;
  const sources = indexUniqueById(project.sourceArtifacts, source => source.id);
  const rubric = indexUniqueById(project.acceptanceRubric, criterion => criterion.id);
  const paper = indexUniqueById(project.evalSuite, testCase => testCase.id);
  if (sources.duplicateIds.size || rubric.duplicateIds.size || paper.duplicateIds.size
    || project.evalSuite.some(item => item.hidden || item.criterionIds.length !== new Set(item.criterionIds).size
      || item.criterionIds.some(id => !rubric.byId.has(id)))) return undefined;
  const integrity = rubric.byId.get("SYS-INTEGRITY");
  if (!integrity || !isCanonicalOriginalBaselineIntegrityCriterion(integrity)) return undefined;
  const testCase = project.evalSuite.find(item => item.criterionIds.includes(integrity.id));
  if (!testCase || testCase.hidden || testCase.criterionIds.length !== new Set(testCase.criterionIds).size) return undefined;
  return testCase;
}

/**
 * Pure diagnosis qualification over THIS fresh measurement and trusted internal App reads.
 * It never authenticates serialized evidence, changes criterion scores, closes runtime
 * obligations, permits cache reuse, or supplies Hidden/Gate F/release authority.
 */
export function originalHtmlBaselineDiagnosticEligibility(args: {
  project: EvolveProject;
  initialBinding: unknown;
  finalBinding: unknown;
  independentJudge: unknown;
}): OriginalHtmlBaselineDiagnosticEligibility | undefined {
  const { project } = args;
  const testCase = originalHtmlBaselineDiagnosticCase(project);
  if (!testCase || project.baselineRun.status !== "completed" || !project.baselineRun.result
    || project.baselineRun.result.demoJudged || !baselineReadiness(project).ready) return undefined;
  const initial = OriginalHtmlBaselineDiagnosticBindingSchema.safeParse(args.initialBinding);
  const final = OriginalHtmlBaselineDiagnosticBindingSchema.safeParse(args.finalBinding);
  const judged = EvaluateAiResultSchema.safeParse(args.independentJudge);
  if (!initial.success || !final.success || !judged.success || judged.data.safety !== "PASS"
    || project.baselineRun.result.safety !== judged.data.safety) return undefined;
  // Bind both independently performed reads, including original paper identity. No SHA label alone admits a case.
  if (JSON.stringify(initial.data) !== JSON.stringify(final.data)) return undefined;
  const binding = final.data.binding, source = project.sourceArtifacts.find(item => item.role === "target")!;
  if (binding.missionId !== project.id || binding.testCaseId !== testCase.id || binding.criterionId !== "SYS-INTEGRITY"
    || binding.subject.kind !== "current" || binding.subject.versionId !== project.version
    || binding.original.sourceArtifactId !== source.id || binding.executed.sourceArtifactId !== source.id
    || binding.original.sha256 !== binding.executed.sha256
    || binding.original.byteLength !== source.size || binding.executed.byteLength !== source.size) return undefined;
  const deferred = baselineDeferredComparisonCriterionIds(project);
  const cases = project.evalSuite.map(item => ({ ...item, criterionIds: item.criterionIds.filter(id => !deferred.has(id)) }))
    .filter(item => item.criterionIds.length > 0 || project.evalSuite.find(original => original.id === item.id)?.criterionIds.length === 0);
  const runs = indexUniqueById(project.baselineRun.runs, run => run.testCaseId);
  const scores = indexUniqueById(project.baselineRun.result.criterionScores ?? [], score => score.criterionId);
  if (runs.duplicateIds.size || scores.duplicateIds.size || !cases.length
    || project.baselineRun.runs.length !== project.evalSuite.length
    || project.evalSuite.some(item => !runs.byId.has(item.id))) return undefined;
  // Narrow initial implementation: a failed/partial/unverified/error run is never waived.
  // Complete product rejection recorded as VERIFIED still qualifies as a diagnostic deficit.
  if (cases.some(item => {
    const run = runs.byId.get(item.id);
    return !run || run.error || run.verificationStatus !== "verified" || !run.output.trim()
      || run.artifactHash !== binding.executed.sha256;
  })) return undefined;
  const caseIds = new Set(cases.map(item => item.id));
  if (project.baselineRun.runs.some(run => !project.evalSuite.some(item => item.id === run.testCaseId))) return undefined;
  const currentGoals = project.acceptanceRubric.filter(criterion => criterion.hardGate && !criterion.protectedConstraint
    && criterion.category === "outcome" && !deferred.has(criterion.id));
  if (!currentGoals.length || currentGoals.some(criterion => scores.byId.get(criterion.id)?.verificationStatus !== "verified")) return undefined;
  const expectedJudgeCriteria = criteriaRequiringJudge(project.acceptanceRubric, cases, project.baselineRun.runs);
  const criterionIds = new Set(expectedJudgeCriteria.map(criterion => criterion.id));
  const judgeCaseIds = new Set(cases.filter(item => item.criterionIds.some(id => criterionIds.has(id))).map(item => item.id));
  const exactIds = (actual: string[], expected: ReadonlySet<string>) => actual.length === expected.size
    && new Set(actual).size === actual.length && actual.every(id => expected.has(id));
  if (!exactIds(judged.data.criteria.map(item => item.criterionId), criterionIds)
    || !exactIds(judged.data.cases.map(item => item.testCaseId), judgeCaseIds)
    || judged.data.criteria.some(item => !exactIds(item.testCaseIds,
      new Set(cases.filter(test => test.criterionIds.includes(item.criterionId)).map(test => test.id))))) return undefined;
  const integrity = project.acceptanceRubric.find(criterion => criterion.id === "SYS-INTEGRITY")!;
  const integrityScore = scores.byId.get(integrity.id);
  const mapped = cases.filter(item => item.criterionIds.includes(integrity.id));
  if (!mapped.length || mapped.some(item => item.tags?.includes("source-grounded-html-assertions"))
    || !integrityScore || integrityScore.verificationStatus !== "partial" || integrityScore.pass
    || !integrityScore.gaps.includes(HTML_PROTECTION_SCOPE_GAP) || !integrityScore.testCaseIds.length
    || integrityScore.testCaseIds.some(id => !caseIds.has(id) || !mapped.some(item => item.id === id))) return undefined;
  // Every other current hard requirement retains the existing evidence boundary, even if it also declares protection.
  if (project.acceptanceRubric.some(criterion => criterion.hardGate && criterion.id !== integrity.id && !deferred.has(criterion.id)
    && scores.byId.get(criterion.id)?.verificationStatus !== "verified")) return undefined;
  if (htmlProtectionCoverageGap(integrity, project) !== HTML_PROTECTION_SCOPE_GAP) return undefined;
  return {
    ...final.data, policyVersion: ORIGINAL_HTML_BASELINE_DIAGNOSTIC_POLICY,
    pendingCriterionIds: project.acceptanceRubric.filter(criterion => isWholeProtectionCriterion(criterion)
      && scores.byId.get(criterion.id)?.pass !== true).map(criterion => criterion.id),
    limitations: ["Fresh original/current file measurement is usable for diagnosis only.",
      "Whole protection remains partial/unverified and not passed; semantic, visual and runtime residuals remain open.",
      "This record grants no cached Baseline, Hidden, Gate F, delivery or release authority.",
      "Safety comes from the supplied independent current Judge; unmeasured deterministic safety is not upgraded."],
  };
}
