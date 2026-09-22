// @vitest-environment node
import JSZip from "jszip";
import {describe,expect,it,vi} from "vitest";
import type {ArtifactStorePort,EvolveProject,GitTargetActionResponse} from "@evolution/contracts";
import {
  gitSnapshotArtifactId,
  lockGitTargetSnapshot,
  materializeLockedGitTargetSource,
  normalizeGitRepositoryArchive,
} from "./git-target-source";
import {parseServerSource} from "./server-source-parser";

const repository={provider:"github" as const,owner:"acme",repo:"app",baseBranch:"main",pathPrefix:"packages/service"};

function fixture(){
  return{
    id:"mission-git-source",
    targetConnection:{adapter:"git",connectionId:"git",status:"connected",label:"GitHub",git:repository},
    sourceArtifacts:[],
    baselineRun:{status:"idle"},
    experimentRun:{status:"idle"},
    validationRun:{status:"idle"},
    candidates:[],
    searchChampion:undefined,
    artifactAcceptance:{status:"idle"},
    campaign:{currentRound:0},
    acceptanceRubric:[],
    acceptanceRubricState:{status:"idle",summary:"",version:0,weightTotal:0,uncoveredCriterionIds:[],warnings:[]},
    evalSuite:[],
    hiddenEvalSuite:[],
    gates:[
      {id:"target-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
      {id:"experiment-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
      {id:"artifact-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
      {id:"release-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
    ],
    outputArtifacts:[],
    release:{status:"idle"},
    lessons:[],
    roundHistory:[],
    inputClarifications:[],
    updatedAt:"2026-09-22T00:00:00Z",
  } as unknown as EvolveProject;
}

async function githubZip(){
  const zip=new JSZip();
  zip.file("acme-app-deadbeef/packages/service/package.json",'{"name":"service"}');
  zip.file("acme-app-deadbeef/packages/service/src/index.ts","export const value=42;");
  zip.file("acme-app-deadbeef/packages/other/ignored.ts","export const ignored=true;");
  return zip.generateAsync({type:"uint8array"});
}

function memoryStore():ArtifactStorePort{
  const blobs=new Map<string,Blob>();
  return{
    put:async(id,blob)=>{blobs.set(id,blob);},
    get:async(id)=>blobs.get(id),
    delete:async(id)=>{blobs.delete(id);},
  };
}

describe("Git target source materialization",()=>{
  it("locks the exact commit once and reuses that binding after a retry even if the branch later moves",async()=>{
    const snapshot=vi.fn(async()=>({
      provider:"github",action:"snapshot",ok:true,repository:"acme/app",branch:"main",
      baseCommitSha:"deadbeef",commitSha:"deadbeef",treeSha:"tree1111",
      observedAt:"2026-09-22T01:00:00Z",note:"locked",changedPaths:[],
    } as GitTargetActionResponse));
    const locked=await lockGitTargetSnapshot(fixture(),snapshot);
    expect(locked.targetConnection.gitSnapshot).toMatchObject({
      commitSha:"deadbeef",treeSha:"tree1111",
      artifactId:gitSnapshotArtifactId(repository,"deadbeef"),
    });
    const moved=vi.fn(async()=>{throw new Error("must not resnapshot moving main");});
    const retried=await lockGitTargetSnapshot(locked,moved);
    expect(retried.targetConnection.gitSnapshot?.commitSha).toBe("deadbeef");
    expect(moved).not.toHaveBeenCalled();
  });

  it("normalizes GitHub zipball root and pathPrefix into repository-relative paths",async()=>{
    const normalized=await normalizeGitRepositoryArchive(await githubZip(),repository.pathPrefix);
    const zip=await JSZip.loadAsync(normalized);
    const names=Object.values(zip.files).filter((entry)=>!entry.dir).map((entry)=>entry.name).sort();
    expect(names).toEqual(["package.json","src/index.ts"]);
    expect(await zip.file("src/index.ts")?.async("string")).toContain("value=42");
  });

  it("stores and parses the locked exact commit as a normal remote codebase SourceArtifact",async()=>{
    const project=fixture();
    project.targetConnection.gitSnapshot={
      commitSha:"deadbeef",treeSha:"tree1111",
      artifactId:gitSnapshotArtifactId(repository,"deadbeef"),
      observedAt:"2026-09-22T01:00:00Z",
    };
    const store=memoryStore();
    const download=vi.fn(async()=>githubZip());
    const materialized=await materializeLockedGitTargetSource(project,{
      download,artifacts:store,parse:parseServerSource,
    });
    const source=materialized.sourceArtifacts.find((artifact)=>artifact.role==="target");
    expect(source).toMatchObject({
      id:project.targetConnection.gitSnapshot.artifactId,
      artifactKind:"codebase",
      inputMode:"remote",
      parseStatus:"ready",
      storageRef:project.targetConnection.gitSnapshot.artifactId,
    });
    expect(source?.structure).toEqual(expect.arrayContaining(["package.json","src/index.ts"]));
    expect(source?.structure).not.toContain(expect.stringContaining("packages/service"));
    expect(source?.structuredContent).toMatchObject({
      gitSnapshot:{repository:"acme/app",commitSha:"deadbeef",treeSha:"tree1111",pathPrefix:"packages/service"},
    });
    expect(materialized.inputUnderstanding).toBeUndefined();
    expect(materialized.acceptanceRubric).toEqual([]);
    expect(materialized.gates.find((gate)=>gate.id==="target-ready")).toMatchObject({status:"ready",approvedAt:undefined});
    expect(materialized.gates.filter((gate)=>gate.id!=="target-ready").every((gate)=>gate.status==="pending"&&!gate.approvedAt)).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);

    const replay=await materializeLockedGitTargetSource(materialized,{
      download,artifacts:store,parse:parseServerSource,
    });
    expect(replay).toBe(materialized);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a configured pathPrefix is absent from the exact commit",async()=>{
    await expect(normalizeGitRepositoryArchive(await githubZip(),"missing/service")).rejects.toThrow(/pathPrefix/);
  });
});
