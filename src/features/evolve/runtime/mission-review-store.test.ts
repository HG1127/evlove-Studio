import { beforeEach, describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import { acceptMissionOutputs, isMissionUserAccepted, missionArtifactFingerprint } from "./mission-review-store";
import { getLocalProject } from "./local-store";

function projectWithOutput(content="v1"): EvolveProject {
  return {
    ...structuredClone(demoProject),
    id:"mission-review-test",
    outputArtifacts:[{
      id:"out-1",projectId:"mission-review-test",round:1,versionLabel:"S1",candidateId:"C1",name:"result.txt",mimeType:"text/plain",kind:"primary",content,description:"validated",sourceArtifactIds:[],isChampion:true,accepted:true,createdAt:"2026-09-17T00:00:00.000Z",
    }],
  } as EvolveProject;
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
