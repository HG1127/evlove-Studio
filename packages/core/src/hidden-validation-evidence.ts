import type { AcceptanceCriterion, TestCase, ValidationRun } from "@evolution/contracts";
import {indexUniqueById} from "./identity-index";

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

/**
 * An original version can prove its protected/hard requirements even when it
 * cannot prove a new SOFT objective that the Candidate adds.
 *
 * Only waive UNKNOWN original evidence for soft-only cases when the exact
 * Candidate case/criterion is VERIFIED, and a distinct hard SYS-PAIRWISE
 * comparison is independently VERIFIED. Never relabel the original run as
 * VERIFIED or claim that the soft dimension's improvement was measured.
 * Missing/mixed/hard, FAILED or PARTIAL original observations still block.
 */
export function hasVerifiedHiddenBaseline(
  validation: ValidationRun,hiddenSuite: TestCase[],rubric?: AcceptanceCriterion[],
): boolean {
  const suiteIds=hiddenSuite.map(test=>test.id);
  const baselineIds=(validation.baselineRuns??[]).map(run=>run.testCaseId);
  const criterionIndex=new Map((rubric??[]).map(criterion=>[criterion.id,criterion]));
  const scoreIndex=indexUniqueById(validation.evaluation?.criterionScores??[],score=>score.criterionId);
  const pairCriterion=criterionIndex.get("SYS-PAIRWISE");
  const pairScore=scoreIndex.byId.get("SYS-PAIRWISE");
  const comparisonOnly=new Set(hiddenSuite.filter(test=>test.criterionIds?.length>0
    &&test.criterionIds.every(id=>id==="SYS-PAIRWISE")).map(test=>test.id));
  const verifiedPairwise=Boolean(pairCriterion?.hardGate
    &&pairScore?.verificationStatus==="verified"&&pairScore.pass
    &&pairScore.score>=pairCriterion.minScore
    &&hiddenSuite.some(test=>comparisonOnly.has(test.id)
      &&pairScore.testCaseIds.includes(test.id)));
  const softOnly=new Set(verifiedPairwise?hiddenSuite.filter(test=>
    test.criterionIds?.length>0
    &&test.criterionIds.every(id=>{
      const criterion=criterionIndex.get(id),score=scoreIndex.byId.get(id);
      return criterion?.hardGate===false && score?.verificationStatus==="verified"
        &&score.pass&&score.score>=criterion.minScore
        &&score.testCaseIds.includes(test.id);
    })
    &&validation.runs.some(run=>run.testCaseId===test.id&&run.verificationStatus==="verified")
  ).map(test=>test.id):[]);
  const required=hiddenSuite.filter(test=>!comparisonOnly.has(test.id)&&!softOnly.has(test.id));
  return Boolean(validation.baselineEvaluation&&!validation.baselineEvaluation.demoJudged)
    &&suiteIds.length>0&&required.length>0
    &&validation.baselineSuiteIds?.length===suiteIds.length
    &&suiteIds.every((id,i)=>validation.baselineSuiteIds?.[i]===id)
    &&baselineIds.length===suiteIds.length
    &&new Set(baselineIds).size===baselineIds.length
    &&baselineIds.every(id=>suiteIds.includes(id))
    &&validation.baselineRuns.every(run=>comparisonOnly.has(run.testCaseId)
      ?run.verificationStatus==="unverified"||run.verificationStatus==="verified"
      :softOnly.has(run.testCaseId)
        ?run.verificationStatus==="unverified"||run.verificationStatus==="verified"
        :run.verificationStatus==="verified")
    &&Boolean(validation.baselineContextFingerprint)
    &&Number.isFinite(validation.baselineObservedAt)
    &&(validation.baselineObservedAt??0)>0;
}

/** A release needs a full, non-demo same-paper Candidate and hard original evidence. */
export function hasAuthoritativeHiddenRelease(
  validation:ValidationRun,candidateId:string,hiddenSuite:TestCase[],rubric?:AcceptanceCriterion[],
):boolean{
  return hasFullHiddenMeasurement(validation,candidateId,hiddenSuite)
    &&validation.recommendation==="release"
    &&validation.runs.every(run=>run.verificationStatus==="verified")
    &&hasVerifiedHiddenBaseline(validation,hiddenSuite,rubric)
    &&validation.evaluation?.safety!=="FAIL"
    &&!(validation.evaluation?.unverifiedCriterionIds?.length);
}