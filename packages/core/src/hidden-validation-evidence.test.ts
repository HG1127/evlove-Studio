import { describe, expect, it } from "vitest";
import type { EvaluationResult, ValidationRun } from "@evolution/contracts";
import { hasAuthoritativeHiddenRelease, hasFullHiddenMeasurement } from "./hidden-validation-evidence";

const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",
  averageCost:1,averageLatencyMs:1,notes:[],failures:[]} as EvaluationResult;
function validation(overrides:Partial<ValidationRun>={}):ValidationRun{
  return {id:"holdout",status:"completed",validationMode:"full",candidateId:"C1",
    recommendation:"release",evaluation,runs:[],baselineRuns:[],checks:[],...overrides};
}
describe("authoritative Hidden evidence",()=>{
  it("accepts a full measured non-demo release for the exact Candidate",()=>{
    expect(hasFullHiddenMeasurement(validation(),"C1")).toBe(true);
    expect(hasAuthoritativeHiddenRelease(validation(),"C1")).toBe(true);
  });
  it.each([
    ["missing evaluation",{evaluation:undefined}],
    ["fast gate",{validationMode:"fast-gate" as const}],
    ["legacy unknown mode",{validationMode:undefined}],
    ["demo judge",{evaluation:{...evaluation,demoJudged:true}}],
    ["different Candidate",{candidateId:"C2"}],
  ])("rejects %s as a full measured release",(_label,override)=>{
    expect(hasFullHiddenMeasurement(validation(override),"C1")).toBe(false);
    expect(hasAuthoritativeHiddenRelease(validation(override),"C1")).toBe(false);
  });
  it("keeps a measured hold available for diagnosis but never release",()=>{
    const hold=validation({recommendation:"hold"});
    expect(hasFullHiddenMeasurement(hold,"C1")).toBe(true);
    expect(hasAuthoritativeHiddenRelease(hold,"C1")).toBe(false);
  });
  it("rejects declared unverified criteria and failed safety",()=>{
    expect(hasAuthoritativeHiddenRelease(validation({evaluation:{...evaluation,unverifiedCriterionIds:["C"]}}),"C1")).toBe(false);
    expect(hasAuthoritativeHiddenRelease(validation({evaluation:{...evaluation,safety:"FAIL"}}),"C1")).toBe(false);
  });
});
