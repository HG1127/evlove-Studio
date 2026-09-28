import type {ArtifactAcceptance,Candidate,EvaluationResult,SearchChampion,TestCase,ValidationRun} from "@evolution/contracts";
import {reusableHoldoutBaseline} from "./baseline-readiness";
import {hasAuthoritativeHiddenRelease} from "./hidden-validation-evidence";

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
  if(!hasAuthoritativeHiddenRelease(args.validation,args.winner.id)
    ||!args.artifactAcceptance.hardGatePass||args.artifactAcceptance.candidateId!==args.winner.id)return {champion:args.current,changed:false,improvement:0};
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
