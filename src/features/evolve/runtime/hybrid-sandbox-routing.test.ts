import { beforeEach,describe,expect,it,vi } from "vitest";
import { demoProject } from "../data/mock-project";
import type { EvolveProject, TestCase } from "../schemas";

const sandboxBatch=vi.hoisted(()=>vi.fn());

vi.mock("./sandbox-target-client",()=>({
  runServerSandboxTargetBatch:sandboxBatch,
}));

import { artifactTargetAdapter } from "../target/artifact-adapter";

describe("Hybrid Sandbox target routing",()=>{
  beforeEach(()=>sandboxBatch.mockReset());

  it("routes codebase external-runner evidence to the server Sandbox batch API",async()=>{
    const source={
      id:"zip-target",
      name:"repo.zip",
      role:"target" as const,
      artifactKind:"codebase" as const,
      mimeType:"application/zip",
      size:128,
      extension:"zip",
      inputMode:"upload" as const,
      parseStatus:"ready" as const,
      textExcerpt:"codebase",
      structure:["package.json"],
      warnings:[],
      createdAt:"2026-09-20T00:00:00.000Z",
    };
    const project:EvolveProject={
      ...structuredClone(demoProject),
      id:"hybrid-routing-test",
      sourceArtifacts:[source],
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"AI Artifact Runtime"},
    };
    const testCase:TestCase={
      id:"build-test",
      title:"Build and test project",
      input:"Run build and test",
      expected:["build passes","tests pass"],
      tags:["build","test"],
      hidden:false,
      criterionIds:[],
      executionMode:"external-runner",
      evidenceScope:"implementation",
    };
    sandboxBatch.mockResolvedValue({
      results:[{
        testCaseId:testCase.id,
        output:"VERCEL SANDBOX EVIDENCE",
        latencyMs:1200,
        cost:0,
        artifactHash:"a".repeat(64),
        verificationStatus:"verified",
        trace:[],
      }],
      scriptsRun:["build","test"],
      artifactHash:"a".repeat(64),
    });

    const result=await artifactTargetAdapter.run({project,testCase});

    expect(result.verificationStatus).toBe("verified");
    expect(result.output).toContain("VERCEL SANDBOX");
    expect(sandboxBatch).toHaveBeenCalledTimes(1);
    expect(sandboxBatch).toHaveBeenCalledWith(expect.objectContaining({
      projectId:project.id,
      sourceArtifactId:source.id,
      artifactBlobId:source.id,
      testCases:[testCase],
    }));
  });
});
