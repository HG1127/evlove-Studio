import { beforeEach, describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { CandidateSchema, type EvolveProject } from "../schemas";
import { assertDeliverablePackageIdentity, evidenceFingerprint, materializeAcceptedCandidatePackage } from "@evolution/core";
import { acceptMissionOutputs, isMissionUserAccepted, missionArtifactFingerprint } from "./mission-review-store";
import { getLocalProject } from "./local-store";

function projectWithOutput(content="v1"): EvolveProject {
  const project={...structuredClone(demoProject),id:"mission-review-test"} as EvolveProject;
  const frozen={sourceArtifactId:"demo-prompt",snapshotHash:`hash-${content}`,blobId:`blob-${content}`,
    name:"result.md",mimeType:"text/markdown",sha256:"a".repeat(64),size:content.length,
    verifiedAt:"2026-09-17T00:00:00.000Z",checks:["roundtrip"],limitations:[]};
  const candidate=CandidateSchema.parse({id:"C1",name:"accepted",change:"edit",artifactSnapshots:[{
    id:"snapshot-C1",sourceArtifactId:"demo-prompt",name:"result.md",mimeType:"text/markdown",
    content,contentHash:frozen.snapshotHash,frozenArtifact:frozen,createdAt:"2026-09-17T00:00:00.000Z",
  }]});
  project.candidates=[candidate];
  project.experimentRun={...project.experimentRun,winnerId:candidate.id};
  const binding=evidenceFingerprint(project,candidate);
  project.validationRun={...project.validationRun,status:"completed",validationMode:"full",candidateId:candidate.id,
    recommendation:"release",evaluation:project.baselineRun.result,evidenceFingerprint:binding,
    runs:project.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"})),
    baselineRuns:project.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"})),
    baselineEvaluation:project.baselineRun.result,baselineSuiteIds:project.hiddenEvalSuite.map((testCase)=>testCase.id),
    baselineContextFingerprint:"same-paper",baselineObservedAt:123456};
  project.artifactAcceptance={...project.artifactAcceptance,status:"passed",hardGatePass:true,
    candidateId:candidate.id,frozenArtifacts:[frozen],evidenceFingerprint:binding};
  project.outputArtifacts=materializeAcceptedCandidatePackage(project,candidate,project.artifactAcceptance);
  expect(project.sourceArtifacts.find((item)=>item.id==="demo-prompt")).toMatchObject({
    name:"research-agent-system-prompt.md",extension:"md",mimeType:"text/markdown",
  });
  // Establish valid exact package identity before tests mutate metadata, receipts, or content.
  expect(assertDeliverablePackageIdentity(project)).toBe(candidate.id);
  return project;
}

describe("mission user review",()=>{
  beforeEach(()=>localStorage.clear());
  it("separates machine acceptance from user acceptance",()=>{
    const project=projectWithOutput();
    expect(isMissionUserAccepted(project)).toBe(false);
    acceptMissionOutputs(project);
    const persisted = getLocalProject(project.id)!;
    expect(persisted.userAcceptance?.fingerprint).toBe(missionArtifactFingerprint(project));
    expect(isMissionUserAccepted(persisted)).toBe(true);
  });
  it("rejects a jointly wrong text format before human acceptance even with rebound evidence",()=>{
    const project=projectWithOutput();
    const persistedBefore=structuredClone(getLocalProject(project.id));
    const candidate=project.candidates[0]!,snapshot=candidate.artifactSnapshots[0]!;
    const receipt=project.artifactAcceptance.frozenArtifacts![0]!;
    snapshot.name=receipt.name="result.txt";
    snapshot.mimeType=receipt.mimeType="text/plain";
    Object.assign(snapshot.frozenArtifact!,{name:snapshot.name,mimeType:snapshot.mimeType});
    const primary=project.outputArtifacts.find((item)=>item.kind==="primary")!;
    primary.name=snapshot.name;primary.mimeType=snapshot.mimeType;
    Object.assign(primary.frozenArtifact!,{name:snapshot.name,mimeType:snapshot.mimeType});
    const binding=evidenceFingerprint(project,candidate);
    project.validationRun.evidenceFingerprint=binding;
    project.artifactAcceptance.evidenceFingerprint=binding;
    expect(snapshot.content).toBe("v1");
    expect(primary.content).toBe(snapshot.content);
    expect(()=>materializeAcceptedCandidatePackage(project,candidate,project.artifactAcceptance)).toThrow(/冻结身份尚未一致/);
    expect(()=>acceptMissionOutputs(project)).toThrow(/Gate F 冻结证据/);
    expect(isMissionUserAccepted(project)).toBe(false);
    expect(getLocalProject(project.id)).toEqual(persistedBefore);
  });
  it("rejects a mixed Candidate package before human acceptance",()=>{
    const project=projectWithOutput();
    const manifest=project.outputArtifacts.find((item)=>item.kind==="manifest")!;
    manifest.candidateId="old";
    expect(()=>acceptMissionOutputs(project)).toThrow(/候选身份不一致/);
    expect(isMissionUserAccepted(project)).toBe(false);
  });
  it("invalidates the human review when package metadata or frozen receipt changes",()=>{
    const project=projectWithOutput();
    acceptMissionOutputs(project);
    const persisted=getLocalProject(project.id)!;
    persisted.outputArtifacts.find((item)=>item.kind==="manifest")!.content+='\nchanged';
    expect(isMissionUserAccepted(persisted)).toBe(false);
    persisted.outputArtifacts=project.outputArtifacts;
    persisted.outputArtifacts.find((item)=>item.kind==="primary")!.frozenArtifact!.blobId="other-blob";
    expect(isMissionUserAccepted(persisted)).toBe(false);
  });
  it("invalidates the human review when the delivered artifact changes",()=>{
    const project=projectWithOutput("v1");
    const oldFingerprint=missionArtifactFingerprint(project);
    acceptMissionOutputs(project);
    const persisted = getLocalProject(project.id)!;
    persisted.outputArtifacts[0]!.content="v2";
    expect(missionArtifactFingerprint(persisted)).not.toBe(oldFingerprint);
    expect(isMissionUserAccepted(persisted)).toBe(false);
  });
});
