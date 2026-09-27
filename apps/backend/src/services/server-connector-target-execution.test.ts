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

function acceptedChampion(p:EvolveProject){
  const champion=candidate();
  const fingerprint=connectorCandidateArtifactFingerprint(p,champion);
  champion.connectorBinding={
    connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v42",versionRef:"v43",
    artifactFingerprint:fingerprint,snapshotRef:"snap43",evidenceRefs:["champion-evidence"],observedAt:"now",
  };
  p.searchChampion={
    versionLabel:"C1",candidate:champion,
    validation:{status:"completed",recommendation:"release"},
    artifactAcceptance:{status:"passed",candidateId:champion.id},
  } as unknown as EvolveProject["searchChampion"];
  return champion;
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

  it("rejects a locked Connector snapshot attached to another Artifact ID",async()=>{
    const p=project();
    p.targetConnection.connectorSnapshot!.artifactId="unrelated";
    const execute=vi.fn();
    await expect(stageServerConnectorCandidate(p,candidate(),execute,()=>undefined))
      .rejects.toThrow(/Artifact ID does not match/);
    expect(execute).not.toHaveBeenCalled();
    expect(()=>connectorCandidateArtifactFingerprint(p,candidate())).not.toThrow();
  });
  it("rejects duplicated primary Target rows even when their IDs match",()=>{
    const p=project();
    p.sourceArtifacts.push({...p.sourceArtifacts[0]!});
    expect(()=>connectorCandidateArtifactFingerprint(p,candidate()))
      .toThrow(/exactly one primary Target Artifact snapshot/);
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

  it("restages a Candidate when its prior binding uses an older baseline version",async()=>{
    const p=project();
    acceptedChampion(p);
    const next=candidate();
    next.id="C2";
    next.connectorBinding={
      connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v42",versionRef:"v42-c2",
      artifactFingerprint:connectorCandidateArtifactFingerprint(p,next),snapshotRef:"old-snapshot",
      evidenceRefs:[],observedAt:"now",
    };
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v44",snapshotRef:"snap44"}));
    const staged=await stageServerConnectorCandidate(p,next,execute,()=>undefined);
    expect(staged).not.toBe(next);
    expect(staged.connectorBinding).toMatchObject({baseVersionRef:"v43",versionRef:"v44"});
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({operation:"mutate",expectedVersionRef:"v43"}));
  });
  it("rejects an explicitly staged Candidate based on an older Baseline",async()=>{
    const p=project();
    const c=candidate();
    c.connectorBinding={
      connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v41",versionRef:"v42-c1",
      artifactFingerprint:connectorCandidateArtifactFingerprint(p,c),snapshotRef:"old-snapshot",
      evidenceRefs:[],observedAt:"now",
    };
    const execute=vi.fn();
    const runs=await runServerConnectorTargetBatch(p,cases,c,execute);
    expect(runs[0]?.verificationStatus).toBe("unverified");
    expect(runs[0]?.output).toContain("current Baseline version");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a prior-cycle Candidate after an accepted Champion advances the Baseline",async()=>{
    const p=project();
    acceptedChampion(p);
    const c=candidate();
    c.id="C2";
    c.connectorBinding={
      connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v42",versionRef:"v42-c2",
      artifactFingerprint:connectorCandidateArtifactFingerprint(p,c),snapshotRef:"old-snapshot",
      evidenceRefs:[],observedAt:"now",
    };
    const execute=vi.fn();
    const runs=await runServerConnectorTargetBatch(p,cases,c,execute);
    expect(runs[0]?.verificationStatus).toBe("unverified");
    expect(execute).not.toHaveBeenCalled();
  });

  it("can revalidate the exact accepted Champion staged version",async()=>{
    const p=project();
    const champion=acceptedChampion(p);
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input));
    const runs=await runServerConnectorTargetBatch(p,cases,champion,execute);
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation:"validate",expectedVersionRef:"v43",
      payload:expect.objectContaining({candidateId:champion.id}),
    }));
  });
  it("does not invent verified evidence when Connector omits a requested test result",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{output:{runs:[]}}));
    const runs=await runServerConnectorTargetBatch(project(),cases,undefined,execute);
    expect(runs[0]).toMatchObject({verificationStatus:"unverified",latencyMs:0,cost:0});
    expect(runs[0]?.output).toContain("UNVERIFIED");
  });

  it("keeps missing or malformed Connector validation verdicts unverified",async()=>{
    for(const run of [
      {testCaseId:"T1",output:"ok"},
      {testCaseId:"T1",output:"ok",verificationStatus:"unknown"},
      {testCaseId:"T1",output:"ok",verificationStatus:"verified",latencyMs:-1},
    ]){
      const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{output:{runs:[run]}}));
      const runs=await runServerConnectorTargetBatch(project(),cases,undefined,execute);
      expect(runs[0]).toMatchObject({testCaseId:"T1",verificationStatus:"unverified",latencyMs:0,cost:0});
      expect(runs[0]?.output).toContain("UNVERIFIED");
    }
  });

  it("does not accept duplicate Connector results for the same Test Case",async()=>{
    const run={testCaseId:"T1",output:"ok",verificationStatus:"verified"};
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{output:{runs:[run,run]}}));
    const runs=await runServerConnectorTargetBatch(project(),cases,undefined,execute);
    expect(runs[0]?.verificationStatus).toBe("unverified");
    expect(runs[0]?.output).toContain("重复结果");
  });

  it("fails closed if validate observes another version",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v999"}));
    await expect(runServerConnectorTargetBatch(project(),cases,undefined,execute)).rejects.toThrow(/version drifted/);
  });

  it("fails closed if validate omits the exact version receipt",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:undefined}));
    await expect(runServerConnectorTargetBatch(project(),cases,undefined,execute)).rejects.toThrow(/version drifted: missing/);
  });

  it("keeps a failed Connector validation unverified without requiring a version receipt",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{ok:false,versionRef:undefined,note:"unavailable"}));
    const runs=await runServerConnectorTargetBatch(project(),cases,undefined,execute);
    expect(runs[0]).toMatchObject({verificationStatus:"unverified",latencyMs:0,cost:0});
    expect(runs[0]?.output).toContain("unavailable");
  });
  it("validates the accepted Champion Connector version as the next Baseline",async()=>{
    const p=project();
    const champion=acceptedChampion(p);
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input));
    const runs=await runServerConnectorTargetBatch(p,cases,undefined,execute);
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation:"validate",expectedVersionRef:"v43",
      payload:expect.objectContaining({
        candidateId:champion.id,snapshotRef:"snap43",
        artifactFingerprint:champion.connectorBinding?.artifactFingerprint,
      }),
    }));
  });

  it("does not fall back to the original Connector snapshot when Champion evidence is missing",async()=>{
    const p=project();
    const champion=acceptedChampion(p);
    const execute=vi.fn();
    p.searchChampion!.artifactAcceptance!.status="unverified";
    const untrusted=await runServerConnectorTargetBatch(p,cases,undefined,execute);
    expect(untrusted[0]?.verificationStatus).toBe("unverified");
    expect(untrusted[0]?.output).toContain("Search Champion");
    p.searchChampion!.artifactAcceptance!.status="passed";
    champion.connectorBinding=undefined;
    const unbound=await runServerConnectorTargetBatch(p,cases,undefined,execute);
    expect(unbound[0]?.verificationStatus).toBe("unverified");
    expect(unbound[0]?.output).toContain("no exact Connector staged version");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects stale Champion Artifact fingerprints and stages the next Candidate from the accepted version",async()=>{
    const p=project();
    const champion=acceptedChampion(p);
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v44",snapshotRef:"snap44"}));
    champion.artifactSnapshots[0]!.content="changed after acceptance";
    const stale=await runServerConnectorTargetBatch(p,cases,undefined,execute);
    expect(stale[0]?.verificationStatus).toBe("unverified");
    expect(stale[0]?.output).toContain("Artifact Fingerprint");
    expect(execute).not.toHaveBeenCalled();
    champion.artifactSnapshots[0]!.content='{"nodes":[{"id":"start"}]}';
    const next=candidate();
    next.id="C2";
    await stageServerConnectorCandidate(p,next,execute,()=>undefined);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation:"mutate",expectedVersionRef:"v43",
    }));
  });
});
