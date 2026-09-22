// @vitest-environment node
import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {buildGitWebhookEvent,parseGitWebhookContext} from "./git-webhook";

function mission(){
  const candidate={id:"C1"};
  return{
    id:"mission-1",
    targetConnection:{
      adapter:"git",connectionId:"acme/app",status:"connected",label:"GitHub",
      git:{provider:"github",owner:"acme",repo:"app",baseBranch:"main"},
      gitSnapshot:{commitSha:"base123",treeSha:"tree-base",artifactId:"git-source",observedAt:"now"},
    },
    searchChampion:{candidate,artifactAcceptance:{status:"passed",candidateId:"C1",acceptedAt:"now",frozenArtifacts:[]}},
    artifactAcceptance:{status:"passed",candidateId:"C1",acceptedAt:"now",frozenArtifacts:[]},
    release:{
      status:"idle",trafficPercent:0,kpis:[],evidenceMode:"none",history:[],
      sourceGitRepository:"acme/app",sourceGitBranch:"evolve/mission-1/C1",sourceGitCommitSha:"commit123",sourceGitPullNumber:7,
    },
  } as unknown as EvolveProject;
}

describe("Git webhook Mission binding",()=>{
  it("extracts canonical Mission/Candidate, exact commit and PR identity from GitHub payloads",()=>{
    expect(parseGitWebhookContext("push",{
      ref:"refs/heads/evolve/mission-1/C1",after:"commit123",repository:{full_name:"acme/app"},
    })).toMatchObject({repository:"acme/app",branch:"evolve/mission-1/C1",missionId:"mission-1",candidateId:"C1",commitSha:"commit123"});
    expect(parseGitWebhookContext("pull_request",{
      number:7,repository:{full_name:"acme/app"},pull_request:{head:{ref:"evolve/mission-1/C1",sha:"commit123"}},
    })).toMatchObject({missionId:"mission-1",candidateId:"C1",commitSha:"commit123",pullNumber:7});
    expect(parseGitWebhookContext("check_suite",{
      repository:{full_name:"acme/app"},check_suite:{head_branch:"evolve/mission-1/C1",head_sha:"commit123"},
    })).toMatchObject({missionId:"mission-1",candidateId:"C1",commitSha:"commit123"});
  });

  it("does not infer Mission identity from non-canonical branches",()=>{
    const normal=parseGitWebhookContext("push",{ref:"refs/heads/main",after:"commit123",repository:{full_name:"acme/app"}});
    expect(normal).toMatchObject({repository:"acme/app",branch:"main"});
    expect(normal.missionId).toBeUndefined();
    expect(normal.candidateId).toBeUndefined();
    expect(parseGitWebhookContext("push",{ref:"refs/heads/evolve/mission-1",after:"commit123",repository:{full_name:"acme/app"}}).missionId).toBeUndefined();
  });

  it("accepts only the Mission-bound repository, Gate F Champion, canonical branch and persisted commit/PR",()=>{
    const event=buildGitWebhookEvent({
      mission:mission(),
      context:{event:"pull_request",repository:"ACME/APP",branch:"evolve/mission-1/C1",missionId:"mission-1",candidateId:"C1",commitSha:"commit123",pullNumber:7},
      deliveryFingerprint:"a".repeat(64),at:"2026-09-22T07:00:00Z",
    });
    expect(event).toMatchObject({
      id:"evt-github-"+"a".repeat(48),missionId:"mission-1",source:"github-webhook",at:"2026-09-22T07:00:00Z",
      payload:{repository:"ACME/APP",branch:"evolve/mission-1/C1",candidateId:"C1",commitSha:"commit123",pullNumber:7,binding:"persisted-accepted-writeback"},
    });
  });

  it("rejects repository, candidate, commit and PR drift",()=>{
    const base={event:"pull_request",repository:"acme/app",branch:"evolve/mission-1/C1",missionId:"mission-1",candidateId:"C1",commitSha:"commit123",pullNumber:7};
    expect(()=>buildGitWebhookEvent({mission:mission(),context:{...base,repository:"acme/other"}})).toThrow(/repository does not match/i);
    expect(()=>buildGitWebhookEvent({mission:mission(),context:{...base,candidateId:"C2",branch:"evolve/mission-1/C2"}})).toThrow(/Search Champion/i);
    expect(()=>buildGitWebhookEvent({mission:mission(),context:{...base,commitSha:"other123"}})).toThrow(/does not match persisted accepted commit/i);
    expect(()=>buildGitWebhookEvent({mission:mission(),context:{...base,pullNumber:8}})).toThrow(/does not match persisted PR/i);
  });

  it("refuses webhook audit binding until exact Accepted Git writeback identity is durably persisted",()=>{
    const p=mission();
    p.release.sourceGitRepository=undefined;p.release.sourceGitBranch=undefined;p.release.sourceGitCommitSha=undefined;p.release.sourceGitPullNumber=undefined;
    expect(()=>buildGitWebhookEvent({
      mission:p,
      context:{event:"push",repository:"acme/app",branch:"evolve/mission-1/C1",missionId:"mission-1",candidateId:"C1",commitSha:"commit123"},
    })).toThrow(/no persisted Accepted Git writeback identity/);
  });
});
