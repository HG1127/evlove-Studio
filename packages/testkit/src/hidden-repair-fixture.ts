import {TestCaseSchema,type EvolveProject,type Candidate} from "@evolution/contracts";
import {evidenceFingerprint,finalHoldoutContractFingerprint,finalHoldoutPaperHash} from "@evolution/core";
import {acceptedPackageFixture} from "./accepted-package-fixture";

/** Synthetic paired ordinary Hidden feedback; never production or human-task evidence. */
export function hiddenRepairFixture(mode:"relative"|"mixed"|"absolute"="relative"){
  const x=acceptedPackageFixture(false),p=x.project,at=new Date().toISOString();
  p.candidates=[x.current];p.selectedCandidateIds=[x.current.id];
  p.acceptanceRubric=["CONTENT","READABILITY"].map(id=>({id,title:id,requirement:id,source:"user-command" as const,weight:50,hardGate:false,
    judgeType:"llm" as const,validationMethod:"semantic-judge" as const,minScore:80,evidenceExpected:["synthetic observation"],protectedConstraint:false,artifactIds:["source"],category:"outcome" as const}));
  p.evalSuite=[TestCaseSchema.parse({id:"V1",title:"visible",input:"visible task",expected:["clear and complete"],criterionIds:["CONTENT","READABILITY"]})];
  p.hiddenEvalSuite=[TestCaseSchema.parse({...p.evalSuite[0]!,id:"H1",hidden:true,input:"ordinary hidden task"})];
  p.experimentPolicy={...p.experimentPolicy,winnerGoalScope:"all-user-goals-v1",hiddenFailureRepair:"artifact-targeted-repair-v2"};
  const score=(id:string,value:number)=>({criterionId:id,score:value,pass:value>=80,verificationStatus:"verified" as const,evidence:["synthetic observation"],gaps:[],testCaseIds:["H1"]});
  p.validationRun={...p.validationRun,independentFinal:undefined,recommendation:"release",baselineObservedAt:Date.now(),
    runs:structuredClone(p.validationRun.runs),baselineRuns:structuredClone(p.validationRun.baselineRuns),
    evaluation:{...p.validationRun.evaluation!,safety:"PASS",averageCost:.01,criterionScores:[score("CONTENT",mode==="mixed"?70:95),score("READABILITY",mode==="absolute"?92:89)]},
    baselineEvaluation:{...p.validationRun.baselineEvaluation!,safety:"PASS",averageCost:.01,criterionScores:[score("CONTENT",90),score("READABILITY",90)]}};
  p.baselineRun.result={...p.validationRun.baselineEvaluation!,criterionScores:p.validationRun.baselineEvaluation!.criterionScores!.map(s=>({...s,testCaseIds:["V1"]}))};
  p.artifactAcceptance={...p.artifactAcceptance,status:"failed",hardGatePass:false,acceptedAt:undefined,attempts:0,maxRepairAttempts:1,results:[]};
  p.campaign={...p.campaign,status:"running",currentRound:0,noImprovementRounds:0,estimatedCost:0,startedAt:at,
    stopCriteria:{...p.campaign.stopCriteria,maxRounds:1,patienceRounds:1,maxWallMinutes:30,maxEstimatedCost:100},checkpoint:{round:1,completedPhase:"validation",at}};
  const suite=[TestCaseSchema.parse({...p.hiddenEvalSuite[0]!,id:"F1",input:"FINAL-PRIVATE-UNSEEN"})];
  p.finalHoldout={round:1,suite,paperHash:finalHoldoutPaperHash(suite),contractFingerprint:finalHoldoutContractFingerprint(p),createdAt:at};
  x.current.finalHoldoutPaperHash=p.finalHoldout.paperHash;x.prior.finalHoldoutPaperHash=p.finalHoldout.paperHash;
  bindHiddenRepairFixture(p,x.current);
  return {...x,p};
}

export function bindHiddenRepairFixture(p:EvolveProject,candidate:Candidate){
  if(p.finalHoldout)p.finalHoldout.contractFingerprint=finalHoldoutContractFingerprint(p);
  p.validationRun.evidenceFingerprint=evidenceFingerprint(p,candidate);
  p.artifactAcceptance.evidenceFingerprint=p.validationRun.evidenceFingerprint;
}
