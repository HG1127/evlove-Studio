import type {EvolveProject,ValidationRun} from "@evolution/contracts";
import {indexScopedAcceptanceResults} from "./acceptance-result-identity";

/** Legacy absolute-failure selector. Its meaning is unchanged for v1 repair records. */
export function verifiedValidationFailures(project:EvolveProject,validation:ValidationRun){
  const scores=indexScopedAcceptanceResults([{requestedCriterionIds:project.acceptanceRubric.map(item=>item.id),results:validation.evaluation?.criterionScores??[]}]).byId;
  return project.acceptanceRubric.filter(criterion=>{
    const score=scores.get(criterion.id);
    return score?.verificationStatus==="verified"&&score.pass!==true;
  });
}
