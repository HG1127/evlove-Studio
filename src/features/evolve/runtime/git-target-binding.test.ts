import {describe,expect,it} from "vitest";
import type {EvolveProject,SourceArtifact} from "@evolution/contracts";
import {demoProject} from "../data/mock-project";
import {bindGitTarget,disconnectGitTarget} from "./git-target-binding";

function gitSource():SourceArtifact{
  return{
    id:"git-old",
    name:"repo-deadbeef.zip",
    mimeType:"application/zip",
    extension:"zip",
    structure:["package.json"],
    size:100,
    role:"target",
    inputMode:"remote",
    parseStatus:"ready",
    artifactKind:"codebase",
    structuredContent:{gitSnapshot:{repository:"old/repo",commitSha:"deadbeef",treeSha:"tree-old"}},
    warnings:[],
    createdAt:"2026-09-21T00:00:00Z",
  };
}

describe("git target binding",()=>{
  it("binds a repository as the only primary target and invalidates stale downstream state",()=>{
    const uploaded={...demoProject.sourceArtifacts[0]!,id:"uploaded-target",role:"target" as const};
    const project={
      ...structuredClone(demoProject),
      sourceArtifacts:[uploaded,gitSource()],
      candidates:[{id:"old-candidate"}] as EvolveProject["candidates"],
    } as EvolveProject;
    const next=bindGitTarget({
      project,
      repository:{provider:"github",owner:"acme",repo:"app",baseBranch:"main",pathPrefix:"packages/web"},
      now:"2026-09-22T05:00:00Z",
    });
    expect(next.targetConnection).toMatchObject({
      adapter:"git",
      status:"connected",
      git:{provider:"github",owner:"acme",repo:"app",baseBranch:"main",pathPrefix:"packages/web"},
    });
    expect(next.targetConnection.gitSnapshot).toBeUndefined();
    expect(next.sourceArtifacts.some((artifact)=>artifact.id==="git-old")).toBe(false);
    expect(next.sourceArtifacts.find((artifact)=>artifact.id==="uploaded-target")?.role).toBe("reference");
    expect(next.candidates).toEqual([]);
    expect(next.baselineRun.status).toBe("idle");
    expect(next.gates.find((gate)=>gate.id==="target-ready")?.status).toBe("ready");
  });

  it("preserves an independent Vercel release target when Git becomes the evolution target",()=>{
    const project={
      ...structuredClone(demoProject),
      releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"},
    } as EvolveProject;
    const next=bindGitTarget({
      project,
      repository:{provider:"github",owner:"acme",repo:"app",baseBranch:"main"},
    });
    expect(next.releaseTarget?.provider).toBe("vercel");
  });

  it("clears a stale Connector release target when switching the evolution target to Git",()=>{
    const project={
      ...structuredClone(demoProject),
      releaseTarget:{provider:"connector",mode:"preview-promote",status:"connected",label:"Connector Release",healthPath:"/"},
    } as EvolveProject;
    const next=bindGitTarget({
      project,
      repository:{provider:"github",owner:"acme",repo:"app",baseBranch:"main"},
    });
    expect(next.releaseTarget).toMatchObject({provider:"none",status:"not-configured"});
  });

  it("disconnects Git and removes materialized Git source without reviving stale primary artifacts",()=>{
    const project=bindGitTarget({
      project:{...structuredClone(demoProject),sourceArtifacts:[gitSource()]} as EvolveProject,
      repository:{provider:"github",owner:"acme",repo:"app",baseBranch:"main"},
    });
    const materialized={
      ...project,
      sourceArtifacts:[gitSource()],
      targetConnection:{
        ...project.targetConnection,
        gitSnapshot:{commitSha:"deadbeef",treeSha:"tree-old",artifactId:"git-old",observedAt:"now"},
      },
    } as EvolveProject;
    const next=disconnectGitTarget(materialized,"2026-09-22T06:00:00Z");
    expect(next.targetConnection.adapter).toBe("artifact");
    expect(next.sourceArtifacts).toEqual([]);
    expect(next.release.status).toBe("idle");
  });
});
