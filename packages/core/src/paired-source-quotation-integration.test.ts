import {describe,expect,it} from "vitest";
import {EvaluateAiResultSchema,PairedEvaluationAiResultSchema,PAIRED_SOURCE_QUOTATION_POLICY} from "@evolution/contracts";
import {absoluteCalibrationFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {assessMeasurementCalibration} from "./measurement-calibration";
import {conservativePairedJudgments} from "./paired-judge";
describe("quotation policy at downstream boundaries",()=>{
 it("excludes only known runtime metadata from calibration context identity",()=>{
  const {plan,observations}=absoluteCalibrationFixture();
  for(const o of observations)o.receipt.sourceQuotationPolicy=PAIRED_SOURCE_QUOTATION_POLICY;
  expect(assessMeasurementCalibration(plan,observations).ready).toBe(true);
  observations[0]!.receipt.inputFingerprint+="tampered";
  expect(assessMeasurementCalibration(plan,observations).blockers).toContain("Control identity/model/file/paper binding differs: control-0");
 });
 it("does not erase unknown Safety or bad absolute labels while handling the new receipt field",()=>{
  const {plan,observations}=absoluteCalibrationFixture();
  for(const o of observations){o.receipt.sourceQuotationPolicy=PAIRED_SOURCE_QUOTATION_POLICY;o.receipt.evidenceStatusPolicy="criterion-evidence-v1";}
  observations[1]!.receipt.samples[0].candidate.safety="REVIEW";
  const result=assessMeasurementCalibration(plan,observations);
  expect(result.ready).toBe(false);expect(result.blockers.some(b=>b.startsWith("Unknown control Safety"))).toBe(true);
 });
 it("preserves all 192 claims from two legal 96-claim orders with adjusted note indices",()=>{
  const evaluation=()=>{
   const value=pairedJudgeRawEvaluation(90);value.notes=Array.from({length:96},(_,i)=>"Observed quotation "+i);
   value.sourceQuotations=value.notes.map((quote,noteIndex)=>({sourceArtifactId:"source",sha256:"a".repeat(64),relation:"present",quote,noteIndex}));return value;
  };
  const raw={schemaVersion:"paired-evaluation-v1",requestFingerprint:"fixed",versions:["A","B","C"].map(slot=>({slot,result:evaluation()}))};
  expect(PairedEvaluationAiResultSchema.safeParse(raw).success).toBe(true);
  const pair={original:evaluation(),candidate:evaluation()},combined=conservativePairedJudgments([pair,structuredClone(pair)]);
  expect(combined.candidate.sourceQuotations).toHaveLength(192);expect(combined.candidate.sourceQuotations!.at(-1)!.noteIndex).toBe(191);
  expect(EvaluateAiResultSchema.parse(combined.candidate).sourceQuotations).toHaveLength(192);
  raw.versions[0]!.result.sourceQuotations!.push(structuredClone(raw.versions[0]!.result.sourceQuotations![0]!));
  expect(PairedEvaluationAiResultSchema.safeParse(raw).success).toBe(false);
 });
});
