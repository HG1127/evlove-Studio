import {describe,expect,it} from "vitest";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import {evidenceFingerprint} from "@evolution/core";
import {runServerArtifactAcceptance} from "./server-artifact-acceptance";

function fixture(score=92,verified=true){
  const x=reviewedHoldoutFixture(),p=x.project;
  const evaluation={...p.experimentRun.candidateResults[0]!.evaluation,safety:"PASS" as const,rubricScore:score,criterionScores:[
    {criterionId:"CONTENT",score,pass:score>=92,verificationStatus:verified?"verified" as const:"partial" as const,
      evidence:["synthetic same-paper execution"],gaps:score<92?["92 required"]:[],testCaseIds:["H1"]},
  ],unverifiedCriterionIds:verified?[]:["CONTENT"]};
  const runs=[{testCaseId:"H1",output:"synthetic exact frozen execution",latencyMs:1,cost:0,verificationStatus:"verified" as const,trace:[]}];
  p.validationRun={id:"validation-server-r1",status:"completed",candidateId:x.current.id,validationMode:"full",
    runs,baselineRuns:runs,baselineSuiteIds:["H1"],baselineContextFingerprint:"synthetic",baselineObservedAt:Date.now(),
    evaluation,baselineEvaluation:{...evaluation,rubricScore:76},recommendation:"release",checks:[],
    evidenceFingerprint:evidenceFingerprint(p,x.current)};
  p.campaign={...p.campaign,status:"running",checkpoint:{...p.campaign.checkpoint!,completedPhase:"validation"}};
  return {...x,verifyFrozenArtifacts:async()=>({verified:[x.current.artifactSnapshots[0]!.frozenArtifact!],failed:[],unavailable:[]})};
}
describe("same-Candidate Gate F keeps all existing acceptance gates",()=>{
  it("accepts only authoritative exact frozen evidence while keeping Original REVIEW",async()=>{
    const x=fixture(),original=structuredClone(x.project.baselineRun);
    const outcome=await runServerArtifactAcceptance(x.project,{verifyFrozenArtifacts:x.verifyFrozenArtifacts});
    expect(outcome.accepted).toBe(true);expect(outcome.project.baselineRun).toEqual(original);
    expect(outcome.project.artifactAcceptance.frozenArtifacts?.[0]?.sha256).toBe(x.current.artifactSnapshots[0]!.frozenArtifact!.sha256);
  });
  it.each([91,89,0])("does not waive the 92 criterion at %s or repair to another Candidate",async score=>{
    const x=fixture(score),ids=x.project.candidates.map(c=>c.id);
    const outcome=await runServerArtifactAcceptance(x.project,{verifyFrozenArtifacts:x.verifyFrozenArtifacts});
    expect(outcome.accepted).toBe(false);expect(outcome.repaired).toBe(false);expect(outcome.project.candidates.map(c=>c.id)).toEqual(ids);
    expect(outcome.control).toBe("stop");expect(outcome.reason).toContain("同一冻结文件");
  });
  it("cannot promote PARTIAL protected/criterion evidence to passed",async()=>{
    const x=fixture(100,false);x.project.acceptanceRubric[0]!.protectedConstraint=true;
    // Rebind the exact new contract; this is a separate synthetic test, not an approval replay.
    x.project.validationRun.evidenceFingerprint=evidenceFingerprint(x.project,x.current);
    const outcome=await runServerArtifactAcceptance(x.project,{verifyFrozenArtifacts:x.verifyFrozenArtifacts});
    expect(outcome.accepted).toBe(false);expect(outcome.project.artifactAcceptance.status).toBe("unverified");
  });
  it("rejects a Current paper with a missing or unverified case",async()=>{
    const x=fixture();x.project.validationRun.baselineRuns=[];
    const outcome=await runServerArtifactAcceptance(x.project,{verifyFrozenArtifacts:x.verifyFrozenArtifacts});
    expect(outcome.accepted).toBe(false);
  });
});
