import type { AcceptanceCriterion, EvolveProject } from "@evolution/contracts";

export const BASELINE_COMPARISON_PHASE_VERSION = "original-baseline-comparison-v1";

type BaselineComparisonProject = Pick<EvolveProject, "acceptanceRubric" | "protectedItems" | "searchChampion">
  & { campaign: Pick<EvolveProject["campaign"], "currentRound"> };

/** Recognize the compiler's original-preservation relation, never arbitrary protected/manual requirements. */
function canonicalOriginalProtection(project: BaselineComparisonProject, criterion: AcceptanceCriterion) {
  return criterion.id === "PROTECT-ALL" && criterion.source === "protected-item"
    && criterion.judgeType === "pairwise" && criterion.validationMethod === "semantic-judge"
    && criterion.protectedConstraint && criterion.hardGate && criterion.category === "protected"
    && project.protectedItems.length > 0
    && project.protectedItems.every(item => criterion.requirement.includes(item)
      && criterion.evidenceExpected.includes("与原始版本对比确认未破坏：" + item));
}

/**
 * Only a visible original-file Baseline defers future Candidate comparison.
 * Draft Candidates do not replace the current arm. A Champion/later round must
 * still prove current preservation. This policy never applies to paired Hidden,
 * Experiment settlement or Gate F, even when their current arm reads the Source.
 */
export function baselineDeferredComparisonCriterionIds(project: BaselineComparisonProject) {
  const originalCurrent = project.campaign?.currentRound === 0 && !project.searchChampion;
  return new Set(project.acceptanceRubric.filter(criterion => criterion.id === "SYS-PAIRWISE"
    || originalCurrent && canonicalOriginalProtection(project, criterion)).map(criterion => criterion.id));
}
