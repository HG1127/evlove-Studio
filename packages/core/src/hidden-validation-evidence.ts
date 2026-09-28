import type { ValidationRun } from "@evolution/contracts";

/** A recommendation alone is not an independently measured Hidden result. */
export function hasFullHiddenMeasurement(validation: ValidationRun, candidateId: string): boolean {
  return Boolean(candidateId
    && validation.status === "completed"
    && validation.validationMode === "full"
    && validation.candidateId === candidateId
    && validation.evaluation
    && !validation.evaluation.demoJudged);
}

/** A complete, non-demo measurement with no declared evidence gap may authorize delivery. */
export function hasAuthoritativeHiddenRelease(validation: ValidationRun, candidateId: string): boolean {
  return hasFullHiddenMeasurement(validation, candidateId)
    && validation.recommendation === "release"
    && validation.evaluation?.safety !== "FAIL"
    && !(validation.evaluation?.unverifiedCriterionIds?.length);
}
