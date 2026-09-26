import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion, EvaluationResult, TargetRunResult, TestCase } from "@evolution/contracts";
import { applyDeterministicRoundtripEvidence, hasDeterministicRoundtripProof } from "./deterministic-criterion-evidence";

describe("deterministic criterion evidence",()=>{
  it("rejects repeated Run or Test Case IDs before granting a deterministic pass",()=>{
    const criterion={id:"FORMAT",validationMethod:"format-roundtrip"} as AcceptanceCriterion;
    const testCase={id:"F1",criterionIds:["FORMAT"],executionMode:"roundtrip"} as TestCase;
    const failed={testCaseId:"F1",output:"not preserved",latencyMs:0,cost:0,verificationStatus:"unverified",trace:[]} as TargetRunResult;
    const passed={testCaseId:"F1",output:"CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED",latencyMs:0,cost:0,verificationStatus:"verified",trace:[{id:"proof",stage:"format-roundtrip",summary:"preserved",status:"pass"}]} as TargetRunResult;
    expect(hasDeterministicRoundtripProof(criterion,[testCase],[passed])).toBe(true);
    expect(hasDeterministicRoundtripProof(criterion,[{...testCase,executionMode:"external-runner"}],[passed])).toBe(false);
    expect(hasDeterministicRoundtripProof(criterion,[testCase],[{...passed,trace:[]}])).toBe(false);
    expect(hasDeterministicRoundtripProof(criterion,[testCase],[failed,passed])).toBe(false);
    expect(hasDeterministicRoundtripProof(criterion,[testCase,testCase],[passed])).toBe(false);
    const evaluation={notes:[],criterionScores:[],unverifiedCriterionIds:["FORMAT"]} as unknown as EvaluationResult;
    const settled=applyDeterministicRoundtripEvidence({criteria:[criterion],testCases:[testCase],runs:[failed,passed],evaluation});
    expect(settled.settledCriterionIds).toEqual([]);
    expect(settled.evaluation).toBe(evaluation);
  });

  it("settles only proven format roundtrip criteria and recomputes rubric coverage",()=>{
    const format={
      id:"FORMAT",title:"原格式",requirement:"保持 Markdown",source:"system-integrity",weight:40,hardGate:true,
      judgeType:"integrity",validationMethod:"format-roundtrip",minScore:90,evidenceExpected:[],protectedConstraint:false,
      artifactIds:[],category:"artifact-specific",
    } as AcceptanceCriterion;
    const semantic={
      id:"CONTENT",title:"内容质量",requirement:"内容达标",source:"user-command",weight:60,hardGate:true,
      judgeType:"llm",validationMethod:"semantic-judge",minScore:85,evidenceExpected:[],protectedConstraint:false,
      artifactIds:[],category:"outcome",
    } as AcceptanceCriterion;
    const formatCase={id:"F1",criterionIds:["FORMAT"],executionMode:"roundtrip"} as TestCase;
    const semanticCase={id:"S1",criterionIds:["CONTENT"]} as TestCase;
    const runs:[TargetRunResult,TargetRunResult]=[
      {testCaseId:"F1",output:"CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED",latencyMs:0,cost:0,verificationStatus:"verified",trace:[{id:"rt",stage:"format-roundtrip",summary:"ok",status:"pass"}]},
      {testCaseId:"S1",output:"pending",latencyMs:0,cost:0,verificationStatus:"unverified",trace:[]},
    ];
    const evaluation={
      accuracy:88,evidence:80,riskCoverage:80,completeness:85,safety:"PASS",averageCost:0,averageLatencyMs:0,
      notes:[],failures:[],criterionScores:[
        {criterionId:"FORMAT",score:0,pass:false,verificationStatus:"unverified",evidence:[],gaps:["missing"],testCaseIds:["F1"]},
        {criterionId:"CONTENT",score:0,pass:false,verificationStatus:"unverified",evidence:[],gaps:["missing"],testCaseIds:["S1"]},
      ],
      unverifiedCriterionIds:["FORMAT","CONTENT"],verifiedRubricCoverage:0,
    } as EvaluationResult;
    const settled=applyDeterministicRoundtripEvidence({criteria:[format,semantic],testCases:[formatCase,semanticCase],runs,evaluation});
    expect(settled.settledCriterionIds).toEqual(["FORMAT"]);
    expect(settled.evaluation.criterionScores?.find((item)=>item.criterionId==="FORMAT")).toMatchObject({score:100,pass:true,verificationStatus:"verified"});
    expect(settled.evaluation.unverifiedCriterionIds).toEqual(["CONTENT"]);
    expect(settled.evaluation.verifiedRubricCoverage).toBe(40);
  });
});
