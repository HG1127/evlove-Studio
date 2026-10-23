import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion, EvaluationResult, TestCase, ValidationRun } from "@evolution/contracts";
import { hasAuthoritativeHiddenRelease, hasFullHiddenMeasurement } from "./hidden-validation-evidence";

const suite=[{id:"H1"}] as TestCase[];
const run={testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const};
const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",
  averageCost:1,averageLatencyMs:1,notes:[],failures:[]} as EvaluationResult;
function validation(overrides:Partial<ValidationRun>={}):ValidationRun{
  return {id:"holdout",status:"completed",validationMode:"full",candidateId:"C1",
    recommendation:"release",evaluation,runs:[run],baselineRuns:[run],baselineEvaluation:evaluation,baselineSuiteIds:["H1"],baselineContextFingerprint:"same-paper",baselineObservedAt:123456,checks:[],...overrides};
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
  it.each([
    ["missing baseline evaluation",{baselineEvaluation:undefined}],
    ["demo baseline evaluation",{baselineEvaluation:{...evaluation,demoJudged:true}}],
    ["missing baseline run",{baselineRuns:[]}],
    ["wrong baseline run",{baselineRuns:[{...run,testCaseId:"H2"}]}],
    ["duplicate baseline run",{baselineRuns:[run,run]}],
    ["partial baseline run",{baselineRuns:[{...run,verificationStatus:"partial" as const}]}],
    ["missing paper identity",{baselineSuiteIds:undefined}],
    ["wrong paper identity",{baselineSuiteIds:["H2"]}],
    ["missing baseline context",{baselineContextFingerprint:undefined}],
    ["missing observation time",{baselineObservedAt:undefined}],
  ])("rejects %s as an authoritative release",(_label,override)=>{
    const measured=validation(override);
    expect(hasFullHiddenMeasurement(measured,"C1",suite)).toBe(true);
    expect(hasAuthoritativeHiddenRelease(measured,"C1",suite)).toBe(false);
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
  it("does not demand an impossible baseline comparison before the Candidate exists",()=>{
    const content={...suite[0]!,criterionIds:["CONTENT"]};
    const pairwise={...suite[0]!,id:"H2",criterionIds:["SYS-PAIRWISE"]};
    const hidden=[content,pairwise];
    const pairBaseline={...run,testCaseId:"H2",verificationStatus:"unverified" as const};
    const pairCandidate={...run,testCaseId:"H2"};
    const measured=validation({
      baselineRuns:[run,pairBaseline],runs:[run,pairCandidate],
      baselineSuiteIds:["H1","H2"],plannedCases:2,executedCases:2,
    });
    expect(hasAuthoritativeHiddenRelease(measured,"C1",hidden)).toBe(true);
    expect(hasAuthoritativeHiddenRelease({...measured,runs:[run,pairBaseline]},"C1",hidden)).toBe(false);
    expect(hasAuthoritativeHiddenRelease({...measured,baselineRuns:[pairBaseline]},"C1",hidden)).toBe(false);
    expect(hasAuthoritativeHiddenRelease({...measured,baselineRuns:[{...run,verificationStatus:"unverified"},pairBaseline]},"C1",hidden)).toBe(false);
    expect(hasAuthoritativeHiddenRelease({...measured,baselineRuns:[run,pairBaseline,pairBaseline]},"C1",hidden)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(measured,"C1",[{...content,criterionIds:["CONTENT","SYS-PAIRWISE"]},pairwise])).toBe(true);
    expect(hasAuthoritativeHiddenRelease(measured,"C1",[content,{...pairwise,criterionIds:["CONTENT","SYS-PAIRWISE"]}])).toBe(false);
    const onlyPair=validation({baselineRuns:[pairBaseline],runs:[pairCandidate],baselineSuiteIds:["H2"],plannedCases:1,executedCases:1});
    expect(hasAuthoritativeHiddenRelease(onlyPair,"C1",[pairwise])).toBe(false);
  });
  it("allows a genuine newly proved SOFT capability to have an UNKNOWN original only when independent hard Pairwise passes",()=>{
    const paper=[
      {...suite[0]!,id:"H-HARD",criterionIds:["CONTENT"]},
      {...suite[0]!,id:"H-PAIR",criterionIds:["SYS-PAIRWISE"]},
      {...suite[0]!,id:"H-SOFT",criterionIds:["SOFT-NEW"]},
    ];
    const rubric=[
      {id:"CONTENT",hardGate:true,minScore:85},
      {id:"SYS-PAIRWISE",hardGate:true,minScore:85},
      {id:"SOFT-NEW",hardGate:false,minScore:65},
    ] as AcceptanceCriterion[];
    const rows=[
      {criterionId:"CONTENT",score:92,pass:true,verificationStatus:"verified" as const,
        evidence:["original and Candidate current state"],gaps:[],testCaseIds:["H-HARD"]},
      {criterionId:"SYS-PAIRWISE",score:95,pass:true,verificationStatus:"verified" as const,
        evidence:["exact Original vs Candidate"],gaps:[],testCaseIds:["H-PAIR"]},
      {criterionId:"SOFT-NEW",score:70,pass:true,verificationStatus:"verified" as const,
        evidence:["new operational rules observed"],gaps:[],testCaseIds:["H-SOFT"]},
    ];
    const real=validation({
      runs:paper.map(t=>({...run,testCaseId:t.id})),
      baselineRuns:[
        {...run,testCaseId:"H-HARD"},
        {...run,testCaseId:"H-PAIR",verificationStatus:"unverified"},
        {...run,testCaseId:"H-SOFT",verificationStatus:"unverified"},
      ],
      baselineSuiteIds:paper.map(t=>t.id),plannedCases:3,executedCases:3,
      evaluation:{...evaluation,criterionScores:rows,unverifiedCriterionIds:[]},
      baselineEvaluation:{...evaluation,criterionScores:[rows[0]!],
        unverifiedCriterionIds:["SYS-PAIRWISE","SOFT-NEW"]},
    });
    expect(hasAuthoritativeHiddenRelease(real,"C1",paper)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(real,"C1",paper,rubric)).toBe(true);
    const mutate=(changes:Partial<ValidationRun>)=>({...real,...changes});
    expect(hasAuthoritativeHiddenRelease(mutate({
      runs:real.runs.map(r=>r.testCaseId==="H-SOFT"?{...r,verificationStatus:"unverified" as const}:r),
    }),"C1",paper,rubric)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(mutate({
      baselineRuns:real.baselineRuns.map(r=>r.testCaseId==="H-HARD"?{...r,verificationStatus:"unverified" as const}:r),
    }),"C1",paper,rubric)).toBe(false);
    for(const status of ["partial","failed"] as const){
      const bad=mutate({baselineRuns:real.baselineRuns.map(r=>r.testCaseId==="H-SOFT"?{...r,verificationStatus:status}:r)});
      expect(hasAuthoritativeHiddenRelease(bad,"C1",paper,rubric)).toBe(false);
    }
    expect(hasAuthoritativeHiddenRelease(real,"C1",paper,
      rubric.filter(c=>c.id!=="SYS-PAIRWISE"))).toBe(false);
    expect(hasAuthoritativeHiddenRelease(real,"C1",paper,
      rubric.map(c=>c.id==="SOFT-NEW"?{...c,hardGate:true}:c))).toBe(false);
    const missingProof=mutate({evaluation:{...real.evaluation!,criterionScores:rows.map(c=>
      c.criterionId==="SOFT-NEW"?{...c,verificationStatus:"unverified" as const}:c)}});
    expect(hasAuthoritativeHiddenRelease(missingProof,"C1",paper,rubric)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(real,"C1",[
      ...paper.slice(0,2),{...paper[2]!,criterionIds:["SOFT-NEW","CONTENT"]},
    ],rubric)).toBe(false);
  });
  it("rejects declared unverified criteria and failed safety",()=>{
    expect(hasAuthoritativeHiddenRelease(validation({evaluation:{...evaluation,unverifiedCriterionIds:["C"]}}),"C1",suite)).toBe(false);
    expect(hasAuthoritativeHiddenRelease(validation({evaluation:{...evaluation,safety:"FAIL"}}),"C1",suite)).toBe(false);
  });
});
