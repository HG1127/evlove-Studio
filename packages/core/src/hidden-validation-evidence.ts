import type { TestCase, ValidationRun } from "@evolution/contracts";

/** A full Holdout must carry one distinct execution receipt for every current Hidden Test Case. */
export function hasFullHiddenMeasurement(validation: ValidationRun, candidateId: string, hiddenSuite: TestCase[]): boolean {
  const expectedIds = hiddenSuite.map((testCase) => testCase.id);
  const observedIds = (validation.runs ?? []).map((run) => run.testCaseId);
  const expected = new Set(expectedIds);
  return Boolean(candidateId
    && validation.status === "completed"
    && validation.validationMode === "full"
    && validation.candidateId === candidateId
    && validation.evaluation
    && !validation.evaluation.demoJudged
    && expectedIds.length > 0
    && expectedIds.every(Boolean)
    && expected.size === expectedIds.length
    && observedIds.length === expectedIds.length
    && new Set(observedIds).size === observedIds.length
    && observedIds.every((id) => expected.has(id))
    && (validation.plannedCases === undefined || validation.plannedCases === expectedIds.length)
    && (validation.executedCases === undefined || validation.executedCases === expectedIds.length));
}

/** A complete, non-demo measurement with no declared evidence gap may authorize delivery. */
export function hasAuthoritativeHiddenRelease(validation: ValidationRun, candidateId: string, hiddenSuite: TestCase[]): boolean {
  return hasFullHiddenMeasurement(validation, candidateId, hiddenSuite)
    && validation.recommendation === "release"
    && validation.runs.every((run) => run.verificationStatus === "verified")
    && validation.evaluation?.safety !== "FAIL"
    && !(validation.evaluation?.unverifiedCriterionIds?.length);
}
