import type {EvaluationResult,EvolveProject} from "@evolution/contracts";
import {experimentEvidencePendingOnly} from "./experiment-winner";
import {USER_GOAL_SCOPE_POLICY,userGoalProgress} from "./user-goal-scope";

export const EXPERIMENT_EVIDENCE_ADMISSION_VERSION="experiment-evidence-admission-v2";

/** Missing observations cannot erase an already measured failure of the opted-in full user goal. */
export function candidateEvidencePendingDecision(project:EvolveProject,evaluation:EvaluationResult,baseline:EvaluationResult){
  if(!experimentEvidencePendingOnly(evaluation))return {eligible:false,reason:"not-evidence-only",regressedCriterionIds:[] as string[]};
  if(project.experimentPolicy?.winnerGoalScope===USER_GOAL_SCOPE_POLICY){
    const progress=userGoalProgress(project,evaluation,baseline);
    if(progress.regressedCriterionIds.length)return {eligible:false,reason:"verified-user-goal-regression",regressedCriterionIds:progress.regressedCriterionIds};
    if(progress.ready&&(progress.weightedDelta??0)<1)return {eligible:false,reason:"verified-user-goal-gain-below-threshold",regressedCriterionIds:[] as string[]};
  }
  return {eligible:true,reason:"evidence-only",regressedCriterionIds:[] as string[]};
}
