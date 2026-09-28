// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,GitTargetActionResponse} from "@evolution/contracts";
import {evidenceFingerprint} from "@evolution/core";
import {acceptedChampionGitChanges,publishAcceptedChampionToConfiguredGit,publishAcceptedChampionToGit} from "./git-accepted-publisher";

function project(){
  const candidate={
    id:"C1",name:"candidate",change:"x",patches:[],
    artifactSnapshots:[
      {id:"snap-a",sourceArtifactId:"source-a",name:"src/a.ts",mimeType:"text/plain",content:"export const a=2",contentHash:"hash-a",createdAt:"now"},
      {id:"snap-b",sourceArtifactId:"source-b",name:"README.md",mimeType:"text/markdown",content:"# evolved",contentHash:"hash-b",createdAt:"now"},
    ],
  } as unknown as Candidate;
  const acceptance={
    id:"acceptance",status:"passed" as const,candidateId:"C1",overallScore:100,coverageScore:100,integrityScore:100,pairwiseScore:100,
    hardGatePass:true,results:[],attempts:1,maxRepairAttempts:3,summary:"passed",acceptedAt:"2026-09-21T03:00:00Z",
    frozenArtifacts:[
      {sourceArtifactId:"source-a",snapshotHash:"hash-a",blobId:"blob-a",name:"src/a.ts",mimeType:"text/plain",sha256:"sha-a",size:16,verifiedAt:"now",checks:[],limitations:[]},
      {sourceArtifactId:"source-b",snapshotHash:"hash-b",blobId:"blob-b",name:"README.md",mimeType:"text/markdown",sha256:"sha-b",size:9,verifiedAt:"now",checks:[],limitations:[]},
    ],
  };
  const evaluation={accuracy:92,evidence:92,riskCoverage:92,completeness:92,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[]};
  const mission={
    id:"mission-1",name:"Mission",version:"V1",
    goal:"Improve the accepted artifact",evolutionCommand:"Improve safely",protectedItems:["preserve API"],
    metrics:[],hiddenEvalSuite:[{id:"H1"}],sourceArtifacts:[{id:"source-a",role:"target",name:"src/a.ts",mimeType:"text/plain",extension:"ts"},{id:"source-b",role:"target",name:"README.md",mimeType:"text/markdown",extension:"md"}],acceptanceRubric:[],roundHistory:[],evolutionArchive:[],
    campaign:{currentRound:1,parentStrategy:"champion",status:"paused",schedule:{enabled:false}},
    candidates:[candidate],experimentRun:{winnerId:"C1"},validationRun:{status:"completed",validationMode:"full",candidateId:"C1",recommendation:"release",evaluation,runs:[{testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}]},
    artifactAcceptance:acceptance,
    targetConnection:{
      adapter:"git",connectionId:"acme/app",status:"connected",label:"GitHub",
      git:repository,
      gitSnapshot:{commitSha:"base123",treeSha:"tree-base",artifactId:"git-source",observedAt:"now"},
    },
    searchChampion:{
      id:"champion-1",round:1,versionLabel:"V1",candidate,artifactAcceptance:acceptance,
      validation:{status:"completed",validationMode:"full",candidateId:"C1",recommendation:"release",evaluation,runs:[{testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}]},score:99,reason:"best",patches:[],evaluation,
    },
  } as unknown as EvolveProject;
  refreshBinding(mission);
  return mission;
}

function refreshBinding(mission:EvolveProject){
  const candidate=mission.searchChampion!.candidate!;
  const binding=evidenceFingerprint(mission,candidate);
  mission.validationRun.evidenceFingerprint=binding;
  mission.artifactAcceptance.evidenceFingerprint=binding;
  mission.searchChampion!.validation!.evidenceFingerprint=binding;
}

const repository={provider:"github" as const,owner:"acme",repo:"app",baseBranch:"main"};

describe("accepted Git publisher",()=>{
  it("derives writeback only from Gate F frozen Champion artifacts",()=>{
    const prepared=acceptedChampionGitChanges(project(),true);
    expect(prepared.primaryCount).toBe(2);
    expect(prepared.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({path:"src/a.ts",content:"export const a=2"}),
      expect.objectContaining({path:"README.md",content:"# evolved"}),
      expect.objectContaining({path:".evolution/ARTIFACT_ACCEPTANCE_REPORT.json"}),
    ]));
  });

  it("rejects duplicate and unrelated frozen receipts before Git writeback",()=>{
    for(const sourceArtifactId of ["source-a","unrelated"]){
      const mission=project();
      mission.searchChampion!.artifactAcceptance!.frozenArtifacts!.push({
        ...mission.searchChampion!.artifactAcceptance!.frozenArtifacts![0]!,sourceArtifactId,
      });
      expect(()=>acceptedChampionGitChanges(mission,false)).toThrow(/frozen Artifact identities/i);
    }
  });

  it("rejects changed Candidate bytes even when Git metadata is omitted",()=>{
    const mission=project();
    mission.searchChampion!.candidate!.artifactSnapshots[0]!.content="changed after acceptance";
    expect(()=>acceptedChampionGitChanges(mission,false)).toThrow(/验证绑定不完整/);
  });
  it("expands an accepted code/package blueprint into real Git files",()=>{
    const mission=project();
    mission.sourceArtifacts=[{
      id:"source-a",name:"repo.zip",role:"target",artifactKind:"codebase",mimeType:"application/zip",size:1,extension:"zip",
      inputMode:"upload",parseStatus:"ready",structure:[],warnings:[],createdAt:"now",
      artifactDescriptor:{
        family:"codebase",subtype:"repository",adapterId:"codebase-zip-repository",confidence:1,preservationMode:"same-package",
        fidelity:"high",formatExtension:"zip",editable:true,
        capabilities:{parse:true,mutate:true,materialize:true,validateStructure:true,execute:true,visual:false},
        evolutionDimensions:[],requiredValidations:[],limitations:[],
      },
    } as EvolveProject["sourceArtifacts"][number]];
    mission.searchChampion!.candidate!.artifactSnapshots=[{
      id:"snap-repo",sourceArtifactId:"source-a",name:"repo.zip",mimeType:"application/zip",
      content:JSON.stringify({kind:"codebase",files:[{path:"src/a.ts",content:"export const a=3"},{path:"README.md",content:"# repo"}]}),
      contentHash:"hash-a",buildMode:"ai-full",notes:[],createdAt:"now",
    }];
    mission.searchChampion!.artifactAcceptance!.frozenArtifacts=[
      {sourceArtifactId:"source-a",snapshotHash:"hash-a",blobId:"blob-a",name:"repo.zip",mimeType:"application/zip",sha256:"sha-a",size:1,verifiedAt:"now",checks:[],limitations:[]},
    ];
    refreshBinding(mission);
    const prepared=acceptedChampionGitChanges(mission,false);
    expect(prepared.changes).toEqual([
      {path:"src/a.ts",content:"export const a=3",delete:false},
      {path:"README.md",content:"# repo",delete:false},
    ]);
  });

  it("refuses to commit Office JSON blueprints as fake binary files",()=>{
    const mission=project();
    mission.sourceArtifacts=[{
      id:"source-a",name:"report.docx",role:"target",artifactKind:"document",
      mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",size:1,extension:"docx",
      inputMode:"upload",parseStatus:"ready",structure:[],warnings:[],createdAt:"now",
    } as EvolveProject["sourceArtifacts"][number]];
    mission.searchChampion!.candidate!.artifactSnapshots=[{
      id:"snap-docx",sourceArtifactId:"source-a",name:"report.docx",
      mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content:JSON.stringify({kind:"document",parts:[]}),contentHash:"hash-a",buildMode:"ai-full",notes:[],createdAt:"now",
    }];
    mission.searchChampion!.artifactAcceptance!.frozenArtifacts=[
      {sourceArtifactId:"source-a",snapshotHash:"hash-a",blobId:"blob-a",name:"report.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",sha256:"sha-a",size:1,verifiedAt:"now",checks:[],limitations:[]},
    ];
    refreshBinding(mission);
    expect(()=>acceptedChampionGitChanges(mission,false)).toThrow(/binary artifact|Server Renderer/i);
  });

  it("rejects before Git access when Gate F is not passed",async()=>{
    const mission=project();
    mission.searchChampion!.artifactAcceptance={...mission.searchChampion!.artifactAcceptance!,status:"failed"};
    const executor=vi.fn();
    await expect(publishAcceptedChampionToGit(mission,{
      repository,missionId:mission.id,expectedBaseSha:"base123",openPullRequest:true,includeMetadata:true,
    },executor)).rejects.toThrow(/Gate F/);
    expect(executor).not.toHaveBeenCalled();
  });

  it("creates mutation first and PR from the exact returned branch",async()=>{
    const calls:unknown[]=[];
    const executor=vi.fn(async(input:unknown)=>{
      calls.push(input);
      const action=(input as {action:string}).action;
      if(action==="mutate"){
        return {
          provider:"github",action:"mutate",ok:true,repository:"acme/app",branch:"evolve/mission-1/C1",
          baseCommitSha:"base123",commitSha:"commit123",treeSha:"tree123",changedPaths:["src/a.ts","README.md"],
          observedAt:"now",note:"mutated",
        } as GitTargetActionResponse;
      }
      return {
        provider:"github",action:"open-pr",ok:true,repository:"acme/app",branch:"evolve/mission-1/C1",
        commitSha:"commit123",pullNumber:7,pullUrl:"https://github.com/acme/app/pull/7",changedPaths:[],
        observedAt:"now",note:"pr",
      } as GitTargetActionResponse;
    });
    const result=await publishAcceptedChampionToGit(project(),{
      repository,missionId:"mission-1",expectedBaseSha:"base123",openPullRequest:true,includeMetadata:false,
    },executor);
    expect(result).toMatchObject({candidateId:"C1",artifactCount:2,metadataCount:0,pullRequest:{pullNumber:7}});
    expect(calls[0]).toMatchObject({action:"mutate",expectedBaseSha:"base123",candidateId:"C1"});
    expect(calls[1]).toMatchObject({action:"open-pr",branch:"evolve/mission-1/C1",candidateId:"C1"});
  });

  it("publishes from the already locked Mission source commit without resnapshotting moving main",async()=>{
    const mission=project();
    const calls:unknown[]=[];
    const executor=vi.fn(async(input:unknown)=>{
      calls.push(input);
      const action=(input as {action:string}).action;
      if(action==="mutate"){
        return {
          provider:"github",action:"mutate",ok:true,repository:"acme/app",branch:"evolve/mission-1/C1",
          baseCommitSha:"base123",commitSha:"commit123",treeSha:"tree123",changedPaths:["src/a.ts","README.md"],
          observedAt:"now",note:"mutated",
        } as GitTargetActionResponse;
      }
      return {
        provider:"github",action:"open-pr",ok:true,repository:"acme/app",branch:"evolve/mission-1/C1",
        commitSha:"commit123",pullNumber:7,pullUrl:"https://github.com/acme/app/pull/7",changedPaths:[],
        observedAt:"now",note:"pr",
      } as GitTargetActionResponse;
    });
    const result=await publishAcceptedChampionToConfiguredGit(mission,executor);
    expect(result).toMatchObject({candidateId:"C1",mutation:{baseCommitSha:"base123"},pullRequest:{pullNumber:7}});
    expect(calls.map((item)=>(item as {action:string}).action)).toEqual(["mutate","open-pr"]);
    expect(calls[0]).toMatchObject({expectedBaseSha:"base123"});
  });

  it("refuses configured writeback when the Mission has no locked source commit",async()=>{
    const mission=project();
    mission.targetConnection={...mission.targetConnection,gitSnapshot:undefined};
    const executor=vi.fn();
    await expect(publishAcceptedChampionToConfiguredGit(mission,executor)).rejects.toThrow(/exact locked source commit/i);
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects an allowlisted but different repository before any Git write",async()=>{
    const executor=vi.fn();
    await expect(publishAcceptedChampionToGit(project(),{
      repository:{...repository,repo:"other-app"},missionId:"mission-1",expectedBaseSha:"base123",openPullRequest:true,includeMetadata:false,
    },executor)).rejects.toThrow(/repository does not match/i);
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied base SHA that differs from the exact Mission source snapshot",async()=>{
    const executor=vi.fn();
    await expect(publishAcceptedChampionToGit(project(),{
      repository,missionId:"mission-1",expectedBaseSha:"new-main999",openPullRequest:true,includeMetadata:false,
    },executor)).rejects.toThrow(/does not match locked Mission source/i);
    expect(executor).not.toHaveBeenCalled();
  });

  it("leaves non-Git targets untouched",async()=>{
    const mission=project();
    mission.targetConnection={adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"};
    const executor=vi.fn();
    expect(await publishAcceptedChampionToConfiguredGit(mission,executor)).toBeUndefined();
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects duplicate accepted paths before Git mutation",()=>{
    const mission=project();
    mission.searchChampion!.candidate!.artifactSnapshots[1]!.name="src/a.ts";
    refreshBinding(mission);
    expect(()=>acceptedChampionGitChanges(mission,false)).toThrow(/duplicate path/i);
  });
});
