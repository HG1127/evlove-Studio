import type {Candidate,EvolveProject,ExperimentRun} from "@evolution/contracts";
import {campaignRepairLimitStopReason} from "./campaign-control";
import {candidateWinnerDecision,experimentEvaluationScore} from "./experiment-winner";
import {finalHoldoutContractFingerprint, finalHoldoutPaperHash} from "./independent-final-holdout";

function relativeRegressions(project:EvolveProject,candidate:Candidate,result:ExperimentRun["candidateResults"][number]){
  const baseline=project.baselineRun.result,scores=result.evaluation.criterionScores??[],priorScores=baseline?.criterionScores??[];
  if(!baseline||baseline.demoJudged||result.evaluation.demoJudged||result.evaluation.safety!=="PASS"
    ||JSON.stringify(project.experimentRun.comparisonBaseline)!==JSON.stringify(project.baselineRun)
    ||JSON.stringify(project.experimentRun.comparisonSuite)!==JSON.stringify(project.evalSuite)
    ||new Set(priorScores.map(score=>score.criterionId)).size!==priorScores.length
    ||new Set(scores.map(score=>score.criterionId)).size!==scores.length
    ||!project.acceptanceRubric.every(criterion=>scores.some(score=>score.criterionId===criterion.id&&score.verificationStatus==="verified"&&score.pass&&score.score>=criterion.minScore)))return [];
  const decision=candidateWinnerDecision(project,result.evaluation,baseline,candidate);
  if(decision.eligible)return [];
  return project.acceptanceRubric.filter(criterion=>{
    if(criterion.protectedConstraint||!decision.targetCriterionIds.includes(criterion.id))return false;
    const score=scores.find(s=>s.criterionId===criterion.id),prior=priorScores.find(s=>s.criterionId===criterion.id);
    return score?.verificationStatus==="verified"&&prior?.verificationStatus==="verified"&&prior.pass&&prior.score>=criterion.minScore&&score.score<prior.score
      &&score.testCaseIds.some(id=>prior.testCaseIds.includes(id))
      &&[...score.testCaseIds,...prior.testCaseIds].every(id=>project.evalSuite.some(test=>test.id===id&&test.criterionIds.includes(criterion.id)));
  });
}

/** Preserve absolute PASS verdicts while explaining a separately proven target regression to mutation AI. */
export function visibleRepairFeedbackContext(project:EvolveProject,candidate:Candidate,criterionIds:string[],attempt:number){
  const records=project.visibleRepairAttempts?.filter(r=>r.parentCandidateId===candidate.id&&r.attempt===attempt&&r.status==="running")??[];
  if(records.length!==1&&records.some(r=>r.version==="experiment-visible-repair-v2"&&r.feedbackKind==="relative-target-regression"))throw Error("Ambiguous relative repair claim");
  const record=records.length===1?records[0]:undefined;
  if(record?.version!=="experiment-visible-repair-v2"||record.feedbackKind!=="relative-target-regression")return {kind:"absolute-criterion-failure" as const,comparisons:[]};
  const result=project.experimentRun.candidateResults.find(r=>r.candidateId===candidate.id);
  const qualified=result?relativeRegressions(project,candidate,result):[];
  if(project.experimentPolicy.visibleFailureRepair!=="experiment-visible-repair-v2"||!result||!qualified.length
    ||project.campaign.status!=="running"||record.round!==project.campaign.currentRound+1||project.artifactAcceptance.attempts!==attempt
    ||JSON.stringify(qualified.map(c=>c.id))!==JSON.stringify(criterionIds)
    ||JSON.stringify(record.failedCriterionIds)!==JSON.stringify(criterionIds))throw Error("Relative repair requires the unchanged verified paired target regression");
  return {kind:"relative-target-regression" as const,comparisons:qualified.map(criterion=>({criterionId:criterion.id,minScore:criterion.minScore,
    baselineScore:project.baselineRun.result!.criterionScores!.find(s=>s.criterionId===criterion.id)!.score,
    currentScore:result.evaluation.criterionScores!.find(s=>s.criterionId===criterion.id)!.score,absoluteMinimumPassed:true}))};
}

/** Only measured Visible product failures are mutation feedback; unknown capability is not one. */
export function visibleRepairTarget(project:EvolveProject){
  const run=project.experimentRun,round=project.campaign.currentRound+1,paper=project.finalHoldout;
  const policy=project.experimentPolicy.visibleFailureRepair;
  if((policy!=="experiment-visible-repair-v1"&&policy!=="experiment-visible-repair-v2")
    ||project.targetConnection.adapter!=="artifact"||project.campaign.status!=="running"
    ||project.campaign.checkpoint?.round!==round||project.campaign.checkpoint.completedPhase!=="experiment"
    ||run.status!=="completed"||run.winnerId||run.pendingEvidenceCandidateId
    ||campaignRepairLimitStopReason(project)||project.validationRun.independentFinal
    ||project.artifactAcceptance.status==="passed"
    ||project.artifactAcceptance.attempts>=project.artifactAcceptance.maxRepairAttempts
    ||!paper||paper.round!==round||paper.paperHash!==finalHoldoutPaperHash(paper.suite)
    ||paper.contractFingerprint!==finalHoldoutContractFingerprint(project)
    ||project.visibleRepairAttempts?.some(item=>item.status==="reserved"||item.status==="running")
    ||run.candidateResults.some(result=>result.evaluation.safety!=="PASS")
    ||project.baselineRun.status!=="completed"||!project.baselineRun.result||project.baselineRun.result.demoJudged
    ||JSON.stringify(run.comparisonSuite)!==JSON.stringify(project.evalSuite)
    ||JSON.stringify(run.comparisonBaseline)!==JSON.stringify(project.baselineRun))return undefined;
  const suite=project.evalSuite,ids=new Set(suite.map(test=>test.id));
  if(!suite.length||ids.size!==suite.length||suite.some(test=>test.hidden)
    ||new Set(run.candidateResults.map(result=>result.candidateId)).size!==run.candidateResults.length)return undefined;
  const results=[...run.candidateResults].sort((a,b)=>experimentEvaluationScore(project,b.evaluation)-experimentEvaluationScore(project,a.evaluation));
  for(const result of results){
    const matches=project.candidates.filter(candidate=>candidate.id===result.candidateId),candidate=matches[0];
    if(matches.length!==1||!candidate||candidate.finalHoldoutPaperHash!==paper.paperHash
      ||result.experimentStage!=="finalist"||result.winnerDecision?.eligible!==false
      ||result.runs.length!==suite.length||new Set(result.runs.map(r=>r.testCaseId)).size!==suite.length
      ||result.runs.some(r=>!ids.has(r.testCaseId)||r.verificationStatus!=="verified"||Boolean(r.error))
      ||result.evaluation.demoJudged||result.evaluation.unverifiedCriterionIds?.length)continue;
    const scores=result.evaluation.criterionScores??[];
    if(new Set(scores.map(score=>score.criterionId)).size!==scores.length)continue;
    const failedCriteria=project.acceptanceRubric.filter(criterion=>{
      const score=scores.find(item=>item.criterionId===criterion.id);
      return score?.verificationStatus==="verified"&&(!score.pass||score.score<criterion.minScore)&&score.testCaseIds.length>0
        &&score.testCaseIds.every(id=>suite.some(test=>test.id===id&&test.criterionIds.includes(criterion.id)));
    });
    if(failedCriteria.length)return {candidate,failedCriteria,result,feedbackKind:"absolute-criterion-failure" as const};
    if(policy!=="experiment-visible-repair-v2")continue;
    const regressed=relativeRegressions(project,candidate,result);
    if(regressed.length)return {candidate,failedCriteria:regressed,result,feedbackKind:"relative-target-regression" as const};
  }
  return undefined;
}
