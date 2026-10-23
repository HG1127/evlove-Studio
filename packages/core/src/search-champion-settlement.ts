import type {ArtifactAcceptance,Candidate,EvolveProject,EvaluationResult,SearchChampion,TestCase,ValidationRun} from "@evolution/contracts";
import {reusableHoldoutBaseline} from "./baseline-readiness";
import {hasAuthoritativeHiddenRelease,hasFullHiddenMeasurement} from "./hidden-validation-evidence";
import {hasExactFrozenArtifactSet} from "./artifact-identity";
import {evidenceFingerprint} from "./evidence-binding";
import {independentFinalReadiness} from "./independent-final-holdout";

function clamp(value:number,min=0,max=100){return Math.max(min,Math.min(max,value));}

export function computeSearchFitness(evaluation:EvaluationResult,baseline?:EvaluationResult,acceptance?:ArtifactAcceptance){
  const generic=evaluation.accuracy*0.28+evaluation.evidence*0.22+evaluation.riskCoverage*0.15+evaluation.completeness*0.20+(evaluation.safety==="PASS"?15:evaluation.safety==="REVIEW"?4:-50);
  const rubric=evaluation.rubricScore??generic;
  const acceptanceScore=acceptance?.status==="passed"?acceptance.overallScore:undefined;
  const quality=acceptanceScore===undefined?rubric*0.84+generic*0.16:rubric*0.65+acceptanceScore*0.25+generic*0.10;
  const costRatio=baseline?.averageCost&&baseline.averageCost>0?evaluation.averageCost/baseline.averageCost:1;
  const latencyRatio=baseline?.averageLatencyMs&&baseline.averageLatencyMs>0?evaluation.averageLatencyMs/baseline.averageLatencyMs:1;
  const costPenalty=Math.max(0,costRatio-1)*9;
  const latencyPenalty=Math.max(0,latencyRatio-1)*6;
  const artifactPenalty=acceptance&&(!acceptance.hardGatePass||acceptance.status==="failed")?100:0;
  const safetyPenalty=evaluation.safety==="FAIL"?100:evaluation.safety==="REVIEW"?8:0;
  return {score:clamp(quality-costPenalty-latencyPenalty-safetyPenalty-artifactPenalty),quality,costPenalty,latencyPenalty,safetyPenalty:safetyPenalty+artifactPenalty};
}

function dominates(a:EvaluationResult,b:EvaluationResult){
  const safetyA=a.safety==="PASS"?2:a.safety==="REVIEW"?1:0;
  const safetyB=b.safety==="PASS"?2:b.safety==="REVIEW"?1:0;
  const noWorse=a.accuracy>=b.accuracy&&a.evidence>=b.evidence&&a.riskCoverage>=b.riskCoverage&&a.completeness>=b.completeness&&a.averageCost<=b.averageCost&&a.averageLatencyMs<=b.averageLatencyMs&&safetyA>=safetyB;
  const better=a.accuracy>b.accuracy||a.evidence>b.evidence||a.riskCoverage>b.riskCoverage||a.completeness>b.completeness||a.averageCost<b.averageCost||a.averageLatencyMs<b.averageLatencyMs||safetyA>safetyB;
  return noWorse&&better;
}

export function updateSearchChampion(args:{
  project:EvolveProject;
  current?:SearchChampion;
  round:number;
  winner?:Candidate;
  validation:ValidationRun;
  artifactAcceptance?:ArtifactAcceptance;
  baseline?:EvaluationResult;
  parentVersionId:string;
  minImprovement:number;
  liveTarget?:boolean;
  hiddenSuite?:TestCase[];
  selectedAt?:string;
}){
  if(!args.winner||args.artifactAcceptance?.status!=="passed")return {champion:args.current,changed:false,improvement:0};
  if(!independentFinalReadiness(args.project,args.winner,args.validation).ready)return {champion:args.current,changed:false,improvement:0};
  if(!args.artifactAcceptance.hardGatePass||args.artifactAcceptance.candidateId!==args.winner.id)return {champion:args.current,changed:false,improvement:0};
  const binding=evidenceFingerprint(args.project,args.winner);
  if(args.validation.evidenceFingerprint!==binding
    ||args.artifactAcceptance.evidenceFingerprint!==binding
    ||!hasExactFrozenArtifactSet(args.project,args.winner,args.artifactAcceptance)){
    return {champion:args.current,changed:false,improvement:0};
  }
  if(!hasAuthoritativeHiddenRelease(args.validation,args.winner.id,args.project.hiddenEvalSuite,args.project.acceptanceRubric)){
    const candidateMeasured=hasFullHiddenMeasurement(args.validation,args.winner.id,args.project.hiddenEvalSuite)
      &&args.validation.runs.every((run)=>run.verificationStatus==="verified")
      &&args.validation.recommendation==="release"
      &&args.validation.evaluation?.safety!=="FAIL"
      &&!args.validation.evaluation?.unverifiedCriterionIds?.length;
    return {
      champion:args.current,changed:false,improvement:0,
      ...(args.liveTarget&&args.current&&candidateMeasured?{comparisonPending:true}:{}),
    };
  }
  const evaluation=args.validation.evaluation!;
  const paired=args.liveTarget&&args.current?args.validation.baselineEvaluation:undefined;
  if(args.liveTarget&&args.current){
    const ids=args.hiddenSuite?.map((item)=>item.id)??[];
    const validation=args.validation;
    if(validation.validationMode!=="full"||!ids.length||new Set(ids).size!==ids.length
      ||!validation.baselineContextFingerprint||!validation.baselineObservedAt
      ||validation.baselineSuiteIds?.length!==ids.length
      ||ids.some((id,index)=>validation.baselineSuiteIds?.[index]!==id||validation.runs[index]?.testCaseId!==id||validation.baselineRuns[index]?.testCaseId!==id)
      ||!reusableHoldoutBaseline(args.hiddenSuite!,validation.baselineRuns,paired)){
      return {champion:args.current,changed:false,improvement:0,comparisonPending:true};
    }
  }
  const scoringBaseline=paired??args.baseline;
  const score=computeSearchFitness(evaluation,scoringBaseline,args.artifactAcceptance).score;
  const previous=paired?computeSearchFitness(paired,scoringBaseline,args.current?.artifactAcceptance).score:args.current?.score;
  const improvement=previous===undefined?score:score-previous;
  if(previous!==undefined&&improvement<args.minImprovement){
    const currentEval=paired??args.current?.evaluation;
    if(!(currentEval&&dominates(evaluation,currentEval)))return {champion:args.current,changed:false,improvement};
  }
  const patches=[...(args.current?.patches??[]),...args.winner.patches].filter((patch,index,all)=>all.findIndex((item)=>item.id===patch.id)===index);
  return {
    champion:{
      id:`champion-r${args.round}-${args.winner.id}`,
      versionLabel:`S${args.round}`,
      round:args.round,
      score:Number(score.toFixed(2)),
      candidate:args.winner,
      evaluation,
      validation:args.validation,
      artifactAcceptance:args.artifactAcceptance,
      patches,
      parentVersionId:args.parentVersionId,
      reason:previous===undefined?"首个通过 Hidden Validation 的 Search Champion":`基于 ${args.current?.versionLabel??args.parentVersionId} 累积进化，较上一 Search Champion 提升 ${improvement.toFixed(2)} 分`,
      selectedAt:args.selectedAt??new Date().toISOString(),
    } satisfies SearchChampion,
    changed:true,
    improvement,
  };
}

/**
 * An interrupted or older Gate F policy may leave a passed offline round with
 * no Champion. Repair only the existing verified projection, never the Artifact.
 * Composition MUST read back the exact frozen Blob before persisting this result.
 */
export function reconcileAcceptedOfflineChampion(
  project:EvolveProject,
  at:string=new Date().toISOString(),
):EvolveProject|undefined {
  const campaign=project.campaign,acceptance=project.artifactAcceptance,validation=project.validationRun;
  if(project.targetConnection.adapter!=="artifact"||project.searchChampion
    ||project.release.status!=="idle"||project.outputArtifacts.length>0
    ||project.stage!=="validation"||campaign.currentRound<1||campaign.checkpoint
    ||acceptance.status!=="passed"||!acceptance.hardGatePass||!acceptance.acceptedAt
    ||validation.status!=="completed"||validation.validationMode!=="full"
    ||validation.recommendation!=="release"
    ||(campaign.status!=="paused"&&campaign.status!=="idle"))return undefined;
  // A safety, capability or authorization pause must NOT be silently resumed.
  if(campaign.status==="paused"
    &&!/^已达到设定的最大进化轮数 \d+$/.test(campaign.stopReason??"")
    &&!/^连续 \d+ 轮没有达到最小提升/.test(campaign.stopReason??""))return undefined;
  const candidateId=acceptance.candidateId;
  const winner=project.candidates.filter(c=>c.id===candidateId);
  if(!candidateId||winner.length!==1
    ||validation.candidateId!==candidateId
    ||project.experimentRun.status!=="completed"
    ||project.experimentRun.winnerId!==candidateId
    ||project.roundHistory.filter(record=>record.round===campaign.currentRound&&record.winnerCandidateId===candidateId).length!==1
    ||project.sourceArtifacts.filter(s=>s.role==="target").length!==winner[0]!.artifactSnapshots.length)return undefined;
  const candidate=winner[0]!;
  if(candidate.artifactBuildStatus!=="ready"
    ||validation.evidenceFingerprint!==evidenceFingerprint(project,candidate)
    ||acceptance.evidenceFingerprint!==evidenceFingerprint(project,candidate)
    ||!hasExactFrozenArtifactSet(project,candidate,acceptance)
    ||!hasAuthoritativeHiddenRelease(validation,candidate.id,project.hiddenEvalSuite,project.acceptanceRubric))return undefined;
  const changed=updateSearchChampion({
    project,winner:candidate,round:campaign.currentRound,
    validation,artifactAcceptance:acceptance,
    baseline:campaign.rootBaseline??project.baselineRun.result,
    parentVersionId:project.version,minImprovement:campaign.stopCriteria.minImprovement,
    liveTarget:false,hiddenSuite:project.hiddenEvalSuite,selectedAt:acceptance.acceptedAt,
  });
  if(!changed.changed||!changed.champion?.candidate||changed.champion.candidate.id!==candidate.id)return undefined;
  const champion=changed.champion;
  return {
    ...project,
    searchChampion:champion,
    searchAppliedPatches:champion.patches,
    evolutionArchive:project.evolutionArchive.map(record=>
      record.id==="archive-r"+campaign.currentRound+"-"+candidate.id+"-gate-f"
        ?{...record,kind:"champion" as const,score:champion.score,
          reason:"同一轮 Gate F 已通过，复核冻结文件后恢复遗漏的 Search Champion 投影"}
        :record),
    roundHistory:project.roundHistory.map(record=>
      record.round===campaign.currentRound&&record.winnerCandidateId===candidate.id
        ?{...record,championChanged:true,globalChampionId:champion.id,
          winnerScore:champion.score,improvement:Number(changed.improvement.toFixed(2)),
          summary:"基于原 Hidden Holdout / Gate F 证据恢复 Search Champion；未生成或发布文件"}
        :record),
    campaign:{...campaign,status:"running",stopReason:undefined,noImprovementRounds:0},
    updatedAt:at,
  };
}
