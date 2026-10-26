import {describe,expect,it} from "vitest";
import {experimentRecoveryFixture} from "@evolution/testkit";
import {planningBaselineEvidence} from "./planning-baseline";

describe("current planning Baseline evidence",()=>{
  it("retains above-minimum improvement gaps and every original threshold",()=>{
    const p=experimentRecoveryFixture().project,row=p.baselineRun.result!.criterionScores![0]!;
    p.baselineRun.result!.criterionScores=[{...row,score:88,pass:true,gaps:["later configuration defaults missing"]}];
    p.acceptanceRubric[0]!.minScore=85;
    const before=structuredClone(p),context=planningBaselineEvidence(p);
    expect(context.criteria[0]).toMatchObject({criterionId:"CONTENT",minScore:85,status:"verified",score:88,meetsMinimum:true,
      improvementOpportunity:true,gaps:["later configuration defaults missing"]});
    expect(p).toEqual(before);
  });
  it.each(["duplicate","partial","demo"])("does not report %s scores as verified current measurements",kind=>{
    const p=experimentRecoveryFixture().project;
    if(kind==="duplicate")p.baselineRun.result!.criterionScores!.push({...p.baselineRun.result!.criterionScores![0]!});
    if(kind==="partial")p.baselineRun.result!.criterionScores![0]!.verificationStatus="partial";
    if(kind==="demo")p.baselineRun.result!.demoJudged=true;
    const context=planningBaselineEvidence(p);
    expect(context.criteria[0]!.score).toBeUndefined();expect(context.criteria[0]!.evidence).toEqual([]);
    expect(context.criteria[0]!.meetsMinimum).toBeUndefined();
  });
});
