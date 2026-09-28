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

/** Require the current version to have a verified receipt and score on the same Hidden paper. */
export function hasVerifiedHiddenBaseline(validation: ValidationRun, hiddenSuite: TestCase[]): boolean {
  const suiteIds = hiddenSuite.map((testCase) => testCase.id);
  const baselineIds = (validation.baselineRuns ?? []).map((run) => run.testCaseId);
  return Boolean(validation.baselineEvaluation && !validation.baselineEvaluation.demoJudged)
    && suiteIds.length > 0
    && validation.baselineSuiteIds?.length === suiteIds.length
    && suiteIds.every((id, index) => validation.baselineSuiteIds?.[index] === id)
    && baselineIds.length === suiteIds.length
    && new Set(baselineIds).size === baselineIds.length
    && baselineIds.every((id) => suiteIds.includes(id))
    && validation.baselineRuns.every((run) => run.verificationStatus === "verified")
    && Boolean(validation.baselineContextFingerprint)
    && Number.isFinite(validation.baselineObservedAt)
    && (validation.baselineObservedAt ?? 0) > 0;
}

/** A release needs both verified sides of the same Hidden paper. */
export function hasAuthoritativeHiddenRelease(validation: ValidationRun, candidateId: string, hiddenSuite: TestCase[]): boolean {
  return hasFullHiddenMeasurement(validation, candidateId, hiddenSuite)
    && validation.recommendation === "release"
    && validation.runs.every((run) => run.verificationStatus === "verified")
    && hasVerifiedHiddenBaseline(validation, hiddenSuite)
    && validation.evaluation?.safety !== "FAIL"
    && !(validation.evaluation?.unverifiedCriterionIds?.length);
}
