import {describe,expect,it} from "vitest";
import type {Candidate,EvolveProject,ValidationRun} from "@evolution/contracts";
import {evidenceFingerprint,settleArtifactAcceptanceFromValidation,verifiedValidationFailures} from "./index";

function fixture(){
  const project={
    sourceArtifacts:[{id:"source",role:"target"}],
    acceptanceRubric:[
      {id:"CONTENT",title:"内容",requirement:"通过",weight:90,hardGate:true,minScore:80,validationMethod:"semantic-judge",artifactIds:[],protectedConstraint:false},
      {id:"FORMAT",title:"格式",requirement:"保持",weight:10,hardGate:true,minScore:90,validationMethod:"format-roundtrip",artifactIds:["source"],protectedConstraint:true},
    ],
    artifactAcceptance:{attempts:0,maxRepairAttempts:3},
    hiddenEvalSuite:[],metrics:[],goal:"g",evolutionCommand:"e",protectedItems:[],
  } as unknown as EvolveProject;
  const frozen={sourceArtifactId:"source",snapshotHash:"hash",blobId:"blob",name:"a.md",mimeType:"text/markdown",sha256:"sha",size:3,verifiedAt:"2026-09-20T00:00:00Z",checks:["ok"],limitations:[]};
  const candidate={id:"C1",name:"c",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.md",mimeType:"text/markdown",content:"new",contentHash:"hash",buildMode:"ai-full",notes:[],createdAt:"2026-09-20T00:00:00Z",frozenArtifact:frozen}],artifactBuildStatus:"ready"} as unknown as Candidate;
  const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[],rubricScore:91,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[
    {criterionId:"CONTENT",score:90,pass:true,verificationStatus:"verified",evidence:["hidden"],gaps:[],testCaseIds:["H1"]},
    {criterionId:"FORMAT",score:100,pass:true,verificationStatus:"verified",evidence:["roundtrip"],gaps:[],testCaseIds:["H2"]},
  ]};
  const validation={id:"v",status:"completed",candidateId:"C1",recommendation:"release",evaluation,runs:[],baselineRuns:[],checks:[],evidenceFingerprint:evidenceFingerprint(project,candidate)} as ValidationRun;
  return {project,candidate,validation,frozen};
}

describe("artifact acceptance settlement",()=>{
  it("passes only the exact Hidden-validated frozen Candidate",()=>{
    const x=fixture();
    const result=settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen]});
    expect(result.status).toBe("passed");
    expect(result.hardGatePass).toBe(true);
    expect(result.frozenArtifacts?.[0]?.blobId).toBe("blob");
  });
  it("keeps missing evidence unverified instead of failed",()=>{
    const x=fixture();
    x.validation.evaluation!.criterionScores![0]={...x.validation.evaluation!.criterionScores![0]!,verificationStatus:"unverified"};
    x.validation.evaluation!.unverifiedCriterionIds=["CONTENT"];
    const result=settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen]});
    expect(result.status).toBe("unverified");
    expect(verifiedValidationFailures(x.project,x.validation)).toHaveLength(0);
  });
  it("does not turn frozen storage integrity into missing rubric proof",()=>{
    const x=fixture();
    x.validation.evaluation!.criterionScores![1]={...x.validation.evaluation!.criterionScores![1]!,verificationStatus:"unverified"};
    x.validation.evaluation!.unverifiedCriterionIds=["FORMAT"];
    const result=settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen]});
    expect(result.status).toBe("unverified");
    expect(result.results.find((item)=>item.criterionId==="FORMAT")?.pass).toBe(false);
  });
  it("returns verified failures for targeted repair",()=>{
    const x=fixture();
    x.validation.recommendation="hold";
    x.validation.evaluation!.criterionScores![0]={...x.validation.evaluation!.criterionScores![0]!,score:50,pass:false};
    expect(verifiedValidationFailures(x.project,x.validation).map((item)=>item.id)).toEqual(["CONTENT"]);
  });
});
