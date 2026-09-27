// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {EvolveProject,TargetRunResult,TestCase} from "@evolution/contracts";
import {executeServerBaselineExternal} from "./server-baseline";

const {getBlob,runSandbox}=vi.hoisted(()=>({getBlob:vi.fn(),runSandbox:vi.fn()}));
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
  const project={
    id:"mission",sourceArtifacts:[{id:"source",role:"target",artifactKind:"codebase",extension:"zip"}],
    searchChampion:{versionLabel:"C1",candidate:{id:"candidate",artifactSnapshots:[{
      sourceArtifactId:"source",frozenArtifact:{blobId:"frozen-zip",sha256,size:bytes.byteLength},
    }]},validation:{status:"completed",recommendation:"release"},
    artifactAcceptance:{status:"passed",candidateId:"candidate"}},
  } as unknown as EvolveProject;
  return {project,sha256};
}

beforeEach(()=>{
  getBlob.mockReset();
  runSandbox.mockReset().mockResolvedValue({results:[verifiedRun]});
});

describe("server baseline frozen ZIP readback",()=>{
  it("refuses a different byte size before starting Sandbox",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([new TextEncoder().encode("short")]));
    const [result]=await executeServerBaselineExternal(project,[testCase]);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("大小与冻结凭证不一致");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("refuses changed bytes of the same size before starting Sandbox",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([new TextEncoder().encode("tampered archive")]));
    const [result]=await executeServerBaselineExternal(project,[testCase]);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("SHA-256 与冻结凭证不一致");
    expect(runSandbox).not.toHaveBeenCalled();
  });

  it("runs Sandbox only for the exact frozen bytes and passes the expected hash",async()=>{
    const bytes=new TextEncoder().encode("accepted archive");
    const {project,sha256}=acceptedProject(bytes);
    getBlob.mockResolvedValue(new Blob([bytes]));
    const [result]=await executeServerBaselineExternal(project,[testCase]);
    expect(result?.verificationStatus).toBe("verified");
    expect(getBlob).toHaveBeenCalledWith("frozen-zip");
    expect(runSandbox).toHaveBeenCalledOnce();
    expect(runSandbox).toHaveBeenCalledWith(expect.objectContaining({
      id:"mission-baseline-candidate",expectedSha256:sha256,archive:bytes,testCases:[testCase],
    }));
  });
});