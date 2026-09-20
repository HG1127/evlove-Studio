import { describe, expect, it } from "vitest";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { normalizeLocallyVerifiableCandidateRuns } from "./candidate-snapshot-evidence";

describe("candidate snapshot evidence",()=>{
  it("verifies a text roundtrip against the exact Candidate snapshot without an external runner",()=>{
    const project={
      evolutionCommand:"保持 Markdown 原格式",
      acceptanceRubric:[{
        id:"FORMAT",title:"原格式",requirement:"Markdown 可原格式交付",source:"system-integrity",weight:100,hardGate:true,
        judgeType:"integrity",validationMethod:"format-roundtrip",minScore:90,evidenceExpected:[],protectedConstraint:false,
        artifactIds:["source-1"],category:"artifact-specific",
      }],
      sourceArtifacts:[{id:"source-1",name:"source.md",extension:"md"}],
    } as unknown as EvolveProject;
    const candidate={artifactSnapshots:[{id:"snap-1",sourceArtifactId:"source-1",name:"source.md",content:"# evolved"}]} as Candidate;
    const testCase={
      id:"H-FORMAT",title:"格式往返",input:"检查 Markdown",expected:["逐字保持"],criterionIds:["FORMAT"],
      executionMode:"roundtrip",evidenceScope:"format",
    } as TestCase;
    const seed:TargetRunResult={testCaseId:testCase.id,output:"pending",latencyMs:0,cost:0,trace:[],verificationStatus:"unverified"};
    const [run]=normalizeLocallyVerifiableCandidateRuns(project,candidate,[testCase],[seed]);
    expect(run?.verificationStatus).toBe("verified");
    expect(run?.output).toContain("CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED");
    expect(run?.trace.some((step)=>step.stage==="format-roundtrip"&&step.status==="pass")).toBe(true);
  });
});
