import type {EvolveProject} from "@evolution/contracts";
import {indexScopedAcceptanceResults} from "./acceptance-result-identity";
import {originalUserGoalCriteria,USER_GOAL_SCOPE_POLICY,userGoalProgress} from "./user-goal-scope";
import {pairedComparisonBaseline} from "./paired-judge";

/** Retrospective source facts only; never reads final/Hidden results, raw runs or provider configuration. */
export function visibleFailureObservationFacts(source:EvolveProject,candidateId:string){
  const candidates=source.candidates.filter(c=>c.id===candidateId),results=source.experimentRun.candidateResults.filter(r=>r.candidateId===candidateId);
  const baseline=source.experimentRun.comparisonBaseline,suite=source.experimentRun.comparisonSuite;
  if(source.experimentRun.status!=="completed"||candidates.length!==1||results.length!==1||baseline?.status!=="completed"||!baseline.result||!suite?.length
    ||new Set(suite.map(t=>t.id)).size!==suite.length||results[0]!.winnerDecision?.eligible!==false||results[0]!.experimentStage!=="finalist")throw Error("Failure source needs a unique completed Visible rejection and its stored comparison");
  const candidate=candidates[0]!,result=results[0]!,evaluation=result.evaluation;
  if(evaluation.demoJudged||baseline.result.demoJudged||JSON.stringify(result.artifactSnapshots)!==JSON.stringify(candidate.artifactSnapshots))throw Error("Failure source has demo or mismatched Candidate snapshots");
  const ids=source.acceptanceRubric.map(c=>c.id);
  if(!ids.length||new Set(ids).size!==ids.length)throw Error("Failure source criterion contract is ambiguous");
  const comparison=pairedComparisonBaseline(source,evaluation,baseline.result,suite,candidate);
  if(comparison.blocker)throw Error("Failure source paired measurement is not qualified");
  const measuredBaseline={...baseline,result:comparison.baseline};
  const current=indexScopedAcceptanceResults([{requestedCriterionIds:ids,results:evaluation.criterionScores??[]}]),prior=indexScopedAcceptanceResults([{requestedCriterionIds:ids,results:comparison.baseline.criterionScores??[]}]);
  const exact=(a:string[],b:string[])=>a.length>0&&new Set(a).size===a.length&&a.length===b.length&&a.every(id=>b.includes(id));
  const comparisons=source.acceptanceRubric.flatMap(c=>{
    const now=current.byId.get(c.id),before=prior.byId.get(c.id),expected=suite.filter(t=>t.criterionIds.includes(c.id)).map(t=>t.id);
    if(now?.verificationStatus!=="verified"||before?.verificationStatus!=="verified"||!exact(now.testCaseIds,expected)||!exact(before.testCaseIds,expected))return [];
    return [{criterionId:c.id,title:c.title,minScore:c.minScore,weight:c.weight,caseIds:expected,baselineScore:before.score,candidateScore:now.score,delta:now.score-before.score,baselineMinimumPassed:before.pass,candidateMinimumPassed:now.pass}];
  });
  const failures=comparisons.filter(c=>c.delta<0||!c.candidateMinimumPassed).map(c=>c.criterionId);
  const progress=userGoalProgress({...source,evalSuite:suite},evaluation,baseline.result);
  const completeUserGoalDelta=source.experimentPolicy.winnerGoalScope===USER_GOAL_SCOPE_POLICY&&progress.ready?progress.weightedDelta:undefined;
  if(!failures.length&&!(completeUserGoalDelta!==undefined&&completeUserGoalDelta<1))throw Error("Failure source has no complete measured negative comparison");
  return {candidate,result,baseline:measuredBaseline,suite,comparisons,failureCriterionIds:failures,completeUserGoalDelta,
    unpairedCriterionIds:ids.filter(id=>!comparisons.some(c=>c.criterionId===id)),
    userGoalCriterionIds:originalUserGoalCriteria(source).map(c=>c.id)};
}
