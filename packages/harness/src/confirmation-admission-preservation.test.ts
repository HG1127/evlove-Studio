// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {ConfirmationAdmissionRequestV3Schema,JudgeCalibrationPlanV3Schema,JudgeCalibrationPlanV4Schema} from "@evolution/contracts";
import {assessMeasurementCalibration,calibrationPlanApprovalText,fastHash} from "@evolution/core";
import {absoluteCalibrationFixture,bindSyntheticCalibrationApprovals} from "@evolution/testkit";
import {checkFullConfirmationAdmission} from "./confirmation-admission";

/** Synthetic labels/observations only. No model, independent real approval or C42 acceptance. */
function preservationFixture(){
 const x=absoluteCalibrationFixture(),raw=structuredClone(x.plan),criterionId="SEM-CROSS-CONSISTENCY";
 Object.assign(raw.criteria[0]!,{id:criterionId,source:"source-understanding",judgeType:"pairwise",validationMethod:"cross-artifact",category:"artifact-specific",protectedConstraint:false,hardGate:true,minScore:92});
 for(const test of raw.testCases)test.criterionIds=[criterionId];
 raw.rubricFingerprint=fastHash(raw.criteria);raw.suiteFingerprint=fastHash(raw.testCases);
 const secondNegative=structuredClone(raw.controls[2]!);secondNegative.id="control-second-regression";
 secondNegative.context.inputFingerprint="second-regression-input";
 const text="Another broken measured body",hash=createHash("sha256").update(text).digest("hex");x.texts.set(hash,text);
 secondNegative.context.bindings[0]!.candidateSha256=hash;
 secondNegative.context.bindings[0]!.fileMetadata!.candidate.sizeBytes=Buffer.byteLength(text);
 for(const anchor of secondNegative.anchors)if(anchor.arm==="candidate")Object.assign(anchor,{sourceSha256:hash,endUtf16:text.length,quoteSha256:hash});
 raw.controls=[raw.controls[0]!,secondNegative,raw.controls[2]!];
 for(const control of raw.controls){
  control.context.criterionIds=[criterionId];control.context.rubricFingerprint=raw.rubricFingerprint;control.context.suiteFingerprint=raw.suiteFingerprint;
  for(const e of control.expectations)e.criterionId=criterionId;
  for(const anchor of control.anchors)anchor.criterionId=criterionId;
 }
 const plan=JudgeCalibrationPlanV4Schema.parse({...raw,schemaVersion:"judge-calibration-plan-v4",sourceArtifactCount:1,preservationCriterionIds:[criterionId]});
 const observations=plan.controls.map((control,i)=>{
  const o=structuredClone(x.observations[i===0?0:2]!);o.controlId=control.id;
  o.receipt={...o.receipt,...structuredClone(control.context)};
  for(const sample of o.receipt.samples)for(const [arm,value]of [[sample.original,96],[sample.controlOriginal,96],[sample.candidate,i===0?96:80]] as const){
   Object.assign(arm.criteria[0]!,{criterionId,score:value,pass:value>=92});
  }
  return o;
 });
 bindSyntheticCalibrationApprovals(plan,x.texts);
 const request=ConfirmationAdmissionRequestV3Schema.parse({...x.request,schemaVersion:"confirmation-admission-request-v3",requiredCalibrationVersion:"judge-calibration-plan-v4",
  sourceArtifactCount:1,rubricFingerprint:plan.rubricFingerprint,suiteFingerprint:plan.suiteFingerprint});
 const ports={...x.ports,readCalibrationPlan:async()=>plan,readCalibrationObservations:async()=>observations,
  verifyPreregistration:async(hash:string)=>hash===plan.preregistrationSha256,verifyOracleApproval:async(hash:string)=>hash===plan.oracleApprovalSha256};
 return {plan,observations,request,ports};
}

describe("versioned preservation calibration",()=>{
 it("qualifies unchanged preservation and measured rejection without inventing a quality-gain contrast",async()=>{
  const x=preservationFixture(),before=JSON.stringify(x);
  expect(assessMeasurementCalibration(x.plan,x.observations)).toMatchObject({ready:true,schemaVersion:"measurement-calibration-decision-v4"});
  expect(await checkFullConfirmationAdmission(x.request,x.ports)).toMatchObject({ready:true,schemaVersion:"full-confirmation-admission-v3",
   grantsModelBudget:false,grantsNewTrialAuthority:false,technicalAcceptanceEstablished:false});
  expect(x.plan.criteria[0]!.minScore).toBe(92);expect(JSON.stringify(x)).toBe(before);
 });
 it("does not reinterpret the same historical V3 controls",()=>{
  const x=preservationFixture(),{sourceArtifactCount,preservationCriterionIds,...raw}=x.plan;void sourceArtifactCount;void preservationCriterionIds;
  const old=JudgeCalibrationPlanV3Schema.parse({...raw,schemaVersion:"judge-calibration-plan-v3"});
  expect(assessMeasurementCalibration(old,x.observations)).toMatchObject({ready:false,schemaVersion:"measurement-calibration-decision-v3"});
  expect(assessMeasurementCalibration(old,x.observations).blockers).toContain("Missing labelled improvement/regression contrast for SEM-CROSS-CONSISTENCY");
 });
 it("requires explicit independently approved preservation intent rather than inferring it from metadata",()=>{
  const x=preservationFixture();x.plan.preservationCriterionIds=[];
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers).toContain("Missing labelled improvement/regression contrast for SEM-CROSS-CONSISTENCY");
 });
 it.each(["outcome","behavior","ux","performance"] as const)("cannot turn a %s quality goal into preservation",category=>{
  const x=preservationFixture();x.plan.criteria[0]!.category=category;
  x.plan.rubricFingerprint=fastHash(x.plan.criteria);
  for(const c of x.plan.controls)c.context.rubricFingerprint=x.plan.rubricFingerprint;
  for(const o of x.observations)o.receipt.rubricFingerprint=x.plan.rubricFingerprint;
  const r=assessMeasurementCalibration(x.plan,x.observations);
  expect(r.ready).toBe(false);expect(r.blockers).toContain("Ineligible preservation comparison: SEM-CROSS-CONSISTENCY");
 });
 it.each(["multi-source","user-quality"])("still requires real gains for %s",kind=>{
  const x=preservationFixture();
  if(kind==="multi-source")x.plan.sourceArtifactCount=2;
  else{
   Object.assign(x.plan.criteria[0]!,{source:"user-command",validationMethod:"semantic-judge"});
   x.plan.rubricFingerprint=fastHash(x.plan.criteria);
   for(const c of x.plan.controls)c.context.rubricFingerprint=x.plan.rubricFingerprint;
   for(const o of x.observations)o.receipt.rubricFingerprint=x.plan.rubricFingerprint;
  }
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers).toContain("Missing labelled improvement/regression contrast for SEM-CROSS-CONSISTENCY");
 });
 it("retains the exact absolute boundary and rejects a false pass in either order",()=>{
  for(const order of [0,1]){
   const x=preservationFixture(),row=x.observations[1]!.receipt.samples[order]!.candidate.criteria[0]!;
   row.score=92;row.pass=true;
   expect(assessMeasurementCalibration(x.plan,x.observations).blockers).toContain("Absolute threshold oracle contradicted: control-second-regression/SEM-CROSS-CONSISTENCY/candidate");
  }
 });
 it("rejects unknown Safety in every order and arm even without optional evidence policy",()=>{
  for(const order of [0,1])for(const arm of ["original","candidate","controlOriginal"] as const){
   const x=preservationFixture();
   for(const o of x.observations)delete o.receipt.evidenceStatusPolicy;
   const sample=x.observations[1]!.receipt.samples[order]!;
   sample[arm].safety="REVIEW";
   // Keep the original copy consistent so this is not merely a copy mismatch rejection.
   if(arm!=="candidate")sample.original.safety=sample.controlOriginal.safety="REVIEW";
   const result=assessMeasurementCalibration(x.plan,x.observations);
   expect(result.blockers).toEqual(["Unknown control Safety cannot qualify an explicit evidence measurement: "+x.plan.controls[1]!.id]);
  }
 });
 it("still requires labelled failures even if every score consistently passes",()=>{
  const x=preservationFixture();
  for(const c of x.plan.controls)for(const e of c.expectations)e.candidatePass=true;
  for(const o of x.observations.slice(1))for(const s of o.receipt.samples)Object.assign(s.candidate.criteria[0]!,{score:93,pass:true});
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers).toContain("Missing labelled pass/fail threshold contrasts for SEM-CROSS-CONSISTENCY");
 });
 it("does not waive regression, copy consistency or original-source anchors",()=>{
  for(const mode of ["regression","copy","anchor"]){
   const x=preservationFixture();
   if(mode==="regression"){
    for(const c of x.plan.controls.slice(1))c.minAbsoluteDelta=20;
   }else if(mode==="copy")x.observations[0]!.receipt.samples[0]!.controlOriginal.criteria[0]!.score=95;
   else x.plan.controls[1]!.anchors=[];
   expect(assessMeasurementCalibration(x.plan,x.observations).ready,mode).toBe(false);
  }
 });
 it("rejects unknown oracle labels and missing/invalid/underdeclared source counts",()=>{
  for(const count of [undefined,0,1.5,65]){
   const x=preservationFixture();expect(JudgeCalibrationPlanV4Schema.safeParse({...x.plan,sourceArtifactCount:count}).success).toBe(false);
  }
  const x=preservationFixture();
  expect(JudgeCalibrationPlanV4Schema.safeParse({...x.plan,controls:x.plan.controls.map(c=>({...c,expectations:c.expectations.map(e=>({...e,candidatePass:"unknown"}))}))}).success).toBe(false);
  x.plan.controls[1]!.context.bindings.push({...x.plan.controls[1]!.context.bindings[0]!,sourceArtifactId:"another-source"});
  expect(JudgeCalibrationPlanV4Schema.safeParse(x.plan).success).toBe(false);
 });
 it("binds source cardinality into canonical approval and refuses mismatched admission versions/counts",async()=>{
  const x=preservationFixture(),original=calibrationPlanApprovalText(x.plan);
  expect(calibrationPlanApprovalText({...x.plan,sourceArtifactCount:2})).not.toBe(original);
  expect(calibrationPlanApprovalText({...x.plan,preservationCriterionIds:[]})).not.toBe(original);
  expect((await checkFullConfirmationAdmission({...x.request,sourceArtifactCount:2},x.ports)).blockers).toContain("Calibration source cardinality differs from the intended Mission");
  const {sourceArtifactCount,...request}=x.request;void sourceArtifactCount;
  const legacy={...request,schemaVersion:"confirmation-admission-request-v2",requiredCalibrationVersion:"judge-calibration-plan-v3"};
  expect((await checkFullConfirmationAdmission(legacy,x.ports)).ready).toBe(false);
 });
});
