import {AcceptanceCriterionSchema,EvolveProjectSchema,FailureObservationSourceSchema,TestCaseSchema,type EvolveProject} from "@evolution/contracts";
import {learningContextFixture,learningContextHash} from "./learning-context-fixture";

/** Synthetic rejected source; final/program sentinels must never reach a planner. */
export function failureObservationFixture(){
  const x=learningContextFixture(),source=x.p,candidate=x.current,at="2026-10-08T16:00:00.000Z";
  source.acceptanceRubric=[AcceptanceCriterionSchema.parse({id:"GOAL",title:"Readability",requirement:"improve readability",source:"user-command",weight:100,hardGate:true,minScore:85})];
  source.evalSuite=[TestCaseSchema.parse({id:"V1",title:"Visible",input:"check actual body",expected:["readable"],criterionIds:["GOAL"]})];
  source.hiddenEvalSuite=[TestCaseSchema.parse({id:"H1",title:"Ordinary Hidden",input:"PRIVATE_HIDDEN_SENTINEL",expected:["unseen"],criterionIds:["GOAL"],hidden:true})];
  source.experimentPolicy.winnerGoalScope="all-user-goals-v1";
  const score={criterionId:"GOAL",score:95,pass:true,verificationStatus:"verified" as const,testCaseIds:["V1"],evidence:[],gaps:[]};
  source.baselineRun={...source.baselineRun,runs:[{testCaseId:"V1",output:"Original synthetic body observed",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],result:{...source.validationRun.evaluation!,criterionScores:[score],demoJudged:false}};
  const runs=[{testCaseId:"V1",artifactHash:candidate.artifactSnapshots[0]!.frozenArtifact!.sha256,output:"Current synthetic body observed",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const}];
  const evaluation={...source.baselineRun.result!,criterionScores:[{...score,score:90}]};
  source.experimentRun={id:"visible-source",status:"completed",comparisonSuite:structuredClone(source.evalSuite),comparisonBaseline:structuredClone(source.baselineRun),
    candidateResults:[{candidateId:candidate.id,evaluation,runs,artifactSnapshots:candidate.artifactSnapshots,experimentStage:"finalist",winnerDecision:{eligible:false,summary:"Synthetic paired regression",comparedCriterionIds:["GOAL"],targetCriterionIds:["GOAL"],blockers:[],signals:[]}}]};
  source.campaign.checkpoint={round:1,completedPhase:"experiment",at};source.artifactAcceptance.status="failed";
  x.blobs.set(source.sourceArtifacts[0]!.id,new Blob([source.sourceArtifacts[0]!.textContent!],{type:"text/html"}));
  const current:EvolveProject={...structuredClone(source),id:"mission-next",candidates:[],selectedCandidateIds:[],experimentRun:{id:"next-experiment",status:"idle",candidateResults:[]},
    validationRun:{id:"next-validation",status:"idle",checks:[],runs:[],baselineRuns:[]},lessons:[],finalHoldout:undefined,
    artifactAcceptance:{...source.artifactAcceptance,status:"idle",attempts:0},campaign:{...source.campaign,status:"idle",checkpoint:undefined,startedAt:undefined}};
  const sourceRef=()=>FailureObservationSourceSchema.parse({schemaVersion:"visible-failure-source-v1",missionId:source.id,missionSha256:learningContextHash(JSON.stringify(EvolveProjectSchema.parse(source))),experimentRunId:source.experimentRun.id,candidateId:candidate.id,round:1});
  return {source,candidate,current,blobs:x.blobs,at,sourceRef};
}
