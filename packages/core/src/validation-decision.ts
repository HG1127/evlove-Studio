import type { EvaluationResult, EvolveProject } from "@evolution/contracts";
import { REGRESSION_TOLERANCE } from "./evaluation/gap";
import { indexScopedAcceptanceResults } from "./acceptance-result-identity";

function criterionScoresById(project: EvolveProject, evaluation: EvaluationResult) {
  return indexScopedAcceptanceResults([{
    requestedCriterionIds: project.acceptanceRubric.map((criterion) => criterion.id),
    results: evaluation.criterionScores ?? [],
  }]).byId;
}

export function validationHardRubricFailures(project: EvolveProject, evaluation: EvaluationResult) {
  const byId = criterionScoresById(project, evaluation);
  return project.acceptanceRubric.filter((criterion) => {
    if (!criterion.hardGate) return false;
    const result = byId.get(criterion.id);
    return Boolean(result && result.verificationStatus === "verified" && result.pass !== true);
  });
}

export function validationUnverifiedHardCriteria(project: EvolveProject, evaluation: EvaluationResult) {
  const byId = criterionScoresById(project, evaluation);
  return project.acceptanceRubric.filter((criterion) => {
    if (!criterion.hardGate) return false;
    const result = byId.get(criterion.id);
    return !result || result.verificationStatus !== "verified";
  });
}

/** Hidden Holdout regression requires a shared verified criterion on the same paper. */
export function validationRegression(project: EvolveProject, candidate: EvaluationResult, baseline: EvaluationResult) {
  if (!project.acceptanceRubric.length) {
    return candidate.accuracy < baseline.accuracy - REGRESSION_TOLERANCE
      || candidate.completeness < baseline.completeness - REGRESSION_TOLERANCE;
  }
  const candidateById = criterionScoresById(project, candidate);
  const baselineById = criterionScoresById(project, baseline);
  return project.acceptanceRubric.some((criterion) => {
    const current = candidateById.get(criterion.id);
    const prior = baselineById.get(criterion.id);
    return current?.verificationStatus === "verified"
      && prior?.verificationStatus === "verified"
      && current.testCaseIds.some((id) => prior.testCaseIds.includes(id))
      && current.score < prior.score - REGRESSION_TOLERANCE;
  });
}

export function validationDecision(project: EvolveProject, candidate: EvaluationResult, baseline: EvaluationResult) {
  const hardCriterionFailures = validationHardRubricFailures(project, candidate);
  const candidateById = criterionScoresById(project, candidate);
  const unverifiedCriteria = project.acceptanceRubric.filter((criterion) => candidateById.get(criterion.id)?.verificationStatus !== "verified");
  const unverifiedHardCriteria = unverifiedCriteria.filter((criterion) => criterion.hardGate);
  const baselineById = criterionScoresById(project, baseline);
  const comparisonEvidenceGaps = project.acceptanceRubric.filter((criterion) => {
    if (!criterion.hardGate || criterion.id === "SYS-PAIRWISE") return false;
    const current = candidateById.get(criterion.id);
    const prior = baselineById.get(criterion.id);
    if (current?.verificationStatus !== "verified") return false;
    return prior?.verificationStatus !== "verified"
      || !current.testCaseIds.some((id) => prior.testCaseIds.includes(id));
  });
  const regression = validationRegression(project, candidate, baseline);
  const totalWeight = project.acceptanceRubric.reduce((sum, criterion) => sum + criterion.weight, 0);
  const verifiedWeight = project.acceptanceRubric.reduce((sum, criterion) =>
    sum + (candidateById.get(criterion.id)?.verificationStatus === "verified" ? criterion.weight : 0), 0);
  const observedCoverage = project.acceptanceRubric.length && totalWeight > 0
    ? Math.round(verifiedWeight / totalWeight * 100)
    : unverifiedCriteria.length ? 0 : 100;
  const rubricCoverage = Math.min(candidate.verifiedRubricCoverage ?? 100, observedCoverage);
  const rubricFailed = project.acceptanceRubric.length > 0 && unverifiedCriteria.length === 0
    && rubricCoverage >= 100 && (candidate.rubricScore ?? 0) < 85;
  const safetyFailed = candidate.safety === "FAIL";
  return {
    hardCriterionFailures,
    unverifiedHardCriteria,
    unverifiedCriteria,
    comparisonEvidenceGaps,
    regression,
    rubricCoverage,
    rubricFailed,
    safetyFailed,
    hardFail: safetyFailed || rubricFailed || regression || hardCriterionFailures.length > 0,
    evidenceIncomplete: unverifiedCriteria.length > 0 || comparisonEvidenceGaps.length > 0 || rubricCoverage < 100,
  };
}

export function missingValidationEvidenceAction(criterion: EvolveProject["acceptanceRubric"][number]) {
  switch (criterion.validationMethod) {
    case "visual-review": return "需要真实浏览器/截图证据";
    case "manual-review": return "需要实际验收人结论";
    case "executable-test":
    case "user-scenario": return "需要真实 Target Runner";
    case "format-roundtrip": return "需要原格式 Roundtrip / 可打开性检查";
    case "static-structure":
    case "cross-artifact": return "需要文件结构 / 跨成果确定性检查";
    case "semantic-judge":
    default: return "需要当前成果的独立语义验收";
  }
}
