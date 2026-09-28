import { describe, expect, it } from "vitest";
import type { EvaluationResult, TestCase, ValidationRun } from "@evolution/contracts";
import { hasAuthoritativeHiddenRelease, hasFullHiddenMeasurement } from "./hidden-validation-evidence";

const suite=[{id:"H1"}] as TestCase[];
const run={testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const};
const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",
  averageCost:1,averageLatencyMs:1,notes:[],failures:[]} as EvaluationResult;
function validation(overrides:Partial<ValidationRun>={}):ValidationRun{
  return {id:"holdout",status:"completed",validationMode:"full",candidateId:"C1",
    recommendation:"release",evaluation,runs:[run],baselineRuns:[],checks:[],...overrides};
}
describe("authoritative Hidden evidence",()=>{
  it("accepts a full measured non-demo release for the exact Candidate",()=>{
    expect(hasFullHiddenMeasurement(validation(),"C1",suite)).toBe(true);
    expect(hasAuthoritativeHiddenRelease(validation(),"C1",suite)).toBe(true);
  });
  it.each([
    ["missing evaluation",{evaluation:undefined}],
    ["fast gate",{validationMode:"fast-gate" as const}],
    ["legacy unknown mode",{validationMode:undefined}],
    ["demo judge",{evaluation:{...evaluation,demoJudged:true}}],
    ["different Candidate",{candidateId:"C2"}],
    ["missing Test Case receipt",{runs:[]}],
    ["duplicate Test Case receipt",{runs:[run,run]}],
    ["wrong Test Case receipt",{runs:[{...run,testCaseId:"H2"}]}],
    ["incomplete planned count",{plannedCases:2}],
    ["incomplete executed count",{executedCases:0}],
  ])("rejects %s as a full measured release",(_label,override)=>{
    expect(hasFullHiddenMeasurement(validation(override),"C1",suite)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(validation(override),"C1",suite)).toBe(false);
  });
  it("treats a legacy record without execution receipts as unmeasured",()=>{
    const legacy={...validation(),runs:undefined} as unknown as ValidationRun;
    expect(hasFullHiddenMeasurement(legacy,"C1",suite)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(legacy,"C1",suite)).toBe(false);
  });
  it("rejects empty or repeated current Hidden Test Case identities",()=>{
    expect(hasFullHiddenMeasurement(validation(),"C1",[])).toBe(false);
    expect(hasFullHiddenMeasurement(validation({runs:[run,run]}),"C1",[suite[0]!,suite[0]!])).toBe(false);
  });
  it("keeps partial and unverified execution available for diagnosis but not release",()=>{
    for(const verificationStatus of ["partial","unverified","failed"] as const){
      const measured=validation({runs:[{...run,verificationStatus}]});
      expect(hasFullHiddenMeasurement(measured,"C1",suite)).toBe(true);
      expect(hasAuthoritativeHiddenRelease(measured,"C1",suite)).toBe(false);
    }
  });
  it("keeps a measured hold available for diagnosis but never release",()=>{
    const hold=validation({recommendation:"hold"});
    expect(hasFullHiddenMeasurement(hold,"C1",suite)).toBe(true);
    expect(hasAuthoritativeHiddenRelease(hold,"C1",suite)).toBe(false);
  });
  it("rejects declared unverified criteria and failed safety",()=>{
    expect(hasAuthoritativeHiddenRelease(validation({evaluation:{...evaluation,unverifiedCriterionIds:["C"]}}),"C1",suite)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(validation({evaluation:{...evaluation,safety:"FAIL"}}),"C1",suite)).toBe(false);
  });
});
