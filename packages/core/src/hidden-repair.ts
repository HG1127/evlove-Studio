import type {Candidate,EvolveProject,ValidationRun} from "@evolution/contracts";
import {campaignRepairLimitStopReason} from "./campaign-control";
import {evidenceFingerprint} from "./evidence-binding";
import {hasFullHiddenMeasurement} from "./hidden-validation-evidence";
import {finalHoldoutContractFingerprint,finalHoldoutPaperHash} from "./independent-final-holdout";
import {USER_GOAL_SCOPE_POLICY,userGoalProgress} from "./user-goal-scope";
import {verifiedValidationFailures} from "./validation-failure-selection";

export const HIDDEN_REPAIR_V2="artifact-targeted-repair-v2" as const;
const unique=(ids:string[])=>ids.length>0&&new Set(ids).size===ids.length;
const same=(a:string[],b:string[])=>unique(a)&&unique(b)&&a.length===b.length&&a.every(id=>b.includes(id));
const measured=(runs:ValidationRun["runs"],ids:string[])=>ids.every(id=>{
  const rows=runs.filter(r=>r.testCaseId===id),run=rows[0];return rows.length===1&&run?.verificationStatus==="verified"&&!run.error&&Boolean(run.output.trim());
});

/** Ordinary Hidden only. A final paper is never a source of mutation feedback. */
export function ordinaryHiddenGoalProgress(project:EvolveProject,candidate:Candidate,validation=project.validationRun){
  if(project.experimentPolicy?.hiddenFailureRepair!==HIDDEN_REPAIR_V2||project.experimentPolicy.winnerGoalScope!==USER_GOAL_SCOPE_POLICY)return undefined;
  const progress=validation.evaluation&&validation.baselineEvaluation?userGoalProgress(project,validation.evaluation,validation.baselineEvaluation,project.hiddenEvalSuite):undefined;
  const suiteIds=project.hiddenEvalSuite.map(t=>t.id),goalCaseIds=project.hiddenEvalSuite.filter(t=>t.criterionIds.some(id=>progress?.requiredCriterionIds.includes(id))).map(t=>t.id);
  const ready=Boolean(progress?.ready&&validation.evaluation?.safety==="PASS"
    &&hasFullHiddenMeasurement(validation,candidate.id,project.hiddenEvalSuite)&&validation.evidenceFingerprint===evidenceFingerprint(project,candidate)
    &&validation.baselineSuiteIds?.length===suiteIds.length&&validation.baselineSuiteIds.every((id,i)=>id===suiteIds[i])
    &&same(validation.baselineRuns.map(r=>r.testCaseId),suiteIds)&&validation.baselineContextFingerprint
    &&Number.isFinite(validation.baselineObservedAt)&&(validation.baselineObservedAt??0)>0
    &&measured(validation.runs,goalCaseIds)&&measured(validation.baselineRuns,goalCaseIds)
    &&!progress.requiredCriterionIds.some(id=>validation.evaluation?.unverifiedCriterionIds?.includes(id)||validation.baselineEvaluation?.unverifiedCriterionIds?.includes(id)));
  return {ready,progress,regressedCriterionIds:ready?progress!.regressedCriterionIds:[]};
}

/** A v2 scope is the rubric-ordered union; the legacy selector is kept verbatim. */
export function hiddenRepairTarget(project:EvolveProject,candidate:Candidate,validation=project.validationRun){
  if(project.experimentPolicy?.hiddenFailureRepair!==HIDDEN_REPAIR_V2)return {version:"artifact-targeted-repair-v1" as const,
    failedCriteria:verifiedValidationFailures(project,validation),feedbackKind:"absolute-criterion-failure" as const,comparisons:[]};
  const scores=validation.evaluation?.criterionScores??[],suite=project.hiddenEvalSuite;
  const complete=hasFullHiddenMeasurement(validation,candidate.id,suite)&&validation.evidenceFingerprint===evidenceFingerprint(project,candidate)
    &&validation.evaluation?.safety==="PASS"&&new Set(scores.map(s=>s.criterionId)).size===scores.length;
  const absolute=complete?project.acceptanceRubric.filter(c=>{
    const score=scores.find(s=>s.criterionId===c.id),expected=suite.filter(t=>t.criterionIds.includes(c.id)).map(t=>t.id);
    return project.acceptanceRubric.filter(r=>r.id===c.id).length===1&&score?.verificationStatus==="verified"
      &&!validation.evaluation?.unverifiedCriterionIds?.includes(c.id)&&(!score.pass||score.score<c.minScore)
      &&same(score.testCaseIds,expected)&&measured(validation.runs,expected);
  }):[];
  const goals=ordinaryHiddenGoalProgress(project,candidate,validation),regressed=complete&&goals?.ready?goals.regressedCriterionIds:[];
  const additional=regressed.filter(id=>!absolute.some(c=>c.id===id));
  const comparisons=additional.map(id=>{const pair=goals!.progress!.criteria.find(c=>c.criterionId===id)!;
    return {criterionId:id,minScore:pair.minScore,baselineScore:pair.baselineScore!,currentScore:pair.candidateScore!,absoluteMinimumPassed:true};});
  return {version:HIDDEN_REPAIR_V2,failedCriteria:project.acceptanceRubric.filter(c=>absolute.some(a=>a.id===c.id)||additional.includes(c.id)),
    feedbackKind:absolute.length&&additional.length?"combined-criterion-failure" as const:additional.length?"relative-target-regression" as const:"absolute-criterion-failure" as const,comparisons};
}

/** Recheck the persisted, already debited scope before a v2 model call. */
export function hiddenRepairFeedbackContext(project:EvolveProject,candidate:Candidate,criterionIds:string[],attempt:number){
  const claims=project.artifactRepairAttempts?.filter(r=>r.parentCandidateId===candidate.id&&r.attempt===attempt&&r.status==="running")??[];
  if(project.experimentPolicy?.hiddenFailureRepair!==HIDDEN_REPAIR_V2){
    if(claims.some(r=>r.version===HIDDEN_REPAIR_V2))throw Error("Hidden repair policy differs from the persisted v2 claim");
    return undefined;
  }
  const record=claims[0];if(claims.length!==1||record?.version!==HIDDEN_REPAIR_V2)throw Error("Hidden v2 repair requires one persisted running claim");
  if(record.estimatedCost>project.campaign.estimatedCost)throw Error("Hidden repair claim cost exceeds the recorded campaign cost");
  const before={...project,artifactRepairAttempts:project.artifactRepairAttempts?.filter(r=>r.id!==record.id),
    artifactAcceptance:{...project.artifactAcceptance,attempts:record.attempt-1},campaign:{...project.campaign,estimatedCost:project.campaign.estimatedCost-record.estimatedCost}};
  const target=hiddenRepairTarget(before,candidate),paper=project.finalHoldout,round=project.campaign.currentRound+1;
  if(!["idle","running"].includes(project.campaign.status)||campaignRepairLimitStopReason(before)||project.validationRun.independentFinal
    ||project.campaign.checkpoint?.round!==round||project.campaign.checkpoint.completedPhase!=="validation"
    ||record.round!==round||project.artifactAcceptance.attempts!==attempt||attempt>project.artifactAcceptance.maxRepairAttempts
    ||project.candidates.filter(c=>c.id===candidate.id).length!==1||!paper||paper.round!==round
    ||paper.contractFingerprint!==finalHoldoutContractFingerprint(project)||paper.paperHash!==finalHoldoutPaperHash(paper.suite)
    ||candidate.finalHoldoutPaperHash!==paper.paperHash||record.finalPaperHash!==paper.paperHash
    ||record.feedbackKind!==target.feedbackKind||!target.failedCriteria.length
    ||JSON.stringify(target.failedCriteria.map(c=>c.id))!==JSON.stringify(criterionIds)||JSON.stringify(record.failedCriterionIds)!==JSON.stringify(criterionIds))throw Error("Hidden v2 repair requires the unchanged complete verified ordinary Hidden scope and original final paper");
  return {kind:target.feedbackKind,comparisons:target.comparisons};
}
