import {describe,expect,it} from "vitest";
import {TestCaseSchema,type EvaluationResult} from "@evolution/contracts";
import {learningContextFixture} from "@evolution/testkit";
import {candidateEvidencePendingDecision} from "./experiment-evidence-admission";
import {experimentEvidencePendingOnly} from "./experiment-winner";

function fixture(score=90){
  const p=learningContextFixture().p;
  p.experimentPolicy.winnerGoalScope="all-user-goals-v1";
  p.acceptanceRubric=[{id:"GOAL",title:"Goal",requirement:"improve",source:"user-command",weight:80,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:80,evidenceExpected:[],protectedConstraint:false,artifactIds:[],category:"outcome"},
    {id:"FORMAT",title:"Format",requirement:"preserve",source:"system-integrity",weight:20,hardGate:true,judgeType:"integrity",validationMethod:"format-roundtrip",minScore:90,evidenceExpected:[],protectedConstraint:true,artifactIds:[],category:"integrity"}];
  p.evalSuite=[TestCaseSchema.parse({id:"V1",title:"Goal",input:"check goal",expected:["improve"],criterionIds:["GOAL"]}),TestCaseSchema.parse({id:"V2",title:"Format",input:"check format",expected:["preserve"],criterionIds:["FORMAT"]})];
  const baseline:EvaluationResult={...p.validationRun.evaluation!,criterionScores:[{criterionId:"GOAL",score:95,pass:true,verificationStatus:"verified",testCaseIds:["V1"],evidence:[],gaps:[]},{criterionId:"FORMAT",score:100,pass:true,verificationStatus:"verified",testCaseIds:["V2"],evidence:[],gaps:[]}]};
  const current=structuredClone(baseline);current.criterionScores![0]!.score=score;current.criterionScores![1]!.verificationStatus="partial";
  return {p,baseline,current};
}
describe("paired evidence-only admission",()=>{
  it("rejects the actual class of absolute-pass regression plus missing protection proof",()=>{
    const x=fixture();expect(experimentEvidencePendingOnly(x.current)).toBe(true);
    expect(candidateEvidencePendingDecision(x.p,x.current,x.baseline)).toMatchObject({eligible:false,reason:"verified-user-goal-regression",regressedCriterionIds:["GOAL"]});
  });
  it.each([95,95.5])("rejects complete known gain below one point (%s)",score=>{
    const x=fixture(score);expect(candidateEvidencePendingDecision(x.p,x.current,x.baseline)).toMatchObject({eligible:false,reason:"verified-user-goal-gain-below-threshold"});
  });
  it("keeps a legitimate improving candidate provisional while protection evidence is missing",()=>{
    const x=fixture(97);expect(candidateEvidencePendingDecision(x.p,x.current,x.baseline).eligible).toBe(true);
  });
  it("does not turn an unpaired or unverified comparison into a measured regression",()=>{
    for(const kind of ["unpaired","unverified"]){const x=fixture();if(kind==="unpaired")x.current.criterionScores![0]!.testCaseIds=["other-paper"];else x.current.criterionScores![0]!.verificationStatus="unverified";
      expect(candidateEvidencePendingDecision(x.p,x.current,x.baseline).eligible).toBe(true);}
  });
  it("retains a known regression when another user goal is still pending",()=>{
    const x=fixture();x.p.acceptanceRubric[1]={...x.p.acceptanceRubric[1]!,source:"user-command",protectedConstraint:false};
    expect(candidateEvidencePendingDecision(x.p,x.current,x.baseline)).toMatchObject({eligible:false,regressedCriterionIds:["GOAL"]});
  });
  it("keeps the legacy classifier meaning without silently enabling the opted-in full-goal policy",()=>{
    const x=fixture();x.p.experimentPolicy.winnerGoalScope=undefined;expect(candidateEvidencePendingDecision(x.p,x.current,x.baseline).eligible).toBe(true);
  });
  it("does not relabel a verified absolute failure or Safety failure as missing evidence",()=>{
    for(const kind of ["absolute","safety"]){const x=fixture();if(kind==="absolute")x.current.criterionScores![0]!.pass=false;else x.current.safety="FAIL";
      expect(candidateEvidencePendingDecision(x.p,x.current,x.baseline)).toMatchObject({eligible:false,reason:"not-evidence-only"});}
  });
});
