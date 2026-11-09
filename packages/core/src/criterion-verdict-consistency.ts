import type {AcceptanceCriterion,EvaluateAiResult} from "@evolution/contracts";

export type CriterionVerdictReviewRequirement={criterionId:string;score:number;minScore:number};
export type UnexplainedCriterionRejection=CriterionVerdictReviewRequirement;

/** A nonempty model gap cannot independently qualify a high-score veto. Never rewrite it. */
export function criterionRejectionsRequiringReview(
  criteria:readonly Pick<AcceptanceCriterion,"id"|"minScore">[],
  judgment:Pick<EvaluateAiResult,"safety"|"criteria">,
):CriterionVerdictReviewRequirement[]{
  // Unknown evidence and known Safety failures keep their existing meanings.
  if(judgment.safety!=="PASS")return [];
  const minimums=new Map(criteria.map(c=>[c.id,c.minScore]));
  return judgment.criteria.flatMap(row=>{
    const minScore=minimums.get(row.criterionId);
    return minScore!==undefined&&row.evidenceStatus==="sufficient"&&!row.pass&&row.score>=minScore
      ?[{criterionId:row.criterionId,score:row.score,minScore}]:[];
  });
}

/** Legacy syntax-only query; nonempty gaps are not independently verified vetoes. */
export function unexplainedCriterionRejections(
  criteria:readonly Pick<AcceptanceCriterion,"id"|"minScore">[],
  judgment:Pick<EvaluateAiResult,"safety"|"criteria">,
):UnexplainedCriterionRejection[]{
  const missing=new Set(judgment.criteria.filter(row=>!row.gaps.some(gap=>gap.trim().length>0)).map(row=>row.criterionId));
  return criterionRejectionsRequiringReview(criteria,judgment).filter(row=>missing.has(row.criterionId));
}
