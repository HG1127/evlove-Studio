import {describe,expect,it} from "vitest";
import {JudgeCalibrationPlanV1Schema,JudgeCalibrationPlanV2Schema,PairedJudgeReceiptSchema} from "@evolution/contracts";
import {absoluteCalibrationFixture,zeroReferenceCalibrationFixture} from "@evolution/testkit";
import {assessMeasurementCalibration,registeredZeroReferenceCriterionIds} from "./measurement-calibration";
import {inconclusivePairedCriteria,qualifyPairedEvaluation,zeroOutcomeReferenceCriterionIds} from "./paired-judge";
import {settleAiEvaluation} from "./evaluation-settlement";

describe("explicit relative outcome reference qualification (synthetic observations)",()=>{
 it("uses public eligibility without changing artifact-specific, protected, absolute or zero-minimum criteria",()=>{
  const c=zeroReferenceCalibrationFixture().plan.criteria[0]!;
  expect(zeroOutcomeReferenceCriterionIds([c,{...c,id:"SEM",category:"artifact-specific"},{...c,id:"PROTECT",protectedConstraint:true},
   {...c,id:"ABS",judgeType:"llm"},{...c,id:"ZERO",minScore:0}])).toEqual(["GOAL"]);
 });
 it("requires registered non-improvement for V2/V3 and never activates V1 from metadata",()=>{
  const x=zeroReferenceCalibrationFixture();expect(registeredZeroReferenceCriterionIds(x.plan)).toEqual(["GOAL"]);
  const legacyControls=x.plan.controls.map(c=>({...c,expectations:c.expectations.map(({originalPass,candidatePass,...e})=>{void originalPass;void candidatePass;return e;})}));
  expect(registeredZeroReferenceCriterionIds(JudgeCalibrationPlanV2Schema.parse({...x.plan,schemaVersion:"judge-calibration-plan-v2",controls:legacyControls}))).toEqual(["GOAL"]);
  const controls=legacyControls.map(c=>({...c,expectations:c.expectations.map(e=>({...e,direction:e.direction==="no-improvement"?"regress":e.direction}))}));
  expect(registeredZeroReferenceCriterionIds(JudgeCalibrationPlanV1Schema.parse({...x.plan,schemaVersion:"judge-calibration-plan-v1",controls}))).toEqual([]);
  x.plan.controls[2]!.expectations[0]!.direction="regress";expect(registeredZeroReferenceCriterionIds(x.plan)).toEqual([]);
 });
 it.each(["original","candidate","controlOriginal"] as const)("rejects %s REVIEW as calibration evidence while keeping known Safety FAIL negatives valid",arm=>{
  const x=zeroReferenceCalibrationFixture();expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(true);
  // Stable zero/false observations used to qualify even when all three copies said REVIEW.
  for(const s of x.observations[2]!.receipt.samples)s[arm].safety="REVIEW";
  const before=JSON.stringify(x.observations),decision=assessMeasurementCalibration(x.plan,x.observations);
  expect(decision.ready).toBe(false);expect(decision.blockers).toContain("Unknown zero-reference evidence cannot qualify a control: control-2");
  expect(JSON.stringify(x.observations)).toBe(before);
 });
 it("preserves legacy receipt qualification and rejects unknown policy values",()=>{
  const x=zeroReferenceCalibrationFixture(),r=x.observations[0]!.receipt;
  delete r.outcomeReferencePolicy;
  delete r.evidenceStatusPolicy;
  for(const s of r.samples)for(const a of [s.original,s.candidate,s.controlOriginal])a.safety="REVIEW";
  expect(inconclusivePairedCriteria(r,x.plan.criteria)).toEqual([]);
  expect(PairedJudgeReceiptSchema.safeParse({...r,outcomeReferencePolicy:"guess"}).success).toBe(false);
  r.outcomeReferencePolicy="zero-v1";expect(inconclusivePairedCriteria(r,x.plan.criteria)).toEqual(["GOAL"]);
 });
 it.each(["REVIEW","FAIL"] as const)("keeps relative unknown unverified alongside %s, preserving unrelated known failures",safety=>{
  const x=zeroReferenceCalibrationFixture(),r=x.observations[2]!.receipt;
  r.outcomeReferencePolicy="zero-v1";
  const absolute={...x.plan.criteria[0]!,id:"ABS",judgeType:"llm" as const};const criteria=[...x.plan.criteria,absolute];
  r.criterionIds.push("ABS");
  for(const s of r.samples)for(const arm of [s.original,s.candidate,s.controlOriginal]){
   arm.safety=safety;arm.criteria[0]!.evidenceStatus="unknown";arm.criteria.push({...arm.criteria[0]!,criterionId:"ABS",score:0,pass:false,evidenceStatus:"sufficient"});
  }
  const ai={accuracy:0,evidence:0,riskCoverage:0,completeness:0,safety,notes:[],failures:[],cases:[],
   criteria:criteria.map(c=>({criterionId:c.id,score:0,pass:false,testCaseIds:["V1"],evidence:["Synthetic body"],gaps:["Synthetic gap"]}))};
  const suite=x.plan.testCases.map(t=>({...t,criterionIds:["GOAL","ABS"]}));
  const value=settleAiEvaluation({criteria,testCases:suite,runs:[{testCaseId:"V1",output:"Synthetic body",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],ai});
  const result=qualifyPairedEvaluation(value,PairedJudgeReceiptSchema.parse(r),criteria);
  expect(result.criterionScores?.find(c=>c.criterionId==="GOAL")).toMatchObject({score:0,pass:false,verificationStatus:"unverified"});
  expect(result.unverifiedCriterionIds).toContain("GOAL");
  expect(result.criterionScores?.find(c=>c.criterionId==="ABS")).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
  expect(result.safety).toBe(safety);
 });
 it.each(["unknown",undefined] as const)("excludes relative status %s even with a separate known Safety FAIL",status=>{
  const x=zeroReferenceCalibrationFixture(),r=x.observations[2]!.receipt;
  for(const s of r.samples)for(const a of [s.original,s.candidate,s.controlOriginal]){
   a.safety="FAIL";if(status)a.criteria[0]!.evidenceStatus=status;else delete a.criteria[0]!.evidenceStatus;
  }
  expect(inconclusivePairedCriteria(r,x.plan.criteria)).toEqual(["GOAL"]);
  expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(false);
 });
 it("preserves fully known Safety FAIL negatives under the active per-criterion evidence policy",()=>{
  const x=zeroReferenceCalibrationFixture();expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(true);
  expect(inconclusivePairedCriteria(x.observations[2]!.receipt,x.plan.criteria)).toEqual([]);
 });
 it.each([0,1] as const)("excludes absolute unknown/absent evidence in order %s despite a matching false oracle and known FAIL",order=>{
  for(const arm of ["original","candidate","controlOriginal"] as const)for(const status of ["unknown",undefined] as const){
   const x=absoluteCalibrationFixture();
   for(const o of x.observations){o.receipt.evidenceStatusPolicy="criterion-evidence-v1";
    for(const s of o.receipt.samples)for(const a of [s.original,s.candidate,s.controlOriginal])a.criteria[0]!.evidenceStatus="sufficient";
   }
   const r=x.observations[2]!.receipt;
   for(const s of r.samples)for(const a of [s.original,s.candidate,s.controlOriginal])a.safety="FAIL";
   for(const s of r.samples){s.candidate.criteria[0]!.score=0;s.candidate.criteria[0]!.pass=false;}
   expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(true);
   if(status)r.samples[order][arm].criteria[0]!.evidenceStatus=status;else delete r.samples[order][arm].criteria[0]!.evidenceStatus;
   expect(inconclusivePairedCriteria(r,x.plan.criteria)).toEqual(["GOAL"]);
   expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(false);
  }
 });
 it("does not make an absolute legacy calibration negative unknown from the new zero-only rule",()=>{
  const x=absoluteCalibrationFixture();for(const s of x.observations[2]!.receipt.samples)for(const a of [s.original,s.candidate,s.controlOriginal])a.safety="REVIEW";
  expect(assessMeasurementCalibration(x.plan,x.observations).ready).toBe(true);
 });
});
