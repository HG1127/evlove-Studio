// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {Candidate,ConnectorActionRequest,ConnectorActionResponse,EvolveProject} from "@evolution/contracts";
import {executeConnectorReleaseAction,observeConnectorReleaseReality} from "./connector-release";

function fixture(){
  const candidate={
    id:"C1",name:"candidate",change:"x",patches:[],
    artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"workflow.json",mimeType:"application/json",content:"{}",contentHash:"hash-c1",createdAt:"now"}],
    connectorBinding:{
      connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v42",versionRef:"v43",
      artifactFingerprint:"fp-c1",snapshotRef:"snap43",evidenceRefs:[],observedAt:"now",
    },
  } as unknown as Candidate;
  const project={
    id:"connector-release",version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],
    targetConnection:{
      adapter:"connector",connectionId:"connector",status:"connected",label:"Connector",
      connector:{connectorId:"workflow-main",targetId:"workflow-42"},
      connectorSnapshot:{connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",snapshotRef:"snap42",artifactId:"source",observedAt:"now"},
    },
    releaseTarget:{provider:"connector",mode:"preview-promote",status:"connected",label:"Connector Release",healthPath:"/"},
    experimentRun:{winnerId:"C1"},candidates:[candidate],searchChampion:{candidate},
    release:{status:"idle",candidateId:"C1",trafficPercent:0,kpis:[],evidenceMode:"none",history:[]},
  } as unknown as EvolveProject;
  return{project,candidate};
}

function response(input:ConnectorActionRequest,overrides:Partial<ConnectorActionResponse>={}):ConnectorActionResponse{
  const action=String(input.payload.releaseAction??input.payload.recoveryAction??"shadow");
  const stable=action==="rollback";
  return{
    connectorId:input.connectorId,operation:input.operation,ok:true,targetId:input.targetId,
    versionRef:stable?"v42":"v43",
    deploymentRef:stable?"prod-v42":"preview-v43",
    evidenceRefs:["release-evidence"],observedAt:"2026-09-22T04:00:00Z",note:"release observed",
    output:{
      effectiveAction:action,
      trafficPercent:action==="promote"?100:0,
      healthy:true,observationStatus:"healthy",
      environment:action==="shadow"?"preview":"production",
      stableDeploymentRef:"prod-v42",latencyMs:25,sampleSize:3,windowMinutes:1,
    },
    ...overrides,
  };
}

describe("Connector release adapter",()=>{
  it("deploys the exact staged Candidate version with idempotency and converts it to a live release receipt",async()=>{
    const {project}=fixture();
    const execute=vi.fn(async(input:ConnectorActionRequest)=>{
      expect(input).toMatchObject({
        operation:"deploy",expectedVersionRef:"v43",connectorId:"workflow-main",targetId:"workflow-42",
      });
      expect(input.idempotencyKey).toMatch(/^connector-release-/);
      expect(input.payload).toMatchObject({
        releaseAction:"shadow",candidateVersionRef:"v43",stableVersionRef:"v42",artifactFingerprint:"fp-c1",
      });
      return response(input);
    });
    const result=await executeConnectorReleaseAction(project,{
      action:"shadow",deploymentId:undefined,stableDeploymentId:undefined,
      artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    },execute,()=>undefined);
    expect(result).toMatchObject({
      evidenceMode:"live",effectiveAction:"shadow",deploymentId:"preview-v43",stableDeploymentId:"prod-v42",
      healthy:true,observationStatus:"healthy",environment:"preview",
    });
    expect(result.artifactHashes).toEqual([{sourceArtifactId:"source",contentHash:"hash-c1"}]);
  });

  it("refuses a deploy response that points at another Candidate version",async()=>{
    const {project}=fixture();
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v999"}));
    await expect(executeConnectorReleaseAction(project,{
      action:"shadow",artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    },execute,()=>undefined)).rejects.toThrow(/Candidate v43/);
  });

  it("observes live release state read-only and preserves exact Candidate provenance",async()=>{
    const {project}=fixture();
    project.release={...project.release,status:"shadow",deploymentId:"preview-v43",stableDeploymentId:"prod-v42"};
    const execute=vi.fn(async(input:ConnectorActionRequest)=>{
      expect(input.operation).toBe("observe");
      expect(input.idempotencyKey).toBeUndefined();
      expect(input.payload).toMatchObject({candidateVersionRef:"v43",stableVersionRef:"v42",deploymentRef:"preview-v43"});
      return response({...input,payload:{...input.payload,releaseAction:"promote"}});
    });
    const result=await observeConnectorReleaseReality(project,{deploymentId:"preview-v43",stableDeploymentId:"prod-v42"},execute,()=>undefined);
    expect(result).toMatchObject({effectiveAction:"promote",deploymentId:"preview-v43",stableDeploymentId:"prod-v42",evidenceMode:"live"});
  });

  it("fails closed when observe reports another deployment or stable deployment",async()=>{
    const {project}=fixture();
    project.release={...project.release,status:"shadow",deploymentId:"preview-v43",stableDeploymentId:"prod-v42"};
    const wrongDeployment=vi.fn(async(input:ConnectorActionRequest)=>response(
      {...input,payload:{...input.payload,releaseAction:"shadow"}},
      {deploymentRef:"preview-other"},
    ));
    await expect(observeConnectorReleaseReality(
      project,
      {deploymentId:"preview-v43",stableDeploymentId:"prod-v42"},
      wrongDeployment,
      ()=>undefined,
    )).rejects.toThrow(/deploymentRef preview-other != expected preview-v43/);

    const wrongStable=vi.fn(async(input:ConnectorActionRequest)=>response(
      {...input,payload:{...input.payload,releaseAction:"shadow"}},
      {output:{
        effectiveAction:"shadow",trafficPercent:0,healthy:true,observationStatus:"healthy",
        environment:"preview",stableDeploymentRef:"prod-other",
      }},
    ));
    await expect(observeConnectorReleaseReality(
      project,
      {deploymentId:"preview-v43",stableDeploymentId:"prod-v42"},
      wrongStable,
      ()=>undefined,
    )).rejects.toThrow(/stableDeploymentRef prod-other != expected prod-v42/);
  });

  it("uses the explicitly requested deployment identity when observe omits deploymentRef",async()=>{
    const {project}=fixture();
    project.release={...project.release,status:"shadow",deploymentId:"preview-v43",stableDeploymentId:"prod-v42"};
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(
      {...input,payload:{...input.payload,releaseAction:"shadow"}},
      {deploymentRef:undefined},
    ));
    const result=await observeConnectorReleaseReality(
      project,
      {deploymentId:"preview-v43",stableDeploymentId:"prod-v42"},
      execute,
      ()=>undefined,
    );
    expect(result).toMatchObject({deploymentId:"preview-v43",stableDeploymentId:"prod-v42"});
  });

  it("requires rollback to resolve to the stable base version",async()=>{
    const {project}=fixture();
    project.release={...project.release,status:"promoted",deploymentId:"prod-v43",stableDeploymentId:"prod-v42"};
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v43"}));
    await expect(executeConnectorReleaseAction(project,{
      action:"rollback",deploymentId:"prod-v42",stableDeploymentId:"prod-v42",artifactHashes:[],
    },execute,()=>undefined)).rejects.toThrow(/stable v42/);
  });

  it("refuses legacy direct Connector release before any provider network action",async()=>{
    const {project}=fixture();
    const execute=vi.fn();
    const assertIsolation=vi.fn(()=>{throw new Error("Connector direct mutation is not staged-version");});
    await expect(executeConnectorReleaseAction(project,{
      action:"shadow",artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    },execute,assertIsolation)).rejects.toThrow(/staged-version/);
    expect(assertIsolation).toHaveBeenCalledWith("workflow-main");
    expect(execute).not.toHaveBeenCalled();
  });
});
