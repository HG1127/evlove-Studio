import { describe, expect, it } from "vitest";
import type { Candidate, EvaluationResult, EvolveProject } from "@evolution/contracts";
import { candidateWinnerDecision, experimentEvidencePendingOnly } from "./experiment-winner";

function project():EvolveProject{
  return {
    acceptanceRubric:[
      {id:"GOAL",title:"目标",requirement:"改善",source:"user-command",weight:70,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:80,evidenceExpected:["e"],protectedConstraint:false,artifactIds:[],category:"outcome"},
      {id:"FORMAT",title:"格式",requirement:"保持",source:"system-integrity",weight:30,hardGate:true,judgeType:"integrity",validationMethod:"format-roundtrip",minScore:90,evidenceExpected:["roundtrip"],protectedConstraint:true,artifactIds:[],category:"integrity"},
    ],
  } as unknown as EvolveProject;
}

function evaluation(goal:number,format:number,status:"verified"|"partial"|"unverified"="verified"):EvaluationResult{
  return {
    accuracy:goal,evidence:goal,riskCoverage:90,completeness:goal,safety:"PASS",averageCost:0,averageLatencyMs:10,notes:[],failures:[],
    rubricScore:Math.round((goal*70+format*30)/100),
    verifiedRubricCoverage:status==="verified"?100:30,
    unverifiedCriterionIds:status==="verified"?[]:["GOAL"],
    criterionScores:[
      {criterionId:"GOAL",score:goal,pass:goal>=80,verificationStatus:status,evidence:[],gaps:[],testCaseIds:["V1"]},
      {criterionId:"FORMAT",score:format,pass:format>=90,verificationStatus:"verified",evidence:[],gaps:[],testCaseIds:["V2"]},
    ],
  };
}

describe("experiment winner decision",()=>{
  it("requires paired measured improvement",()=>{
    const candidate={id:"C",name:"C",change:"x",patches:[],addressesAdvice:[],riskLevel:"low",risks:[],accuracy:0,evidence:0,riskCoverage:0,costDelta:0,speedDelta:0,safety:"REVIEW",recommended:true,status:"draft",notes:[],artifactSnapshots:[],artifactBuildStatus:"idle",designRationale:{sourceEvidence:["x"],commandAlignment:"x",mechanism:"x",coveredCriteria:["GOAL"],protectedCompliance:"keep",falsifier:"no gain"}} as Candidate;
    const result=candidateWinnerDecision(project(),evaluation(88,100),evaluation(82,100),candidate);
    expect(result.eligible).toBe(true);
    expect(result.targetDelta).toBe(6);
  });

  it("does not promote a challenger that loses an already verified protected gate",()=>{
    const result=candidateWinnerDecision(project(),evaluation(95,80),evaluation(82,100));
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("FORMAT");
  });

  it("distinguishes evidence pending from verified product failure",()=>{
    expect(experimentEvidencePendingOnly(evaluation(90,100,"unverified"))).toBe(true);
    expect(experimentEvidencePendingOnly(evaluation(60,100,"verified"))).toBe(false);
  });
});
