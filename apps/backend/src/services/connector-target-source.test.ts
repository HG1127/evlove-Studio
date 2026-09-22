// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {ArtifactStorePort,ConnectorActionRequest,ConnectorActionResponse,EvolveProject} from "@evolution/contracts";
import {
  connectorSnapshotArtifactId,
  lockConnectorTargetSnapshot,
  materializeLockedConnectorTargetSource,
} from "./connector-target-source";
import {parseServerSource} from "./server-source-parser";

const previousConnectors=process.env.EVOLUTION_CONNECTORS_JSON;
beforeEach(()=>{delete process.env.EVOLUTION_CONNECTORS_JSON;});
afterEach(()=>{
  if(previousConnectors===undefined)delete process.env.EVOLUTION_CONNECTORS_JSON;
  else process.env.EVOLUTION_CONNECTORS_JSON=previousConnectors;
});

function memoryStore():ArtifactStorePort{
  const blobs=new Map<string,Blob>();
  return{
    put:async(id,blob)=>{blobs.set(id,blob);},
    get:async(id)=>blobs.get(id),
    delete:async(id)=>{blobs.delete(id);},
  };
}

function fixture(){
  return{
    id:"mission-connector-source",
    targetConnection:{
      adapter:"connector",connectionId:"connector-workflow",status:"connected",label:"Workflow Connector",
      connector:{connectorId:"workflow-main",targetId:"workflow-42"},
    },
    sourceArtifacts:[],
    baselineRun:{status:"idle"},experimentRun:{status:"idle"},validationRun:{status:"idle"},
    candidates:[],searchChampion:undefined,artifactAcceptance:{status:"idle"},
    campaign:{currentRound:0},
    acceptanceRubric:[],acceptanceRubricState:{status:"idle",summary:"",version:0,weightTotal:0,uncoveredCriterionIds:[],warnings:[]},
    evalSuite:[],hiddenEvalSuite:[],
    gates:[
      {id:"target-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
      {id:"experiment-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
      {id:"artifact-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
      {id:"release-ready",status:"approved",approvedAt:"2026-09-21T00:00:00Z"},
    ],
    outputArtifacts:[],release:{status:"idle"},lessons:[],roundHistory:[],inputClarifications:[],
    updatedAt:"2026-09-22T00:00:00Z",
  } as unknown as EvolveProject;
}

function response(input:ConnectorActionRequest,overrides:Partial<ConnectorActionResponse>={}):ConnectorActionResponse{
  return{
    connectorId:input.connectorId,operation:input.operation,ok:true,targetId:input.targetId,
    versionRef:"v42",snapshotRef:"snap42",evidenceRefs:[],output:{nodes:[{id:"start",type:"trigger"}],edges:[]},
    observedAt:"2026-09-22T02:00:00Z",note:"ok",...overrides,
  };
}

describe("Connector target source materialization",()=>{
  it("locks exact versionRef once and never resnapshots on retry",async()=>{
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input));
    const locked=await lockConnectorTargetSnapshot(fixture(),execute);
    expect(locked.targetConnection.connectorSnapshot).toMatchObject({
      connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",snapshotRef:"snap42",
      artifactId:connectorSnapshotArtifactId("workflow-main","workflow-42","v42","snap42"),
    });
    const retry=vi.fn(async()=>{throw new Error("must not resnapshot");});
    const retried=await lockConnectorTargetSnapshot(locked,retry);
    expect(retried.targetConnection.connectorSnapshot?.versionRef).toBe("v42");
    expect(retry).not.toHaveBeenCalled();
  });

  it("reads the locked version, stores it and parses it as a remote workflow SourceArtifact",async()=>{
    process.env.EVOLUTION_CONNECTORS_JSON=JSON.stringify([{
      id:"workflow-main",label:"Workflow",targetType:"workflow",baseUrl:"https://connector.test",
      paths:{read:"/read",snapshot:"/snapshot",mutate:"/mutate",validate:"/validate",deploy:"/deploy",observe:"/observe",rollback:"/rollback"},
    }]);
    const project=fixture();
    project.targetConnection.connectorSnapshot={
      connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",snapshotRef:"snap42",
      artifactId:connectorSnapshotArtifactId("workflow-main","workflow-42","v42","snap42"),
      observedAt:"2026-09-22T02:00:00Z",
    };
    const execute=vi.fn(async(input:ConnectorActionRequest)=>{
      expect(input).toMatchObject({operation:"read",targetId:"workflow-42",expectedVersionRef:"v42"});
      return response(input);
    });
    const materialized=await materializeLockedConnectorTargetSource(project,{
      execute,artifacts:memoryStore(),parse:parseServerSource,
    });
    const source=materialized.sourceArtifacts.find((item)=>item.role==="target");
    expect(source).toMatchObject({
      id:project.targetConnection.connectorSnapshot.artifactId,
      artifactKind:"workflow",inputMode:"remote",parseStatus:"ready",
    });
    expect(source?.textContent).toContain('"nodes"');
    expect(source?.structuredContent).toMatchObject({
      connectorSnapshot:{connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",snapshotRef:"snap42"},
    });
    expect(materialized.gates.find((gate)=>gate.id==="target-ready")).toMatchObject({status:"ready",approvedAt:undefined});
    expect(materialized.gates.filter((gate)=>gate.id!=="target-ready").every((gate)=>gate.status==="pending")).toBe(true);
  });

  it("fails closed if read returns a different remote version",async()=>{
    process.env.EVOLUTION_CONNECTORS_JSON=JSON.stringify([{
      id:"workflow-main",label:"Workflow",targetType:"workflow",baseUrl:"https://connector.test",paths:{read:"/read"},
    }]);
    const project=fixture();
    project.targetConnection.connectorSnapshot={
      connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",snapshotRef:"snap42",
      artifactId:"connector-source-test",observedAt:"2026-09-22T02:00:00Z",
    };
    const execute=vi.fn(async(input:ConnectorActionRequest)=>response(input,{versionRef:"v43"}));
    await expect(materializeLockedConnectorTargetSource(project,{
      execute,artifacts:memoryStore(),parse:parseServerSource,
    })).rejects.toThrow(/version drifted/);
  });
});
