// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {Candidate,ConnectorActionRequest,ConnectorActionResponse,EvolveProject,TestCase} from "@evolution/contracts";
import {
  connectorCandidateArtifactFingerprint,
  runServerConnectorTargetBatch,
  stageServerConnectorCandidate,
} from "./server-connector-target-execution";

function project(){
  return{
    id:"connector-experiment",
    version:"V1",
    targetConnection:{
      adapter:"connector",connectionId:"connector",status:"connected",label:"Connector",
      connector:{connectorId:"workflow-main",targetId:"workflow-42"},
      connectorSnapshot:{
        connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",snapshotRef:"snap42",
        artifactId:"source",observedAt:"2026-09-22T02:00:00Z",
      },
    },
    sourceArtifacts:[{id:"source",role:"target"}],
  } as unknown as EvolveProject;
}

function candidate(){
  return{
    id:"C1",name:"Candidate 1",change:"change",patches:[],artifactBuildStatus:"ready",
    artifactSnapshots:[{
      id:"snap-c1",sourceArtifactId:"source",name:"workflow.json",mimeType:"application/json",
      content:'{"nodes":[{"id":"start"}]}',contentHash:"hash-c1",buildMode:"deterministic",notes:[],createdAt:"now",
      frozenArtifact:{sourceArtifactId:"source",snapshotHash:"hash-c1",blobId:"blob-c1",name:"workflow.json",mimeType:"application/json",sha256:"sha-c1",size:10,verifiedAt:"now",checks:[],limitations:[]},
    }],
  } as unknown as Candidate;
}

const cases=[{
  id:"T1",title:"runs",input:"run workflow",expected:["ok"],tags:[],hidden:false,criterionIds:[],
  executionMode:"external-runner",evidenceScope:"product-behavior",
}] as TestCase[];

function response(input:ConnectorActionRequest,overrides:Partial<ConnectorActionResponse>={}):ConnectorActionResponse{
  return{
    connectorId:input.connectorId,operation:input.operation,ok:true,targetId:input.targetId,
    versionRef:input.operation==="mutate"?"v43":input.expectedVersionRef,
    snapshotRef:input.operation==="mutate"?"snap43":"snap42",
    evidenceRefs:["evidence-1"],observedAt:"2026-09-22T03:00:00Z",note:"ok",
    output:input.operation==="validate"?{runs:[{testCaseId:"T1",output:"workflow ok",latencyMs:12,cost:0.01,verificationStatus:"verified"}]}:undefined,
    ...overrides,
  };
}

describe("server Connector Target execution",()=>{
  it("stages Candidate exactly once with optimistic base version and durable idempotency key",async()=>{
    const p=project();
    const c=candidate();
    const execute=vi.fn(async(input:ConnectorActionRequest)=>{
      expect(input).toMatchObject({
        operation:"mutate",connectorId:"workflow-main",targetId:"workflow-42",
        expectedVersionRef:"v42",missionId:"connector-experiment",
      });
      expect(input.idempotencyKey).toMatch(/^connector-mutate-/);
      expect((input.payload.artifacts as unknown[])).toHaveLength(1);
      return response(input);
    });
    const staged=await stageServerConnectorCandidate(p,c,execute,()=>undefined);
    expect(staged.connectorBinding).toMatchObject({
      connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v42",versionRef:"v43",snapshotRef:"snap43",
      artifactFingerprint:connectorCandidateArtifactFingerprint(p,c),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    const replay=await stageServerConnectorCandidate(p,staged,execute,()=>undefined);
    expect(replay).toBe(staged);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("validates the exact staged Candidate version and maps explicit test evidence",async()=>{
    const p=project();
    const c=candidate();
    const fingerprint=connectorCandidateArtifactFingerprint(p,c);
    c.connectorBinding={
      connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v42",versionRef:"v43",
      artifactFingerprint:fingerprint,snapshotRef:"snap43",evidenceRefs:["mutation-evidence"],observedAt:"now",
    };
    const execute=vi.fn(async(input:ConnectorActionRequest)=>{
      expect(input).toMatchObject({operation:"validate",expectedVersionRef:"v43"});
      expect(input.payload).toMatchObject({candidateId:"C1",snapshotRef:"snap43",artifactFingerprint:fingerprint});
      return response(input,{versionRef:"v43"});
    });
    const runs=await runServerConnectorTargetBatch(p,cases,c,execute);
    expect(runs).toEqual([
      expect.objectContaining({testCaseId:"T1",output:"workflow ok",verificationStatus:"verified",latencyMs:12,cost:0.01}),
    ]);
    expect(runs[0]?.trace[0]?.detail).toContain("evidence-1");
  });

  it("refuses Candidate mutation before network access when Connector isolation is not staged-version",async()=>{
    const execute=vi.fn();
    const assertIsolation=vi.fn(()=>{throw new Error("direct mutation is not isolated");});
    await expect(stageServerConnectorCandidate(project(),candidate(),execute,assertIsolation))
      .rejects.toThrow(/not isolated/);
    expect(assertIsolation).toHaveBeenCalledWith("workflow-main");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects staged-version mutation that reuses the base versionRef",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v42"}));
    await expect(stageServerConnectorCandidate(project(),candidate(),execute,()=>undefined))
      .rejects.toThrow(/must return a new versionRef/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not invent verified evidence when Connector omits a requested test result",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{output:{runs:[]}}));
    const runs=await runServerConnectorTargetBatch(project(),cases,undefined,execute);
    expect(runs[0]).toMatchObject({verificationStatus:"unverified",latencyMs:0,cost:0});
    expect(runs[0]?.output).toContain("UNVERIFIED");
  });

  it("fails closed if validate observes another version",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v999"}));
    await expect(runServerConnectorTargetBatch(project(),cases,undefined,execute)).rejects.toThrow(/version drifted/);
  });
});
