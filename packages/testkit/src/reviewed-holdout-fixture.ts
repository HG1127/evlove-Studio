import {InputUnderstandingSchema,TestCaseSchema} from "@evolution/contracts";
import {acceptedPackageFixture,acceptedAt} from "./accepted-package-fixture";
/** Synthetic data only; not real Mission acceptance evidence. */
export function reviewedHoldoutFixture(){
  const x=acceptedPackageFixture(false),p=x.project;
  p.inputUnderstanding=InputUnderstandingSchema.parse({status:"ready",confidence:0.9});
  p.sourceArtifacts[0]!.parseStatus="ready";
  x.blobs.set("source",new Blob([p.sourceArtifacts[0]!.textContent!],{type:"text/html"}));
  p.stage="baseline";
  p.gates=[{id:"target-ready",status:"approved",approvedAt:acceptedAt}];
  p.acceptanceRubric=[{id:"CONTENT",title:"内容",requirement:"完整",source:"user-command",weight:100,hardGate:true,
    judgeType:"llm",validationMethod:"semantic-judge",minScore:92,evidenceExpected:["content"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}];
  p.acceptanceRubricState={status:"ready",summary:"ready",version:1,weightTotal:100,uncoveredCriterionIds:[],warnings:[],confirmedAt:acceptedAt};
  p.evalSuite=[TestCaseSchema.parse({id:"V1",title:"Visible",input:"inspect",expected:["content"],criterionIds:["CONTENT"],executionMode:"artifact-runtime"})];
  p.hiddenEvalSuite=[TestCaseSchema.parse({id:"H1",title:"Hidden",input:"inspect exact",expected:["content"],hidden:true,criterionIds:["CONTENT"],executionMode:"artifact-runtime"})];
  p.baselineRun={...p.baselineRun,completedAt:acceptedAt,result:{...p.baselineRun.result!,safety:"REVIEW",notes:["Current safety configuration details are insufficient; no observed security violation."]}};
  p.experimentRun={...p.experimentRun,winnerId:x.current.id,candidateResults:[{candidateId:x.current.id,evaluation:{...p.validationRun.evaluation!},runs:[...p.validationRun.runs],artifactSnapshots:x.current.artifactSnapshots,experimentStage:"finalist"}]};
  p.validationRun={id:"validation-server-r1",status:"failed",error:"[server-campaign-holdout-judge-pending] invalid JSON",runs:[...p.validationRun.runs],baselineRuns:[...p.validationRun.baselineRuns],checks:[]};
  p.artifactAcceptance={...p.artifactAcceptance,status:"idle",acceptedAt:undefined};
  p.campaign={...p.campaign,status:"paused",currentRound:0,stopReason:"[server-campaign-baseline-evidence-pending] REVIEW",
    checkpoint:{round:1,completedPhase:"experiment",at:acceptedAt},schedule:{...p.campaign.schedule,enabled:false}};
  return x;
}
