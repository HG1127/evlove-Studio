// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,TargetRunResult,TestCase} from "@evolution/contracts";
import {fastHash} from "@evolution/core";
import {runServerMissionExperiment} from "./server-experiment";

const {getBlob,runSandbox}=vi.hoisted(()=>({getBlob:vi.fn(),runSandbox:vi.fn()}));
vi.mock("@evolution/harness",async(importOriginal)=>({...await importOriginal<typeof import("@evolution/harness")>(),runServerExperiment:(_project:unknown,ports:unknown)=>ports}));
vi.mock("@evolution/adapters/sandbox",async(importOriginal)=>({...await importOriginal<typeof import("@evolution/adapters/sandbox")>(),runVercelSandboxCodebaseValidation:runSandbox}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:getBlob})}));
vi.mock("./connector-target-source",()=>({serverConnectorTargetEnabled:()=>false}));
vi.mock("./server-connector-target-execution",()=>({runServerConnectorTargetBatch:vi.fn(),stageServerConnectorCandidate:vi.fn()}));
vi.mock("./server-http-target-execution",()=>({serverHttpTargetEnabled:()=>false,runServerHttpTargetBatch:vi.fn()}));
vi.mock("./server-visual-evidence",()=>({attachServerVisualEvidence:(_project:unknown,_cases:unknown,runs:TargetRunResult[])=>runs}));

const testCase={id:"E2E",executionMode:"external-runner"} as TestCase;
const verifiedRun:TargetRunResult={testCaseId:"E2E",output:"verified",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]};

function frozenCandidate(bytes:Uint8Array){
  const sha256=createHash("sha256").update(bytes).digest("hex");
  const candidate={id:"candidate",artifactSnapshots:[{
    sourceArtifactId:"source",frozenArtifact:{blobId:"candidate-zip",sha256,size:bytes.byteLength},
  }]} as unknown as Candidate;
  const project={id:"mission",sourceArtifacts:[{id:"source",role:"target",artifactKind:"codebase",extension:"zip"}]} as unknown as EvolveProject;
  return {project,candidate,sha256};
}

async function execute(project:EvolveProject,candidate:Candidate){
  const ports=await runServerMissionExperiment(project) as unknown as {
    executeExternalBatch:(args:{project:EvolveProject;candidate:Candidate;testCases:TestCase[]})=>Promise<TargetRunResult[]>;
  };
  return ports.executeExternalBatch({project,candidate,testCases:[testCase]});
}

beforeEach(()=>{
  getBlob.mockReset();
  runSandbox.mockReset().mockResolvedValue({results:[verifiedRun]});
});

describe("server experiment frozen Candidate ZIP readback",()=>{
  it("refuses duplicate Candidate snapshots for one codebase Target",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=frozenCandidate(bytes);
    candidate.artifactSnapshots.push({...candidate.artifactSnapshots[0]!,id:"duplicate"});
    const [result]=await execute(project,candidate);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("唯一 Artifact Snapshot");
    expect(getBlob).not.toHaveBeenCalled();
    expect(runSandbox).not.toHaveBeenCalled();
  });
  it("refuses a changed ZIP byte size before Sandbox",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=frozenCandidate(bytes);
    getBlob.mockResolvedValue(new Blob(["short"]));
    const [result]=await execute(project,candidate);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("大小与冻结凭证不一致");
    expect(getBlob).toHaveBeenCalledWith("candidate-zip");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("refuses changed bytes of the same size before Sandbox",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=frozenCandidate(bytes);
    getBlob.mockResolvedValue(new Blob([new TextEncoder().encode("tampered archive")]));
    const [result]=await execute(project,candidate);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("SHA-256");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("runs Sandbox only with the exact frozen bytes and expected hash",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate,sha256}=frozenCandidate(bytes);
    getBlob.mockResolvedValue(new Blob([bytes]));
    const [result]=await execute(project,candidate);
    expect(result?.verificationStatus).toBe("verified");
    expect(getBlob).toHaveBeenCalledOnce();
    expect(runSandbox).toHaveBeenCalledWith(expect.objectContaining({
      id:`mission-experiment-candidate-${fastHash([testCase])}`,archive:bytes,expectedSha256:sha256,testCases:[testCase],
    }));
  });

  it("reports Blob read failures as unverified evidence",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,candidate}=frozenCandidate(bytes);
    getBlob.mockRejectedValue(new Error("blob unavailable"));
    const [result]=await execute(project,candidate);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("blob unavailable");
    expect(runSandbox).not.toHaveBeenCalled();
  });
});
