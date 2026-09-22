// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {EvolveProject,TargetRunResult,TestCase,VisualJudgeAiResult} from "@evolution/contracts";

const put=vi.fn(async()=>undefined);
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({put,get:vi.fn(),delete:vi.fn()})}));

import {attachServerVisualEvidence} from "./server-visual-evidence";

const project={id:"mission-visual",name:"Visual Mission",goal:"Improve UI",objectType:"codebase"} as unknown as EvolveProject;
const testCase={id:"V1",title:"Visual quality",input:"Inspect rendered UI",expected:["responsive"],criterionIds:["C1"],executionMode:"visual-review",evidenceScope:"product-behavior"} as TestCase;
const screenshot={name:"desktop.jpg",width:1440,height:900,dataUrl:"data:image/jpeg;base64,aGVsbG8=",artifactHash:"hash-1"};
const run={testCaseId:"V1",output:"browser",latencyMs:10,cost:0,verificationStatus:"partial",trace:[],screenshots:[screenshot]} as TargetRunResult;

describe("server visual evidence",()=>{
  it("persists exact screenshot evidence and returns only durable refs plus multimodal judge output",async()=>{
    put.mockClear();
    const judge=vi.fn(async():Promise<VisualJudgeAiResult>=>({scores:{usability:88,aesthetics:86,responsiveness:91,interaction:84},summary:"clear",findings:["mobile nav"]}));
    const [result]=await attachServerVisualEvidence(project,[testCase],[run],judge);
    expect(put).toHaveBeenCalledTimes(1);
    expect(judge).toHaveBeenCalledWith(expect.objectContaining({screenshots:[expect.objectContaining({artifactHash:"hash-1"})]}),{imageDataUrls:[screenshot.dataUrl]});
    expect(result?.screenshots).toBeUndefined();
    expect(result?.visualEvidenceRefs?.[0]).toEqual(expect.objectContaining({artifactHash:"hash-1",blobId:expect.stringContaining("visual-evidence:mission-visual:server:V1:")}));
    expect(result?.verificationStatus).toBe("partial");
    expect(result?.output).toContain("SERVER VISUAL JUDGE");
  });

  it("fails closed when the multimodal judge cannot inspect the captured image",async()=>{
    const [result]=await attachServerVisualEvidence(project,[testCase],[run],async()=>{throw new Error("vision unavailable");});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.visualEvidenceRefs).toHaveLength(1);
    expect(result?.screenshots).toBeUndefined();
    expect(result?.output).toContain("vision unavailable");
  });

  it("strips transient base64 evidence and fails closed when durable screenshot storage is unavailable",async()=>{
    put.mockRejectedValueOnce(new Error("artifact store unavailable"));
    const judge=vi.fn();
    const [result]=await attachServerVisualEvidence(project,[testCase],[run],judge);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.screenshots).toBeUndefined();
    expect(result?.visualEvidenceRefs).toBeUndefined();
    expect(result?.output).toContain("Artifact Store");
    expect(judge).not.toHaveBeenCalled();
  });

  it("preserves a deterministic browser failure while still persisting and stripping its screenshots",async()=>{
    put.mockResolvedValueOnce(undefined);
    const failed={...run,verificationStatus:"failed" as const,error:"390px overflow"};
    const [result]=await attachServerVisualEvidence(project,[testCase],[failed],async()=>({
      scores:{usability:70,aesthetics:75,responsiveness:40,interaction:70},
      summary:"移动端有溢出",
      findings:["390px 横向溢出"],
    }));
    expect(result?.verificationStatus).toBe("failed");
    expect(result?.screenshots).toBeUndefined();
    expect(result?.visualEvidenceRefs).toHaveLength(1);
  });
});
