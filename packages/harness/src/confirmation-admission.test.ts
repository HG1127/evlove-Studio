// @vitest-environment node
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {JudgeCalibrationPlanSchema,JudgeCalibrationObservationSchema,PairedJudgeReceiptSchema,EvolveProjectSchema,
 type ConfirmationAdmissionPorts,type PairedJudgeReceipt} from "@evolution/contracts";
import {assessMeasurementCalibration,inconclusivePairedCriteria,fastHash} from "@evolution/core";
import {pairedJudgeFixture} from "@evolution/testkit";
import {serverPairedJudgeRequest} from "./server-paired-judge";
import {checkFullConfirmationAdmission} from "./confirmation-admission";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function fixture(){
 const x=pairedJudgeFixture(),r=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
 const code="a".repeat(40),texts=new Map([[r.context.bindings[0]!.originalSha256,"Original measured body"],[r.context.bindings[0]!.candidateSha256,"Updated measured body"]]);
 const controls=(["identical","known-improvement","known-regression"] as const).map((kind,index)=>{
  const context=structuredClone(r.context);context.inputFingerprint="fixed-control-"+index;
  if(kind==="identical")context.bindings[0]!.candidateSha256=context.bindings[0]!.originalSha256;
  if(kind==="known-regression"){const body="Broken measured body!";const h=sha(body);texts.set(h,body);context.bindings[0]!.candidateSha256=h;}
  const anchors=(["original","candidate"] as const).map(arm=>{const b=context.bindings[0]!,h=arm==="original"?b.originalSha256:b.candidateSha256;
   return {criterionId:"GOAL",arm,sourceArtifactId:b.sourceArtifactId,sourceSha256:h,startUtf16:0,endUtf16:texts.get(h)!.length,quoteSha256:h,scope:"source-text"};});
  return {id:"control-"+index,kind,minAbsoluteDelta:1,expectations:[{criterionId:"GOAL",direction:index===0?"same":index===1?"improve":"regress"}],context,anchors};
 });
 const plan=JudgeCalibrationPlanSchema.parse({schemaVersion:"judge-calibration-plan-v1",id:"fixed-plan",
  preregistrationSha256:"c".repeat(64),oracleApprovalSha256:"d".repeat(64),registeredAt:"2026-10-01T00:00:00Z",
  sourceCommit:code,scoringRouteFingerprint:"fixed-model-route",rubricFingerprint:r.context.rubricFingerprint,
  suiteFingerprint:r.context.suiteFingerprint,paperUse:"diagnostic-only",applicationScenarioSha256:"2".repeat(64),confirmationWindowMs:1800000,maxHeartbeatGapMs:5000,testCases:x.project.evalSuite,criteria:x.project.acceptanceRubric,controls});
 const summary=(score:number)=>({accuracy:score,evidence:score,riskCoverage:score,completeness:score,safety:"PASS",
  criteria:[{criterionId:"GOAL",score,pass:score>=85,testCaseIds:["V1"]}]});
 const observations=plan.controls.map((control,index)=>{const a=summary(90),b=summary(index===0?90:index===1?96:80);
  const receipt=PairedJudgeReceiptSchema.parse({...control.context,scoringRouteFingerprint:plan.scoringRouteFingerprint,
   samples:[{order:"original-first",resultSha256:"e".repeat(64),original:a,candidate:b,controlOriginal:a},
    {order:"candidate-first",resultSha256:"f".repeat(64),original:a,candidate:b,controlOriginal:a}],limitations:["synthetic fixed control; no real model or application evidence"]});
  return JudgeCalibrationObservationSchema.parse({schemaVersion:"judge-calibration-observation-v1",controlId:control.id,
   firstRequestAt:"2026-10-02T00:00:00Z",completedAt:"2026-10-02T00:01:00Z",receipt});
 });
 const request={schemaVersion:"confirmation-admission-request-v1",sourceCommit:code,scoringRouteFingerprint:plan.scoringRouteFingerprint,
  rubricFingerprint:plan.rubricFingerprint,suiteFingerprint:plan.suiteFingerprint,calibrationPlanId:plan.id,
  applicationScenarioSha256:"2".repeat(64),applicationEvidenceSha256:"1".repeat(64),plannedWindowMs:1800000,maxHeartbeatGapMs:5000};
 const app={schemaVersion:"application-lifetime-evidence-v1",scope:"application-load",sourceCommit:code,
  scenarioSha256:"2".repeat(64),eventsSha256:"3".repeat(64),faultInjectionEvidenceSha256:"4".repeat(64),
  startedAt:"2026-10-02T00:00:00Z",completedAt:"2026-10-02T00:30:00Z",
  observedComponents:["backend","control-loop","native-runner"],exitCode:0,deadlineStop:false,automaticRestart:false,logsComplete:true,maximumHeartbeatGapMs:1000};
 const ports:ConfirmationAdmissionPorts={readCalibrationPlan:async()=>plan,readCalibrationObservations:async()=>observations,
  verifyPreregistration:async()=>true,verifyOracleApproval:async()=>true,readApplicationEvidence:async()=>app,
  verifyEvidenceArtifact:async()=>true,readText:async h=>texts.get(h)!,sha256Utf8:async s=>sha(s)};
 return {plan,observations,request,app,ports};
}
describe("fixed calibration and full confirmation admission",()=>{
 it("admits all fixed synthetic contrasts only with separate exact application-load evidence, without granting authority",async()=>{
  const x=fixture(),result=await checkFullConfirmationAdmission(x.request,x.ports);
  expect(result.ready).toBe(true);expect(result.grantsNewTrialAuthority).toBe(false);
  expect(result.grantsModelBudget).toBe(false);expect(result.technicalAcceptanceEstablished).toBe(false);
  expect(x.observations[2]!.receipt.samples[0].candidate.criteria[0]!.score).toBe(80);
 });
 it("allows unchanged protection at its ceiling in a positive goal control while still requiring a degradation contrast",()=>{
  const x=fixture(),criterion={...x.plan.criteria[0]!,id:"GUARD",judgeType:"integrity" as const,category:"protected" as const,protectedConstraint:true,minScore:95};
  x.plan.criteria.push(criterion);x.plan.testCases[0]!.criterionIds.push("GUARD");
  x.plan.rubricFingerprint=fastHash(x.plan.criteria);x.plan.suiteFingerprint=fastHash(x.plan.testCases);
  for(const control of x.plan.controls){
   control.context.criterionIds.push("GUARD");control.context.rubricFingerprint=x.plan.rubricFingerprint;control.context.suiteFingerprint=x.plan.suiteFingerprint;
   const direction=control.kind==="known-regression"?"regress" as const:"same" as const;
   control.expectations.push({criterionId:"GUARD",direction});
   control.anchors.push(...control.anchors.filter(a=>a.criterionId==="GOAL").map(a=>({...a,criterionId:"GUARD"})));
   const observation=x.observations.find(o=>o.controlId===control.id)!;
   observation.receipt={...observation.receipt,...structuredClone(control.context)};
   for(const sample of observation.receipt.samples){
    const row=(score:number)=>({criterionId:"GUARD",score,pass:score>=95,testCaseIds:["V1"]});
    sample.original.criteria.push(row(100));sample.controlOriginal.criteria.push(row(100));sample.candidate.criteria.push(row(control.kind==="known-regression"?90:100));
   }
  }
  expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(true);
  for(const sample of x.observations[1]!.receipt.samples)sample.candidate.criteria.find(c=>c.criterionId==="GUARD")!.score=99;
  expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(false);
  // A known failing goal may change overall Safety while an unrelated protection criterion stays identical.
  const negative=x.plan.controls[2]!,observation=x.observations[2]!;
  negative.expectations.find(e=>e.criterionId==="GUARD")!.direction="same";
  for(const sample of observation.receipt.samples){sample.candidate.safety="FAIL";const row=sample.candidate.criteria.find(c=>c.criterionId==="GUARD")!;row.score=100;row.pass=true;}
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers).not.toContain("Nonzero identical control: control-2/GUARD");
 });
 it("reproduces C43 detail 82/88 versus 96/96 as unqualified, preserving both observed pairs",()=>{
  const x=fixture(),positive=x.observations[1]!.receipt;
  for(const [i,s] of positive.samples.entries()){s.original.criteria[0]!.score=i===0?82:88;s.original.criteria[0]!.pass=i!==0;s.controlOriginal=structuredClone(s.original);}
  const before=JSON.stringify(x.observations),result=assessMeasurementCalibration(x.plan,x.observations);
  expect(result.ready).toBe(false);expect(result.blockers.join()).toContain("threshold/direction/copy");
  expect(JSON.stringify(x.observations)).toBe(before);
 });
 it("holds 100/99 protection direction changes, a valid negative result, and copy-control disagreement",()=>{
  for(const mode of ["direction","negative","copy"]){
   const x=fixture(),r=x.observations[1]!.receipt;
   if(mode==="direction")for(const [i,s] of r.samples.entries()){s.original.criteria[0]!.score=100;s.controlOriginal=structuredClone(s.original);s.candidate.criteria[0]!.score=i===0?100:99;}
   if(mode==="negative")for(const s of r.samples)s.candidate.criteria[0]!.score=80;
   if(mode==="copy")r.samples[0].controlOriginal.criteria[0]!.score=91;
   const before=JSON.stringify(x.observations);expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(false);
   expect(JSON.stringify(x.observations)).toBe(before);
  }
 });
 it("rejects duplicate/favorable subsets and each missing control kind",()=>{
  for(const observations of [fixture().observations.slice(0,2),[...fixture().observations,fixture().observations[1]!]]){
   const x=fixture();expect(assessMeasurementCalibration(x.plan,observations).ready).toBe(false);
  }
  const x=fixture();x.plan.controls=x.plan.controls.slice(1);
  expect(assessMeasurementCalibration(x.plan,x.observations.slice(1)).blockers.join()).toContain("Missing fixed identical");
 });
 it("rejects wrong model, paper, file, registration order or source-text anchor",async()=>{
  for(const mode of ["model","paper","file","date","anchor","native-only"]){
   const x=fixture(),control=x.plan.controls[1]!,receipt=x.observations[1]!.receipt;
   if(mode==="model")receipt.scoringRouteFingerprint="different-model";
   if(mode==="paper")receipt.suiteFingerprint="different-paper";
   if(mode==="file")receipt.bindings[0]!.candidateSha256="9".repeat(64);
   if(mode==="date")x.observations[1]!.firstRequestAt="2026-09-30T00:00:00Z";
   if(mode==="anchor")control.anchors[0]!.quoteSha256="9".repeat(64);
   if(mode==="native-only")for(const a of control.anchors){a.scope="native-fact";a.assertionId="native-style";}
   expect((await checkFullConfirmationAdmission(x.request,x.ports)).ready).toBe(false);
  }
 });
 it("fails closed on idle-only, wrong commit, insufficient duration, incomplete output or unverified canonical evidence",async()=>{
  for(const mode of ["idle","commit","duration","output","trust","oracle","short-window","threshold","scenario"]){
   const x=fixture();
   if(mode==="idle")x.app.scope="idle-only";
   if(mode==="commit")x.app.sourceCommit="b".repeat(40);
   if(mode==="duration")x.app.completedAt="2026-10-02T00:28:00Z";
   if(mode==="output")x.app.logsComplete=false;
   if(mode==="trust")x.ports.verifyEvidenceArtifact=async()=>false;
   if(mode==="oracle")x.ports.verifyOracleApproval=async()=>false;
   if(mode==="short-window")x.request.plannedWindowMs=1;
   if(mode==="threshold")x.plan.criteria[0]!.minScore=1;
   if(mode==="scenario")x.app.scenarioSha256="9".repeat(64);
   expect((await checkFullConfirmationAdmission(x.request,x.ports)).ready).toBe(false);
  }
 });
});
// Explicit local read-only replay: no source bytes are copied into fixtures or sent to a provider.
it.skipIf(!process.env.EVOLUTION_C43_TERMINAL_PATH)("keeps the actual stored C43 three-criterion REVIEW after current full schema validation",()=>{
 const path=process.env.EVOLUTION_C43_TERMINAL_PATH!,bytes=readFileSync(path),before=sha(bytes.toString());
 expect(before).toBe("4563665a69efdf5c7f442bcaf71d101540080f47ff9fed341eb1c4318d29d288");
 const p=EvolveProjectSchema.parse(JSON.parse(bytes.toString())),evaluation=p.experimentRun.candidateResults[0]!.evaluation!;
 const receipt=evaluation.judgeComparison!.receipt as PairedJudgeReceipt;
 expect(inconclusivePairedCriteria(receipt,p.acceptanceRubric)).toEqual(["AC-REFINE-DETAIL","SYS-INTEGRITY","PROTECT-ALL"]);
 expect(evaluation.safety).toBe("REVIEW");expect(sha(readFileSync(path).toString())).toBe(before);
});
