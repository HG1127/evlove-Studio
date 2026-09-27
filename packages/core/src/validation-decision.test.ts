import { describe, expect, it } from "vitest";
import type { EvaluationResult, EvolveProject } from "@evolution/contracts";
import { validationDecision, validationRegression } from "./validation-decision";

function project():EvolveProject{
  return {
    acceptanceRubric:[
      {id:"GOAL",title:"目标",requirement:"改善",source:"user-command",weight:70,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:80,evidenceExpected:["e"],protectedConstraint:false,artifactIds:[],category:"outcome"},
      {id:"FORMAT",title:"格式",requirement:"保持",source:"system-integrity",weight:30,hardGate:true,judgeType:"integrity",validationMethod:"format-roundtrip",minScore:90,evidenceExpected:["roundtrip"],protectedConstraint:true,artifactIds:[],category:"integrity"},
    ],
  } as unknown as EvolveProject;
}

function evaluation(goal:number,format:number,status:"verified"|"unverified"="verified"):EvaluationResult{
  return {
    accuracy:goal,evidence:goal,riskCoverage:90,completeness:goal,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[],
    rubricScore:Math.round((goal*70+format*30)/100),
    verifiedRubricCoverage:status==="verified"?100:30,
    unverifiedCriterionIds:status==="verified"?[]:["GOAL"],
    criterionScores:[
      {criterionId:"GOAL",score:goal,pass:goal>=80,verificationStatus:status,evidence:[],gaps:[],testCaseIds:["H1"]},
      {criterionId:"FORMAT",score:format,pass:format>=90,verificationStatus:"verified",evidence:[],gaps:[],testCaseIds:["H2"]},
    ],
  };
}

describe("validation decision",()=>{
  it("detects same-paper verified regression",()=>{
    expect(validationRegression(project(),evaluation(75,100),evaluation(85,100))).toBe(true);
  });

  it("keeps missing evidence separate from product failure",()=>{
    const result=validationDecision(project(),evaluation(90,100,"unverified"),evaluation(85,100));
    expect(result.evidenceIncomplete).toBe(true);
    expect(result.hardCriterionFailures).toHaveLength(0);
    expect(result.hardFail).toBe(false);
  });

  it("blocks release when a verified hard gate lacks same-paper baseline proof",()=>{
    const baseline=evaluation(85,100);
    baseline.criterionScores=baseline.criterionScores?.map((item)=>item.criterionId==="GOAL"
      ? {...item,verificationStatus:"unverified" as const,testCaseIds:[]}
      : item);
    baseline.verifiedRubricCoverage=30;
    const result=validationDecision(project(),evaluation(90,100),baseline);
    expect(result.hardFail).toBe(false);
    expect(result.evidenceIncomplete).toBe(true);
    expect(result.comparisonEvidenceGaps.map((item)=>item.id)).toContain("GOAL");
  });

  it("blocks a verified hard gate failure",()=>{
    const result=validationDecision(project(),evaluation(90,70),evaluation(85,100));
    expect(result.hardFail).toBe(true);
    expect(result.hardCriterionFailures.map((item)=>item.id)).toContain("FORMAT");
  });

  it("treats duplicate candidate hard-gate scores as missing evidence in either row order",()=>{
    for (const scores of [
      [{score:0,pass:false},{score:100,pass:true}],
      [{score:100,pass:true},{score:0,pass:false}],
    ]) {
      const candidate=evaluation(90,100);
      const original=candidate.criterionScores![0]!;
      candidate.criterionScores=[...candidate.criterionScores!,...scores.map((score)=>({...original,...score}))];
      const result=validationDecision(project(),candidate,evaluation(85,100));
      expect(result.unverifiedHardCriteria.map((item)=>item.id)).toContain("GOAL");
      expect(result.evidenceIncomplete).toBe(true);
      expect(result.hardCriterionFailures.map((item)=>item.id)).not.toContain("GOAL");
      expect(result.regression).toBe(false);
    }
  });

  it("does not treat a duplicate baseline score as same-paper comparison evidence",()=>{
    const baseline=evaluation(85,100);
    baseline.criterionScores!.push({...baseline.criterionScores![0]!,score:10});
    const result=validationDecision(project(),evaluation(90,100),baseline);
    expect(result.comparisonEvidenceGaps.map((item)=>item.id)).toContain("GOAL");
    expect(result.evidenceIncomplete).toBe(true);
  });
});

it("does not release when a soft criterion is missing despite reported full coverage", () => {
  const scoped = project();
  scoped.acceptanceRubric.push({
    ...scoped.acceptanceRubric[0]!, id: "USABILITY", title: "可用性", hardGate: false, weight: 10,
  });
  const candidate = evaluation(90, 100);
  candidate.verifiedRubricCoverage = 100;
  candidate.rubricScore = 95;
  const decision = validationDecision(scoped, candidate, evaluation(85, 100));
  expect(decision.unverifiedHardCriteria).toEqual([]);
  expect(decision.unverifiedCriteria.map((item) => item.id)).toContain("USABILITY");
  expect(decision.rubricCoverage).toBeLessThan(100);
  expect(decision.evidenceIncomplete).toBe(true);
  expect(decision.hardFail).toBe(false);
});

it("treats duplicate soft scores as missing proof even when coverage rounds to 100", () => {
  const scoped = project();
  scoped.acceptanceRubric.push({
    ...scoped.acceptanceRubric[0]!, id: "USABILITY", title: "可用性", hardGate: false, weight: 0,
  });
  const candidate = evaluation(90, 100);
  const soft = { ...candidate.criterionScores![0]!, criterionId: "USABILITY" };
  candidate.criterionScores!.push(soft, { ...soft });
  candidate.verifiedRubricCoverage = 100;
  const decision = validationDecision(scoped, candidate, evaluation(85, 100));
  expect(decision.unverifiedCriteria.map((item) => item.id)).toContain("USABILITY");
  expect(decision.evidenceIncomplete).toBe(true);
});
