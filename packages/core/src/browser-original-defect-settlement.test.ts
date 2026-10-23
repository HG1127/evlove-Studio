import {describe,expect,it} from "vitest";
import type {AcceptanceCriterion,TargetRunResult,TestCase} from "@evolution/contracts";
import {criteriaRequiringJudge,deriveCriterionScores} from "./evaluation-settlement";

const criterion={
  id:"USER-SEARCH",title:"搜索正常",requirement:"输入 alpha 可见结果",
  source:"user-command",weight:100,hardGate:true,judgeType:"llm",
  validationMethod:"user-scenario",minScore:90,
  evidenceExpected:["cloud Browser assertion"],artifactIds:["source"],
  protectedConstraint:false,category:"outcome",
} as AcceptanceCriterion;
const testCase={
  id:"H-SEARCH",title:"Search",input:"输入 alpha",expected:["可见卡片"],
  criterionIds:["USER-SEARCH"],tags:[],hidden:true,
  executionMode:"external-runner",evidenceScope:"product-behavior",
} as TestCase;
const sha="a".repeat(64);
const baseline:TargetRunResult={
  testCaseId:testCase.id,
  artifactHash:sha,cost:0,latencyMs:20,verificationStatus:"verified",
  output:"VERIFIED DOCUMENTED BASELINE DEFECT (not product success)\nExact Original HTML SHA-256: "+sha,
  trace:[
    {id:"artifact",stage:"sandbox-artifact",status:"pass",summary:"sha verified"},
    {id:"preview",stage:"browser-preview",status:"pass",summary:"preview loaded"},
    {id:"step",stage:"browser-step",status:"fail",summary:"actual visible assertion failed"},
    {id:"negative",stage:"baseline-exact-browser-negative-evidence",status:"pass",summary:"recorded defect"},
  ],
};
describe("Cloud Browser observed original defect cannot be promoted to passing score",()=>{
  it("scores exact original failed assertion as a VERIFIED FAIL, without using a model Judge",()=>{
    expect(criteriaRequiringJudge([criterion],[testCase],[baseline])).toEqual([]);
    const score=deriveCriterionScores([criterion],[testCase],[],[baseline]);
    expect(score.criterionScores[0]).toMatchObject({verificationStatus:"verified",score:0,pass:false});
  });
  it("does not trust missing Browser trace, wrong identity, or duplicate runs",()=>{
    const noPreview={...baseline,trace:baseline.trace.filter(t=>t.stage!=="browser-preview")};
    const badHash={...baseline,artifactHash:"b".repeat(64)};
    for(const run of [noPreview,badHash]){
      expect(criteriaRequiringJudge([criterion],[testCase],[run])).toEqual([criterion]);
      expect(deriveCriterionScores([criterion],[testCase],[],[run]).criterionScores[0]?.pass).toBe(false);
    }
    expect(deriveCriterionScores([criterion],[testCase],[],[baseline,baseline]).criterionScores[0])
      .toMatchObject({verificationStatus:"unverified",pass:false});
  });
});
