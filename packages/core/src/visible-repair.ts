import type {EvolveProject} from "@evolution/contracts";
import {campaignRepairLimitStopReason} from "./campaign-control";
import {experimentEvaluationScore} from "./experiment-winner";
import {finalHoldoutContractFingerprint, finalHoldoutPaperHash} from "./independent-final-holdout";

/** Only measured Visible product failures are mutation feedback; unknown capability is not one. */
export function visibleRepairTarget(project:EvolveProject){
  const run=project.experimentRun,round=project.campaign.currentRound+1,paper=project.finalHoldout;
  if(project.experimentPolicy.visibleFailureRepair!=="experiment-visible-repair-v1"
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
    if(failedCriteria.length)return {candidate,failedCriteria,result};
  }
  return undefined;
}
