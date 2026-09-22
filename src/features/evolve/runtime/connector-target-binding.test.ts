import {describe,expect,it} from "vitest";
import type {ConnectorPublicManifest,EvolveProject,SourceArtifact} from "@evolution/contracts";
import {demoProject} from "../data/mock-project";
import {
  bindConnectorTarget,
  connectorSupportsExperiment,
  connectorSupportsFullLifecycle,
  disconnectConnectorTarget,
} from "./connector-target-binding";

function manifest(full=true):ConnectorPublicManifest{
  return{
    id:"workflow-main",
    label:"Workflow Main",
    targetType:"workflow",
    credentialConfigured:true,
    webhookConfigured:false,
    credentialProvider:"env",
    webhookProvider:"none",
    lifecycle:{
      read:true,snapshot:true,mutate:true,validate:true,
      deploy:full,observe:full,rollback:full,
    },
  };
}

function connectorSource():SourceArtifact{
  return{
    id:"connector-old",
    name:"workflow-old.json",
    mimeType:"application/json",
    extension:"json",
    structure:["workflow"],
    size:20,
    role:"target",
    inputMode:"remote",
    parseStatus:"ready",
    artifactKind:"workflow",
    structuredContent:{connectorSnapshot:{connectorId:"old",targetId:"old-target",versionRef:"v1"}},
    warnings:[],
    createdAt:"2026-09-21T00:00:00Z",
  } as SourceArtifact;
}

describe("connector target binding",()=>{
  it("distinguishes experiment-ready from full-lifecycle connectors",()=>{
    expect(connectorSupportsExperiment(manifest(false))).toBe(true);
    expect(connectorSupportsFullLifecycle(manifest(false))).toBe(false);
    expect(connectorSupportsFullLifecycle(manifest(true))).toBe(true);
  });

  it("binds a Connector as the only primary target, invalidates stale downstream state and enables Release only for 7/7",()=>{
    const existingTarget={...demoProject.sourceArtifacts[0]!,id:"uploaded-target",role:"target" as const};
    const project={
      ...structuredClone(demoProject),
      sourceArtifacts:[existingTarget,connectorSource()],
      candidates:[{id:"old-candidate"}] as EvolveProject["candidates"],
      releaseTarget:{provider:"none",mode:"progressive",status:"not-configured",label:"未连接发布平台",healthPath:"/"},
    } as EvolveProject;
    const next=bindConnectorTarget({
      project,manifest:manifest(true),targetId:"workflow-42",useForRelease:true,now:"2026-09-22T04:00:00Z",
    });
    expect(next.targetConnection).toMatchObject({
      adapter:"connector",status:"connected",
      connector:{connectorId:"workflow-main",targetId:"workflow-42"},
    });
    expect(next.sourceArtifacts.some((artifact)=>artifact.id==="connector-old")).toBe(false);
    expect(next.sourceArtifacts.find((artifact)=>artifact.id==="uploaded-target")?.role).toBe("reference");
    expect(next.candidates).toEqual([]);
    expect(next.baselineRun.status).toBe("idle");
    expect(next.releaseTarget).toMatchObject({provider:"connector",mode:"preview-promote",status:"connected"});
    expect(next.gates.find((gate)=>gate.id==="target-ready")?.status).toBe("ready");
  });

  it("keeps experiment-only Connector offline and rejects an unsupported production binding",()=>{
    const project=structuredClone(demoProject) as EvolveProject;
    const offline=bindConnectorTarget({
      project,manifest:manifest(false),targetId:"workflow-42",useForRelease:false,now:"2026-09-22T04:00:00Z",
    });
    expect(offline.targetConnection.adapter).toBe("connector");
    expect(offline.releaseTarget?.provider??"none").not.toBe("connector");
    expect(()=>bindConnectorTarget({
      project,manifest:manifest(false),targetId:"workflow-42",useForRelease:true,
    })).toThrow(/不能作为生产 Release Target/);
  });

  it("disconnects Connector source and Connector release without leaving stale remote Target material",()=>{
    const project=bindConnectorTarget({
      project:{...structuredClone(demoProject),sourceArtifacts:[connectorSource()]} as EvolveProject,
      manifest:manifest(true),targetId:"workflow-42",useForRelease:true,now:"2026-09-22T04:00:00Z",
    });
    const materialized={
      ...project,
      sourceArtifacts:[connectorSource()],
      targetConnection:{
        ...project.targetConnection,
        connectorSnapshot:{
          connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",artifactId:"connector-old",observedAt:"now",
        },
      },
    } as EvolveProject;
    const next=disconnectConnectorTarget(materialized,"2026-09-22T05:00:00Z");
    expect(next.targetConnection.adapter).toBe("artifact");
    expect(next.sourceArtifacts).toEqual([]);
    expect(next.releaseTarget?.provider).toBe("none");
    expect(next.release.status).toBe("idle");
  });
});
