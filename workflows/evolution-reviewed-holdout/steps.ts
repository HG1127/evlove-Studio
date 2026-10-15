import type {ReviewedHoldoutContinuation} from "../../apps/backend/src/services/reviewed-holdout-execution";
import {executeReviewedHoldout,acceptReviewedHoldout} from "../../apps/backend/src/services/reviewed-holdout-execution";

export async function executeReviewedHoldoutStep(input:unknown){
  "use step";
  return executeReviewedHoldout(input);
}
executeReviewedHoldoutStep.maxRetries=0;
export async function acceptReviewedHoldoutStep(input:unknown,context:ReviewedHoldoutContinuation){
  "use step";
  return acceptReviewedHoldout(input,context);
}
acceptReviewedHoldoutStep.maxRetries=0;
