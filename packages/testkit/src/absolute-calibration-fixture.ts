import {createHash} from "node:crypto";
import {JudgeCalibrationPlanV3Schema,JudgeCalibrationObservationSchema,PairedJudgeContextSchema,PairedJudgeReceiptSchema,type ConfirmationAdmissionPorts,type JudgeCalibrationPlan} from "@evolution/contracts";
import {calibrationPlanApprovalText,fastHash,pairedJudgeFileMetadata} from "@evolution/core";
import {pairedJudgeFixture} from "./paired-judge-fixture";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");

/** Test-only self-signed substitutes; these are never independent production approvals. */
export function bindSyntheticCalibrationApprovals(plan:JudgeCalibrationPlan,texts:Map<string,string>){
 const planSha256=sha(calibrationPlanApprovalText(plan));
 for(const kind of ["preregistration","independent-oracle-approval"] as const){
  const text=JSON.stringify({schemaVersion:"judge-calibration-approval-v1",kind,planSha256,recordedAt:plan.registeredAt}),hash=sha(text);texts.set(hash,text);
  if(kind==="preregistration")plan.preregistrationSha256=hash;else plan.oracleApprovalSha256=hash;
 }
}

/** Synthetic labels, scores and trusted ports only. Never real calibration, oracle approval or application evidence. */
export function absoluteCalibrationFixture(){
 const x=pairedJudgeFixture(),source=x.project.sourceArtifacts[0]!,ref=x.project.baselineRun.originalReferences![0]!,frozen=x.candidate.artifactSnapshots[0]!.frozenArtifact!;
 const code="a".repeat(40);
 const texts=new Map([[ref.sha256,"Original measured body"],[frozen.sha256,"Updated measured body"]]);
 const criteria=x.project.acceptanceRubric,testCases=x.project.evalSuite;
 const context=PairedJudgeContextSchema.parse({protocol:"paired-two-order-v1",missionId:x.project.id,candidateId:x.candidate.id,phase:"visible",inputFingerprint:"synthetic-only",
  rubricFingerprint:fastHash(criteria),suiteFingerprint:fastHash(testCases),fileMetadataPolicy:"bound-file-reference-v1",testCaseIds:testCases.map(t=>t.id),criterionIds:criteria.map(c=>c.id),
  bindings:[{sourceArtifactId:source.id,originalSha256:ref.sha256,candidateSha256:frozen.sha256,fileMetadata:pairedJudgeFileMetadata(source,ref,frozen)}]});
 const controls=(["identical","known-improvement","known-regression"] as const).map((kind,index)=>{
  const c=structuredClone(context);c.inputFingerprint="fixed-control-"+index;const b=c.bindings[0]!;
  if(kind==="identical"){b.candidateSha256=b.originalSha256;b.fileMetadata!.candidate={...b.fileMetadata!.original,provenance:"frozen-artifact-reference"};}
  if(kind==="known-regression"){const body="Broken measured body!";texts.set(sha(body),body);b.candidateSha256=sha(body);b.fileMetadata!.candidate.sizeBytes=Buffer.byteLength(body);}
  const anchors=(["original","candidate"] as const).map(arm=>{const h=arm==="original"?b.originalSha256:b.candidateSha256;
   return {criterionId:"GOAL",arm,sourceArtifactId:b.sourceArtifactId,sourceSha256:h,startUtf16:0,endUtf16:texts.get(h)!.length,quoteSha256:h,scope:"source-text"};});
  return {id:"control-"+index,kind,minAbsoluteDelta:1,expectations:[{criterionId:"GOAL",direction:index===0?"same":index===1?"improve":"regress",originalPass:true,candidatePass:index!==2}],context:c,anchors};
 });
 const plan=JudgeCalibrationPlanV3Schema.parse({schemaVersion:"judge-calibration-plan-v3",id:"fixed-plan",preregistrationSha256:"c".repeat(64),oracleApprovalSha256:"d".repeat(64),
  registeredAt:"2026-10-01T00:00:00Z",sourceCommit:code,scoringRouteFingerprint:"fixed-model-route",rubricFingerprint:context.rubricFingerprint,suiteFingerprint:context.suiteFingerprint,
  paperUse:"diagnostic-only",applicationScenarioSha256:"2".repeat(64),confirmationWindowMs:1800000,maxHeartbeatGapMs:5000,testCases,criteria,controls});
 bindSyntheticCalibrationApprovals(plan,texts);
 const summary=(score:number)=>({accuracy:score,evidence:score,riskCoverage:score,completeness:score,safety:"PASS",criteria:[{criterionId:"GOAL",score,pass:score>=85,testCaseIds:["V1"]}]});
 const observations=plan.controls.map((control,index)=>{
  const a=summary(90),b=summary(index===0?90:index===1?96:80);
  const receipt=PairedJudgeReceiptSchema.parse({...control.context,scoringRouteFingerprint:plan.scoringRouteFingerprint,samples:[
   {order:"original-first",resultSha256:"e".repeat(64),original:a,candidate:b,controlOriginal:a},
   {order:"candidate-first",resultSha256:"f".repeat(64),original:a,candidate:b,controlOriginal:a}],limitations:["Synthetic absolute-label fixture; no real provider or application evidence"]});
  return JudgeCalibrationObservationSchema.parse({schemaVersion:"judge-calibration-observation-v1",controlId:control.id,firstRequestAt:"2026-10-02T00:00:00Z",completedAt:"2026-10-02T00:01:00Z",receipt});
 });
 const request={schemaVersion:"confirmation-admission-request-v2",requiredCalibrationVersion:"judge-calibration-plan-v3",sourceCommit:code,scoringRouteFingerprint:plan.scoringRouteFingerprint,
  rubricFingerprint:plan.rubricFingerprint,suiteFingerprint:plan.suiteFingerprint,calibrationPlanId:plan.id,applicationScenarioSha256:"2".repeat(64),applicationEvidenceSha256:"1".repeat(64),plannedWindowMs:1800000,maxHeartbeatGapMs:5000};
 const app={schemaVersion:"application-lifetime-evidence-v1",scope:"application-load",sourceCommit:code,scenarioSha256:"2".repeat(64),eventsSha256:"3".repeat(64),faultInjectionEvidenceSha256:"4".repeat(64),
  startedAt:"2026-10-02T00:00:00Z",completedAt:"2026-10-02T00:30:00Z",observedComponents:["backend","control-loop","native-runner"],exitCode:0,deadlineStop:false,automaticRestart:false,logsComplete:true,maximumHeartbeatGapMs:1000};
 const ports:ConfirmationAdmissionPorts={readCalibrationPlan:async()=>plan,readCalibrationObservations:async()=>observations,verifyPreregistration:async h=>h===plan.preregistrationSha256,
  verifyOracleApproval:async h=>h===plan.oracleApprovalSha256,readApplicationEvidence:async()=>app,verifyEvidenceArtifact:async()=>true,
  readText:async h=>{const value=texts.get(h);if(value===undefined)throw Error("Missing synthetic text");return value;},sha256Utf8:async s=>sha(s)};
 return {plan,observations,request,app,ports,texts};
}

/** Synthetic registered relative scores/labels only; never a real oracle or calibration approval. */
export function zeroReferenceCalibrationFixture(){
 const x=absoluteCalibrationFixture();x.plan.criteria[0]!.judgeType="pairwise";
 x.plan.rubricFingerprint=fastHash(x.plan.criteria);x.request.rubricFingerprint=x.plan.rubricFingerprint;
 for(const control of x.plan.controls){
  const e=control.expectations[0]!;e.originalPass=false;e.candidatePass=control.kind==="known-improvement";
  if(control.kind==="known-regression")e.direction="no-improvement";
  control.context.rubricFingerprint=x.plan.rubricFingerprint;
  const observation=x.observations.find(o=>o.controlId===control.id)!;observation.receipt.rubricFingerprint=x.plan.rubricFingerprint;
  observation.receipt.outcomeReferencePolicy="zero-v1";
  observation.receipt.evidenceStatusPolicy="criterion-evidence-v1";
  for(const s of observation.receipt.samples){
   for(const arm of [s.original,s.controlOriginal]){arm.criteria[0]!.score=0;arm.criteria[0]!.pass=false;arm.safety="FAIL";}
   s.candidate.criteria[0]!.score=e.candidatePass?96:0;s.candidate.criteria[0]!.pass=e.candidatePass;s.candidate.safety=e.candidatePass?"PASS":"FAIL";
   for(const arm of [s.original,s.candidate,s.controlOriginal]){arm.criteria[0]!.relativeEvidenceStatus="sufficient";arm.criteria[0]!.evidenceStatus="sufficient";}
  }
 }
 bindSyntheticCalibrationApprovals(x.plan,x.texts);return x;
}
