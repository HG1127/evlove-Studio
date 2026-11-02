// @vitest-environment node
import {describe,expect,it} from "vitest";
import {ConfirmationAdmissionRequestSchema,JudgeCalibrationPlanV1Schema,JudgeCalibrationPlanV2Schema,JudgeCalibrationPlanV3Schema} from "@evolution/contracts";
import {assessMeasurementCalibration,calibrationPlanApprovalText,fastHash} from "@evolution/core";
import {absoluteCalibrationFixture,bindSyntheticCalibrationApprovals} from "@evolution/testkit";
import {checkFullConfirmationAdmission} from "./confirmation-admission";

describe("absolute threshold calibration and current full admission",()=>{
 it("admits synthetic correctly labelled contrasts only under the explicit new protocols",async()=>{
  const x=absoluteCalibrationFixture(),decision=assessMeasurementCalibration(x.plan,x.observations);
  expect(decision).toMatchObject({schemaVersion:"measurement-calibration-decision-v3",ready:true});
  expect(await checkFullConfirmationAdmission(x.request,x.ports)).toMatchObject({schemaVersion:"full-confirmation-admission-v2",ready:true,
   grantsModelBudget:false,grantsNewTrialAuthority:false,technicalAcceptanceEstablished:false});
 });
 it("retains achievable exact-zero relative controls with separately labelled positive improvement",async()=>{
  const x=absoluteCalibrationFixture();x.plan.criteria[0]!.judgeType="pairwise";
  x.plan.rubricFingerprint=fastHash(x.plan.criteria);x.request.rubricFingerprint=x.plan.rubricFingerprint;
  for(const control of x.plan.controls){
   const e=control.expectations[0]!;e.originalPass=false;e.candidatePass=control.kind==="known-improvement";
   if(control.kind==="known-regression")e.direction="no-improvement";
   control.context.rubricFingerprint=x.plan.rubricFingerprint;
   const observation=x.observations.find(o=>o.controlId===control.id)!;observation.receipt.rubricFingerprint=x.plan.rubricFingerprint;
   for(const s of observation.receipt.samples){
    for(const arm of [s.original,s.controlOriginal]){arm.criteria[0]!.score=0;arm.criteria[0]!.pass=false;arm.safety="FAIL";}
    s.candidate.criteria[0]!.score=e.candidatePass?96:0;s.candidate.criteria[0]!.pass=e.candidatePass;s.candidate.safety=e.candidatePass?"PASS":"FAIL";
   }
  }
  bindSyntheticCalibrationApprovals(x.plan,x.texts);
  expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(true);
  expect((await checkFullConfirmationAdmission(x.request,x.ports)).ready).toBe(true);
  for(const s of x.observations[2]!.receipt.samples)s.candidate.criteria[0]!.score=15;
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers.join()).toContain("exact zero failure");
 });
 it("rejects a stable known-negative false pass even when both deltas regress consistently",async()=>{
  const x=absoluteCalibrationFixture();
  for(const s of x.observations[2]!.receipt.samples){s.candidate.criteria[0]!.score=88;s.candidate.criteria[0]!.pass=true;}
  const before=JSON.stringify(x.observations),r=assessMeasurementCalibration(x.plan,x.observations);
  expect(r.ready).toBe(false);expect(r.blockers).toContain("Absolute threshold oracle contradicted: control-2/GOAL/candidate");
  expect((await checkFullConfirmationAdmission(x.request,x.ports)).ready).toBe(false);
  expect(JSON.stringify(x.observations)).toBe(before);
 });
 it("qualifies the Original absolute result too, instead of only checking Candidate gains",()=>{
  const x=absoluteCalibrationFixture();
  for(const s of x.observations[1]!.receipt.samples){s.original.criteria[0]!.score=84;s.original.criteria[0]!.pass=false;s.controlOriginal=structuredClone(s.original);}
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers).toContain("Absolute threshold oracle contradicted: control-1/GOAL/original");
 });
 it.each([[88,false],[80,true],[85,false]])("rejects inconsistent negative classification score=%s pass=%s",(score,pass)=>{
  const x=absoluteCalibrationFixture();
  for(const s of x.observations[2]!.receipt.samples){s.candidate.criteria[0]!.score=score;s.candidate.criteria[0]!.pass=pass;}
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers).toContain("Absolute threshold oracle contradicted: control-2/GOAL/candidate");
 });
 it("requires a known failing threshold side even if all above-threshold comparisons are correctly labelled",()=>{
  const x=absoluteCalibrationFixture();x.plan.controls[2]!.expectations[0]!.candidatePass=true;
  for(const s of x.observations[2]!.receipt.samples){s.candidate.criteria[0]!.score=88;s.candidate.criteria[0]!.pass=true;}
  expect(JudgeCalibrationPlanV3Schema.safeParse(x.plan).success).toBe(true);
  expect(assessMeasurementCalibration(x.plan,x.observations).blockers).toEqual(["Missing labelled pass/fail threshold contrasts for GOAL"]);
 });
 it("keeps unverified labels unrepresentable as an approved v3 oracle",()=>{
  for(const value of [null,undefined,"false"]){
   const x=absoluteCalibrationFixture();Object.assign(x.plan.controls[2]!.expectations[0]!,{candidatePass:value});
   expect(JudgeCalibrationPlanV3Schema.safeParse(x.plan).success).toBe(false);
  }
  const x=absoluteCalibrationFixture();x.plan.criteria[0]!.minScore=0;
  expect(JudgeCalibrationPlanV3Schema.safeParse(x.plan).success).toBe(false);
 });
 it("rejects contradictory absolute labels but permits a registered regression that remains above its minimum",()=>{
  for(const direction of ["same","improve","regress"] as const){
   const x=absoluteCalibrationFixture(),e=x.plan.controls[1]!.expectations[0]!;e.direction=direction;
   e.originalPass=direction==="regress"?false:true;e.candidatePass=direction==="regress"?true:false;
   expect(JudgeCalibrationPlanV3Schema.safeParse(x.plan).success).toBe(false);
  }
  const x=absoluteCalibrationFixture();x.plan.controls[2]!.expectations[0]!.candidatePass=true;
  expect(JudgeCalibrationPlanV3Schema.safeParse(x.plan).success).toBe(true);
 });
 it("binds both absolute labels into the immutable independent approval content",async()=>{
  const x=absoluteCalibrationFixture(),before=calibrationPlanApprovalText(x.plan);
  x.plan.controls[2]!.expectations[0]!.candidatePass=true;
  expect(calibrationPlanApprovalText(x.plan)).not.toBe(before);
  const r=await checkFullConfirmationAdmission(x.request,x.ports);
  expect(r.ready).toBe(false);expect(r.blockers.join()).toContain("Canonical approval does not bind");
 });
 it("can read legacy decisions but will not grant a new full admission from either old plan version",async()=>{
  for(const version of ["v1","v2"] as const){
   const x=absoluteCalibrationFixture(),schema=version==="v1"?JudgeCalibrationPlanV1Schema:JudgeCalibrationPlanV2Schema;
   const plan=schema.parse({...x.plan,schemaVersion:'judge-calibration-plan-'+version,
    controls:x.plan.controls.map(c=>({...c,expectations:c.expectations.map(({originalPass,candidatePass,...e})=>{void originalPass;void candidatePass;return e;})}))});
   bindSyntheticCalibrationApprovals(plan,x.texts);
   expect(assessMeasurementCalibration(plan,x.observations).ready).toBe(true);
   const r=await checkFullConfirmationAdmission(x.request,{...x.ports,readCalibrationPlan:async()=>plan,
    verifyPreregistration:async h=>h===plan.preregistrationSha256,verifyOracleApproval:async h=>h===plan.oracleApprovalSha256});
   expect(r.ready).toBe(false);expect(r.blockers).toHaveLength(1);expect(r.blockers[0]).toContain("legacy directional readiness is insufficient");
  }
 });
 it("does not silently upgrade an old request, or accept a missing/wrong required version",async()=>{
  const x=absoluteCalibrationFixture(),{requiredCalibrationVersion,...old}=x.request;void requiredCalibrationVersion;
  const r=await checkFullConfirmationAdmission({...old,schemaVersion:"confirmation-admission-request-v1"},x.ports);
  expect(r.ready).toBe(false);expect(r.blockers).toHaveLength(1);
  expect(ConfirmationAdmissionRequestSchema.safeParse({...old,schemaVersion:"confirmation-admission-request-v2"}).success).toBe(false);
  expect(ConfirmationAdmissionRequestSchema.safeParse({...x.request,requiredCalibrationVersion:"judge-calibration-plan-v2"}).success).toBe(false);
 });
});
