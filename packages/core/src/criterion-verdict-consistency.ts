import type {AcceptanceCriterion,EvaluateAiResult} from "@evolution/contracts";

export type UnexplainedCriterionRejection={criterionId:string;score:number;minScore:number};

/** Report missing rejection rationale; never derive or overwrite a model verdict. */
export function unexplainedCriterionRejections(
  criteria:readonly Pick<AcceptanceCriterion,"id"|"minScore">[],
  judgment:Pick<EvaluateAiResult,"safety"|"criteria">,
):UnexplainedCriterionRejection[]{
  // Unknown evidence and known Safety failures keep their existing meanings.
  if(judgment.safety!=="PASS")return [];
  const minimums=new Map(criteria.map(c=>[c.id,c.minScore]));
  return judgment.criteria.flatMap(row=>{
    const minScore=minimums.get(row.criterionId);
    return minScore!==undefined&&row.evidenceStatus==="sufficient"&&!row.pass&&row.score>=minScore
      &&!row.gaps.some(gap=>gap.trim().length>0)
      ?[{criterionId:row.criterionId,score:row.score,minScore}]:[];
  });
}
