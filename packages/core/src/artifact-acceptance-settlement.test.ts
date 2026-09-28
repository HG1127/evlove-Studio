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
  const validation={id:"v",status:"completed",validationMode:"full",candidateId:"C1",recommendation:"release",evaluation,runs:[],baselineRuns:[],checks:[],evidenceFingerprint:evidenceFingerprint(project,candidate)} as ValidationRun;
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
  it("does not pass Gate F when a release recommendation has no full evaluation",()=>{
    const x=fixture();
    x.validation.evaluation=undefined;
    expect(settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen]}).status).toBe("unverified");
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
  it("keeps duplicate verified Validation scores unverified regardless of row order",()=>{
    for (const scores of [
      [{criterionId:"CONTENT",score:10,pass:false},{criterionId:"CONTENT",score:100,pass:true}],
      [{criterionId:"CONTENT",score:100,pass:true},{criterionId:"CONTENT",score:10,pass:false}],
    ]) {
      const x=fixture();
      const original=x.validation.evaluation!.criterionScores![0]!;
      x.validation.evaluation!.criterionScores!.push(...scores.map((score)=>({...original,...score})));
      const result=settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen]});
      expect(result.status).toBe("unverified");
      expect(result.hardGatePass).toBe(false);
      expect(result.results.find((item)=>item.criterionId==="CONTENT")?.gaps[0]).toContain("重复");
      expect(result.results.find((item)=>item.criterionId==="FORMAT")?.pass).toBe(true);
      expect(verifiedValidationFailures(x.project,x.validation)).toHaveLength(0);
    }
  });
  it("rejects duplicate or unrelated frozen receipt identities",()=>{
    for(const extra of [
      (x:ReturnType<typeof fixture>)=>({...x.frozen}),
      (x:ReturnType<typeof fixture>)=>({...x.frozen,sourceArtifactId:"unrelated"}),
    ]){
      const x=fixture();
      const result=settleArtifactAcceptanceFromValidation({
        project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen,extra(x)],
      });
      expect(result.status).toBe("unverified");
      expect(result.frozenArtifacts).toBeUndefined();
    }
  });
  it("rejects duplicate and unrelated Candidate Snapshot identities",()=>{
    for(const sourceArtifactId of ["source","unrelated"]){
      const x=fixture();
      x.candidate.artifactSnapshots.push({...x.candidate.artifactSnapshots[0]!,id:"extra",sourceArtifactId});
      x.validation.evidenceFingerprint=evidenceFingerprint(x.project,x.candidate);
      const result=settleArtifactAcceptanceFromValidation({
        project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen],
      });
      expect(result.status).toBe("unverified");
      expect(result.frozenArtifacts).toBeUndefined();
    }
  });
  it("rejects a receipt bound to another source even when blob and hash match",()=>{
    const x=fixture();
    x.candidate.artifactSnapshots[0]!.frozenArtifact={...x.frozen,sourceArtifactId:"unrelated"};
    x.validation.evidenceFingerprint=evidenceFingerprint(x.project,x.candidate);
    const result=settleArtifactAcceptanceFromValidation({
      project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen],
    });
    expect(result.status).toBe("unverified");
    expect(result.frozenArtifacts).toBeUndefined();
  });
  it("accepts two exact targets with frozen receipts in either order",()=>{
    const x=fixture();
    const second={...x.frozen,sourceArtifactId:"second",blobId:"blob2",sha256:"sha2",snapshotHash:"hash2"};
    x.project.sourceArtifacts.push({...x.project.sourceArtifacts[0]!,id:"second"});
    x.candidate.artifactSnapshots.push({...x.candidate.artifactSnapshots[0]!,id:"snap2",sourceArtifactId:"second",contentHash:"hash2",frozenArtifact:second});
    x.validation.evidenceFingerprint=evidenceFingerprint(x.project,x.candidate);
    for(const frozenArtifacts of [[x.frozen,second],[second,x.frozen]]){
      const result=settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts});
      expect(result.status).toBe("passed");
      expect(result.frozenArtifacts).toHaveLength(2);
    }
  });
});
