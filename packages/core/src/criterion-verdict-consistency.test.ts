import {describe,expect,it} from "vitest";
import type {EvaluateAiResult} from "@evolution/contracts";
import {unexplainedCriterionRejections,criterionRejectionsRequiringReview} from "./criterion-verdict-consistency";

const criteria=[{id:"GOAL",minScore:85}];
function judgment():Pick<EvaluateAiResult,"safety"|"criteria">{
  return {safety:"PASS",criteria:[{criterionId:"GOAL",score:96,pass:false,evidenceStatus:"sufficient",
    evidence:["Observed positive change"],gaps:[],testCaseIds:["V1"]}]};
}
describe("criterion rejection rationale",()=>{
  it("reports the high-score/false contradiction without rewriting any observed fields",()=>{
    const value=judgment(),before=structuredClone(value);
    expect(unexplainedCriterionRejections(criteria,value)).toEqual([{criterionId:"GOAL",score:96,minScore:85}]);
    expect(value).toEqual(before);
  });
  it("preserves a high-score rejection with a specific unmet requirement",()=>{
    const value=judgment();value.criteria[0]!.gaps=["Required recovery action was not observed in V1"];
    expect(unexplainedCriterionRejections(criteria,value)).toEqual([]);
    expect(value.criteria[0]!.pass).toBe(false);
  });
  it("treats whitespace-only gaps as missing explanation",()=>{
    const value=judgment();value.criteria[0]!.gaps=[" \t"];
    expect(unexplainedCriterionRejections(criteria,value)).toHaveLength(1);
  });
  it("does not turn low scores or zero-change references into a pass",()=>{
    for(const score of [0,84]){const value=judgment();value.criteria[0]!.score=score;
      expect(unexplainedCriterionRejections(criteria,value)).toEqual([]);expect(value.criteria[0]!.pass).toBe(false);}
  });
  it("keeps missing evidence and known Safety failures on their existing paths",()=>{
    for(const safety of ["FAIL","REVIEW"] as const){const value=judgment();value.safety=safety;
      expect(unexplainedCriterionRejections(criteria,value)).toEqual([]);expect(value.safety).toBe(safety);}
    for(const evidenceStatus of [undefined,"unknown"] as const){const value=judgment();value.criteria[0]!.evidenceStatus=evidenceStatus;
      expect(unexplainedCriterionRejections(criteria,value)).toEqual([]);expect(value.criteria[0]!.pass).toBe(false);}
  });
  it("uses the issued minimum and leaves positive verdicts unchanged",()=>{
    const value=judgment();expect(unexplainedCriterionRejections([{id:"GOAL",minScore:97}],value)).toEqual([]);
    value.criteria[0]!.pass=true;expect(unexplainedCriterionRejections(criteria,value)).toEqual([]);
  });
});

describe("high-score veto qualification",()=>{
  it.each([[],[" \t"],["The issued requirement is met; the caveat is nonblocking"],["Required recovery action was not observed in V1"]].map(gaps=>({gaps})))("requires review without interpreting gap syntax: %j",({gaps})=>{
    const value=judgment();value.criteria[0]!.gaps=gaps;const before=structuredClone(value);
    expect(criterionRejectionsRequiringReview(criteria,value)).toEqual([{criterionId:"GOAL",score:96,minScore:85}]);
    expect(value).toEqual(before);
  });
  it("uses the issued minimum including equality without inventing requirements",()=>{
    const value=judgment();value.criteria[0]!.score=85;
    expect(criterionRejectionsRequiringReview(criteria,value)).toEqual([{criterionId:"GOAL",score:85,minScore:85}]);
    expect(criterionRejectionsRequiringReview([{id:"GOAL",minScore:86}],value)).toEqual([]);
    expect(criterionRejectionsRequiringReview([{id:"OTHER",minScore:85}],value)).toEqual([]);
  });
  it("preserves other known negatives and leaves positive verdicts unchanged",()=>{
    const value=judgment();value.criteria.push({...structuredClone(value.criteria[0]!),criterionId:"OTHER",score:0,gaps:["Observed required output absent"]});
    const before=structuredClone(value);
    expect(criterionRejectionsRequiringReview([...criteria,{id:"OTHER",minScore:85}],value)).toEqual([{criterionId:"GOAL",score:96,minScore:85}]);
    expect(value).toEqual(before);
    value.criteria[0]!.pass=true;expect(criterionRejectionsRequiringReview(criteria,value)).toEqual([]);
  });
  it("does not reclassify unknown evidence or known Safety failures",()=>{
    for(const safety of ["FAIL","REVIEW"] as const){const value=judgment();value.safety=safety;const before=structuredClone(value);
      expect(criterionRejectionsRequiringReview(criteria,value)).toEqual([]);expect(value).toEqual(before);}
    for(const evidenceStatus of [undefined,"unknown"] as const){const value=judgment();value.criteria[0]!.evidenceStatus=evidenceStatus;const before=structuredClone(value);
      expect(criterionRejectionsRequiringReview(criteria,value)).toEqual([]);expect(value).toEqual(before);}
  });
});
