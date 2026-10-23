// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,TargetRunResult,TestCase} from "@evolution/contracts";
import {fastHash} from "@evolution/core";
import {runServerMissionHoldout} from "./server-holdout";

const {getBlob,runSandbox}=vi.hoisted(()=>({getBlob:vi.fn(),runSandbox:vi.fn()}));
vi.mock("@evolution/harness",async(importOriginal)=>({...await importOriginal<typeof import("@evolution/harness")>(),runServerHoldout:(_project:unknown,ports:unknown)=>ports}));
vi.mock("@evolution/adapters/sandbox",()=>({runVercelSandboxCodebaseValidation:runSandbox}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:getBlob})}));
vi.mock("./connector-target-source",()=>({serverConnectorTargetEnabled:()=>false}));
vi.mock("./server-connector-target-execution",()=>({runServerConnectorTargetBatch:vi.fn()}));
vi.mock("./server-http-target-execution",()=>({serverHttpTargetEnabled:()=>false,runServerHttpTargetBatch:vi.fn()}));
vi.mock("./server-visual-evidence",()=>({attachServerVisualEvidence:(_project:unknown,_cases:unknown,runs:TargetRunResult[])=>runs}));

const testCase={id:"E2E",executionMode:"external-runner"} as TestCase;
const verifiedRun:TargetRunResult={testCaseId:"E2E",output:"verified",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]};

function acceptedProject(bytes:Uint8Array){
  const sha256=createHash("sha256").update(bytes).digest("hex");
  const candidate={id:"candidate",artifactSnapshots:[{
    sourceArtifactId:"source",frozenArtifact:{blobId:"frozen-zip",sha256,size:bytes.byteLength},
  }]} as unknown as Candidate;
  const project={
    id:"mission",sourceArtifacts:[{id:"source",storageRef:"raw-zip",role:"target",artifactKind:"codebase",extension:"zip"}],
    searchChampion:{versionLabel:"C1",candidate,validation:{status:"completed",recommendation:"release"},
      artifactAcceptance:{status:"passed",candidateId:"candidate"}},
  } as unknown as EvolveProject;
  return {project,candidate,sha256};
}

async function externalPorts(project:EvolveProject){
  return await runServerMissionHoldout(project) as unknown as {
    current:{executeExternalBatch:(args:{project:EvolveProject;testCases:TestCase[]})=>Promise<TargetRunResult[]>};
    candidate:{executeExternalBatch:(args:{project:EvolveProject;candidate:Candidate;testCases:TestCase[]})=>Promise<TargetRunResult[]>};
  };
}

beforeEach(()=>{
  getBlob.mockReset();
  runSandbox.mockReset().mockResolvedValue({results:[verifiedRun]});
});

describe("server hidden holdout frozen ZIP readback",()=>{
  it("refuses a changed current-version ZIP size before Sandbox",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([new TextEncoder().encode("short")]));
    const ports=await externalPorts(project);
    const [result]=await ports.current.executeExternalBatch({project,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("大小与冻结凭证不一致");
    expect(getBlob).toHaveBeenCalledWith("frozen-zip");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("refuses duplicate Candidate snapshots for one codebase Target",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=acceptedProject(bytes);
    candidate.artifactSnapshots.push({...candidate.artifactSnapshots[0]!,id:"duplicate"});
    const ports=await externalPorts(project);
    const [result]=await ports.candidate.executeExternalBatch({project,candidate,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("唯一 Artifact Snapshot");
    expect(getBlob).not.toHaveBeenCalled();
    expect(runSandbox).not.toHaveBeenCalled();
  });
  it("refuses a changed Candidate ZIP size before Sandbox",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([new TextEncoder().encode("short")]));
    const ports=await externalPorts(project);
    const [result]=await ports.candidate.executeExternalBatch({project,candidate,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("大小与冻结凭证不一致");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("refuses same-size changed current-version bytes",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([new TextEncoder().encode("tampered archive")]));
    const ports=await externalPorts(project);
    const [result]=await ports.current.executeExternalBatch({project,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("SHA-256");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("refuses same-size changed Candidate bytes",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([new TextEncoder().encode("tampered archive")]));
    const ports=await externalPorts(project);
    const [result]=await ports.candidate.executeExternalBatch({project,candidate,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("SHA-256");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("reports Candidate Blob read failures as unverified evidence",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=acceptedProject(bytes);
    getBlob.mockRejectedValue(new Error("blob unavailable"));
    const ports=await externalPorts(project);
    const [result]=await ports.candidate.executeExternalBatch({project,candidate,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("blob unavailable");
    expect(runSandbox).not.toHaveBeenCalled();
  });
  it("binds current-version Sandbox to the exact frozen bytes and hash",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,sha256}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([bytes]));
    const ports=await externalPorts(project);
    const [result]=await ports.current.executeExternalBatch({project,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("verified");
    expect(getBlob).toHaveBeenCalledOnce();
    expect(runSandbox).toHaveBeenCalledWith(expect.objectContaining({
      id:`mission-holdout-baseline-candidate-${fastHash([testCase])}`,archive:bytes,expectedSha256:sha256,testCases:[testCase],
    }));
  });

  it("binds Candidate Sandbox to the exact frozen bytes and hash",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate,sha256}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([bytes]));
    const ports=await externalPorts(project);
    const [result]=await ports.candidate.executeExternalBatch({project,candidate,testCases:[testCase]});
    expect(result?.verificationStatus).toBe("verified");
    expect(getBlob).toHaveBeenCalledOnce();
    expect(runSandbox).toHaveBeenCalledWith(expect.objectContaining({
      id:`mission-holdout-candidate-${fastHash([testCase])}`,archive:bytes,expectedSha256:sha256,testCases:[testCase],
    }));
  });
});
