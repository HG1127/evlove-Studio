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
    hiddenEvalSuite:[{id:"H1"},{id:"H2"}],metrics:[],goal:"g",evolutionCommand:"e",protectedItems:[],
  } as unknown as EvolveProject;
  const frozen={sourceArtifactId:"source",snapshotHash:"hash",blobId:"blob",name:"a.md",mimeType:"text/markdown",sha256:"sha",size:3,verifiedAt:"2026-09-20T00:00:00Z",checks:["ok"],limitations:[]};
  const candidate={id:"C1",name:"c",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.md",mimeType:"text/markdown",content:"new",contentHash:"hash",buildMode:"ai-full",notes:[],createdAt:"2026-09-20T00:00:00Z",frozenArtifact:frozen}],artifactBuildStatus:"ready"} as unknown as Candidate;
  const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[],rubricScore:91,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[
    {criterionId:"CONTENT",score:90,pass:true,verificationStatus:"verified",evidence:["hidden"],gaps:[],testCaseIds:["H1"]},
    {criterionId:"FORMAT",score:100,pass:true,verificationStatus:"verified",evidence:["roundtrip"],gaps:[],testCaseIds:["H2"]},
  ]};
  const validation={id:"v",status:"completed",validationMode:"full",candidateId:"C1",recommendation:"release",evaluation,runs:[{testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"},{testCaseId:"H2",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],baselineRuns:[{testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"},{testCaseId:"H2",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],baselineEvaluation:evaluation,baselineSuiteIds:["H1","H2"],baselineContextFingerprint:"same-paper",baselineObservedAt:123456,checks:[],evidenceFingerprint:evidenceFingerprint(project,candidate)} as ValidationRun;
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
  it("accepts an exact frozen Candidate with a verified SYS-PAIRWISE result and truthful unverified Original comparison",()=>{
    const x=fixture();
    x.project.acceptanceRubric.push({
      ...x.project.acceptanceRubric[0]!,id:"SYS-PAIRWISE",title:"相对原版真实改进",
      source:"system-integrity",weight:10,hardGate:true,minScore:85,
      judgeType:"pairwise",validationMethod:"semantic-judge",
    });
    x.project.hiddenEvalSuite.push({
      ...x.project.hiddenEvalSuite[0]!,id:"H-PAIRWISE",criterionIds:["SYS-PAIRWISE"],
    });
    x.validation.runs.push({
      testCaseId:"H-PAIRWISE",output:"EXACT Original-vs-Candidate comparison",
      latencyMs:1,cost:0,trace:[],verificationStatus:"verified",
    });
    x.validation.baselineRuns.push({
      testCaseId:"H-PAIRWISE",output:"UNVERIFIED: no Candidate exists at baseline time",
      latencyMs:0,cost:0,trace:[],verificationStatus:"unverified",
    });
    x.validation.baselineSuiteIds!.push("H-PAIRWISE");
    x.validation.evaluation!.criterionScores!.push({
      criterionId:"SYS-PAIRWISE",score:96,pass:true,verificationStatus:"verified",
      evidence:["exact-side-by-side"],gaps:[],testCaseIds:["H-PAIRWISE"],
    });
    x.validation.baselineEvaluation={...x.validation.baselineEvaluation!,
      criterionScores:x.validation.baselineEvaluation!.criterionScores!.filter((row)=>row.criterionId!=="SYS-PAIRWISE"),
    };
    // Changing the rubric changes the exact evidence contract and its fingerprint.
    x.validation.evidenceFingerprint=evidenceFingerprint(x.project,x.candidate);
    const accepted=settleArtifactAcceptanceFromValidation({
      project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen],
    });
    expect(accepted.status).toBe("passed");
    expect(accepted.hardGatePass).toBe(true);
    expect(accepted.pairwiseScore).toBe(96);
    const unverified={...x.validation,runs:x.validation.runs.map((r)=>r.testCaseId==="H-PAIRWISE"
      ?{...r,verificationStatus:"unverified" as const}:r)};
    expect(settleArtifactAcceptanceFromValidation({
      project:x.project,candidate:x.candidate,validation:unverified,frozenArtifacts:[x.frozen],
    }).status).toBe("unverified");
  });
  it("passes Gate F on real Candidate soft proof when Original soft observation is UNKNOWN but hard same-paper evidence is verified",()=>{
    const x=fixture();
    x.project.acceptanceRubric.push({
      ...x.project.acceptanceRubric[0]!,id:"SYS-PAIRWISE",title:"相对原版真实改进",
      source:"system-integrity",weight:8,hardGate:true,minScore:85,
      judgeType:"pairwise",validationMethod:"semantic-judge",
    });
    x.project.acceptanceRubric.push({
      ...x.project.acceptanceRubric[0]!,id:"SOFT-NEW",title:"新增可操作性",
      source:"source-understanding",weight:7,hardGate:false,minScore:65,
      judgeType:"llm",validationMethod:"semantic-judge",
    });
    for(const [id,criterionId,score] of [["H-PAIR","SYS-PAIRWISE",96],["H-SOFT","SOFT-NEW",94]] as const){
      x.project.hiddenEvalSuite.push({...x.project.hiddenEvalSuite[0]!,id,criterionIds:[criterionId]});
      x.validation.runs.push({testCaseId:id,output:"frozen Candidate observed",
        latencyMs:1,cost:0,trace:[],verificationStatus:"verified"});
      x.validation.baselineRuns.push({testCaseId:id,output:"original capability not observed",
        latencyMs:1,cost:0,trace:[],verificationStatus:"unverified"});
      x.validation.baselineSuiteIds!.push(id);
      x.validation.evaluation!.criterionScores!.push({
        criterionId,score,pass:true,verificationStatus:"verified",
        evidence:["candidate current snapshot"],gaps:[],testCaseIds:[id],
      });
    }
    x.validation.evaluation!.unverifiedCriterionIds=[];
    x.validation.evidenceFingerprint=evidenceFingerprint(x.project,x.candidate);
    const accepted=settleArtifactAcceptanceFromValidation({
      project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen],
    });
    expect(accepted).toMatchObject({status:"passed",hardGatePass:true,pairwiseScore:96});
    expect(accepted.acceptedAt).toBeDefined();
    // The original's soft evidence is still unverified in the immutable receipt.
    expect(x.validation.baselineRuns.find(r=>r.testCaseId==="H-SOFT")?.verificationStatus).toBe("unverified");
    const unavailable={...x.validation,evaluation:{...x.validation.evaluation!,
      criterionScores:x.validation.evaluation!.criterionScores!.filter(r=>r.criterionId!=="SYS-PAIRWISE")}};
    expect(settleArtifactAcceptanceFromValidation({
      project:x.project,candidate:x.candidate,validation:unavailable,frozenArtifacts:[x.frozen],
    }).status).toBe("unverified");
  });
  it("keeps a missing same-paper baseline unverified rather than calling the product failed",()=>{
    const x=fixture();
    x.validation.baselineRuns=[];
    const result=settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen]});
    expect(result.status).toBe("unverified");
    expect(result.acceptedAt).toBeUndefined();
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
  it("never substitutes an initial Original reference for missing Candidate preservation acceptance",()=>{
    const x=fixture();
    x.project.id="mission";
    x.project.baselineRun={id:"initial",status:"completed",suiteName:"Core",totalCases:0,runs:[],
      originalReferences:[{schemaVersion:"original-artifact-reference-v1",missionId:"mission",sourceArtifactId:"source",
        blobId:"original",sha256:"a".repeat(64),sizeBytes:100}],referenceOnlyCriterionIds:["FORMAT"]};
    x.validation.evaluation!.criterionScores![1]={...x.validation.evaluation!.criterionScores![1]!,verificationStatus:"unverified"};
    x.validation.evaluation!.unverifiedCriterionIds=["FORMAT"];
    const result=settleArtifactAcceptanceFromValidation({project:x.project,candidate:x.candidate,validation:x.validation,frozenArtifacts:[x.frozen]});
    expect(result).toMatchObject({status:"unverified",hardGatePass:false});
    expect(result.acceptedAt).toBeUndefined();
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
