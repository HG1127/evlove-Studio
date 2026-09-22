import {describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult} from "@evolution/contracts";
import {runServerReleaseOrchestration,type ServerReleasePorts} from "./server-release-orchestration";

type ReleaseAction=NonNullable<ReleaseAdapterResult["effectiveAction"]>;

function fixture(){
  const candidate={id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now"}]} as unknown as Candidate;
  const project={
    id:"mission",version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],
    targetConnection:{adapter:"artifact"},
    releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"},
    experimentRun:{winnerId:"C1"},candidates:[candidate],searchChampion:{candidate},
    gates:[{id:"release-ready",status:"approved"}],
    campaign:{status:"running",schedule:{enabled:false}},
    release:{status:"idle",candidateId:"C1",deploymentId:"dpl-preview",trafficPercent:0,kpis:[],evidenceMode:"none",history:[]},
  } as unknown as EvolveProject;
  return {project,candidate};
}

function httpFixture(){
  const x=fixture();
  x.project.targetConnection={adapter:"http",connectionId:"release-http",status:"connected",label:"HTTP Target"};
  x.project.releaseTarget={provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",healthPath:"/"};
  x.project.release={...x.project.release,deploymentId:undefined,stableDeploymentId:"http-stable"};
  return x;
}

function connectorFixture(){
  const x=fixture();
  x.project.targetConnection={
    adapter:"connector",connectionId:"connector",status:"connected",label:"Connector",
    connector:{connectorId:"workflow-main",targetId:"workflow-42"},
  };
  x.project.releaseTarget={provider:"connector",mode:"preview-promote",status:"connected",label:"Connector Release",healthPath:"/"};
  x.project.release={...x.project.release,deploymentId:undefined,stableDeploymentId:"connector-stable"};
  return x;
}

function receipt(action:ReleaseAction,healthy=true):ReleaseAdapterResult{
  const traffic=action==="canary-5"?5:action==="canary-20"?20:action==="canary-50"?50:action==="promote"?100:0;
  return {
    ok:healthy,trafficPercent:traffic,note:action,healthy,kpis:[],evidenceMode:"live",
    effectiveAction:action,observationStatus:healthy?"healthy":"unhealthy",
    stableDeploymentId:"dpl-stable",deploymentId:action==="rollback"?"dpl-stable":"dpl-preview",
    artifactHashes:action==="rollback"?undefined:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    environment:action==="shadow"?"preview":action.startsWith("canary-")?"production-canary":"production",observedAt:"2026-09-20T15:00:00Z",sampleSize:1,windowMinutes:0.1,
  };
}

function httpReceipt(action:ReleaseAction):ReleaseAdapterResult{
  return{
    ok:true,trafficPercent:action==="promote"?100:0,note:action,healthy:true,kpis:[],evidenceMode:"live",
    effectiveAction:action,observationStatus:"healthy",stableDeploymentId:"http-stable",
    deploymentId:action==="rollback"?"http-stable":"http-candidate",
    artifactHashes:action==="rollback"?undefined:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    environment:action==="shadow"?"preview":"production",observedAt:"2026-09-22T01:00:00Z",sampleSize:1,windowMinutes:1,
  };
}

describe("server release orchestration",()=>{
  it("starts HTTP Release shadow without a fake deploymentId, then binds later steps to the live receipt",async()=>{
    const x=httpFixture();
    const execute=vi.fn(async(args:Parameters<ServerReleasePorts["execute"]>[0])=>httpReceipt(args.action));
    const authorize=vi.fn(async()=>({ok:true}));
    const shadow=await runServerReleaseOrchestration(x.project,{authorize,execute});
    expect(shadow.action).toBe("shadow");
    expect(execute.mock.calls[0]?.[0].deploymentId).toBeUndefined();
    expect(shadow.project.release.deploymentId).toBe("http-candidate");
    const promoted=await runServerReleaseOrchestration(shadow.project,{authorize,execute});
    expect(promoted.action).toBe("promote");
    expect(execute.mock.calls[1]?.[0].deploymentId).toBe("http-candidate");
    expect(promoted.terminal).toBe(true);
  });

  it("starts Connector shadow without a fake deploymentId and then promotes the same live binding",async()=>{
    const x=connectorFixture();
    const execute=vi.fn(async(args:Parameters<ServerReleasePorts["execute"]>[0])=>({
      ...httpReceipt(args.action),
      stableDeploymentId:"connector-stable",
      deploymentId:args.action==="rollback"?"connector-stable":"connector-candidate",
    }));
    const authorize=vi.fn(async()=>({ok:true}));
    const shadow=await runServerReleaseOrchestration(x.project,{authorize,execute});
    expect(shadow.action).toBe("shadow");
    expect(execute.mock.calls[0]?.[0].deploymentId).toBeUndefined();
    expect(shadow.project.release.deploymentId).toBe("connector-candidate");
    const promoted=await runServerReleaseOrchestration(shadow.project,{authorize,execute});
    expect(promoted.action).toBe("promote");
    expect(execute.mock.calls[1]?.[0].deploymentId).toBe("connector-candidate");
    expect(promoted.terminal).toBe(true);
  });

  it("runs preview then promote on the same bound deployment",async()=>{
    const x=fixture();
    const execute=vi.fn(async({action}:{action:ReleaseAction})=>receipt(action));
    const authorize=vi.fn(async()=>({ok:true}));
    const preview=await runServerReleaseOrchestration(x.project,{authorize,execute});
    expect(preview.action).toBe("shadow");
    expect(preview.project.release.status).toBe("shadow");
    const promoted=await runServerReleaseOrchestration(preview.project,{authorize,execute});
    expect(promoted.action).toBe("promote");
    expect(promoted.terminal).toBe(true);
    expect(promoted.project.release.status).toBe("promoted");
    expect(execute.mock.calls[1]?.[0]).toMatchObject({deploymentId:"dpl-preview",stableDeploymentId:"dpl-stable"});
  });

  it("persists unhealthy promote evidence then routes the next step to stable rollback",async()=>{
    const x=fixture();
    const allow=async()=>({ok:true});
    const preview=await runServerReleaseOrchestration(x.project,{authorize:allow,execute:async()=>receipt("shadow")});
    const unhealthy=await runServerReleaseOrchestration(preview.project,{authorize:allow,execute:async()=>receipt("promote",false)});
    expect(unhealthy.control).toBe("continue");
    expect(unhealthy.project.release.status).toBe("promoted");
    expect(unhealthy.project.release.healthy).toBe(false);
    const rollbackAuthorize=vi.fn(async()=>{throw new Error("approval expired");});
    const rolled=await runServerReleaseOrchestration(unhealthy.project,{authorize:rollbackAuthorize,execute:async({action})=>receipt(action)});
    expect(rolled.action).toBe("rollback");
    expect(rolled.terminal).toBe(true);
    expect(rolled.project.release.status).toBe("rolled-back");
    expect(rollbackAuthorize).not.toHaveBeenCalled();
  });

  it("runs progressive shadow → 5 → 20 → 50 → promote as durable steps",async()=>{
    const x=fixture();
    x.project.releaseTarget={...x.project.releaseTarget!,mode:"progressive"};
    const execute=vi.fn(async({action}:{action:ReleaseAction})=>receipt(action));
    const authorize=vi.fn(async()=>({ok:true}));
    let outcome=await runServerReleaseOrchestration(x.project,{authorize,execute});
    expect(outcome.action).toBe("shadow");
    for(const expected of ["canary-5","canary-20","canary-50","promote"] as ReleaseAction[]){
      outcome=await runServerReleaseOrchestration(outcome.project,{authorize,execute});
      expect(outcome.action).toBe(expected);
    }
    expect(outcome.terminal).toBe(true);
    expect(outcome.project.release.status).toBe("promoted");
    expect(execute.mock.calls.map((call)=>call[0].action)).toEqual(["shadow","canary-5","canary-20","canary-50","promote"]);
  });

  it("stops rollout and routes an unhealthy canary to rollback",async()=>{
    const x=fixture();
    x.project.releaseTarget={...x.project.releaseTarget!,mode:"progressive"};
    const allow=async()=>({ok:true});
    const shadow=await runServerReleaseOrchestration(x.project,{authorize:allow,execute:async()=>receipt("shadow")});
    const canary=await runServerReleaseOrchestration(shadow.project,{
      authorize:allow,
      execute:async()=>receipt("canary-5",false),
    });
    expect(canary.project.release.status).toBe("canary-5");
    expect(canary.control).toBe("continue");
    const rollbackAuthorize=vi.fn(async()=>({ok:false}));
    const rolled=await runServerReleaseOrchestration(canary.project,{
      authorize:rollbackAuthorize,
      execute:async({action})=>receipt(action),
    });
    expect(rolled.action).toBe("rollback");
    expect(rolled.project.release.status).toBe("rolled-back");
    expect(rollbackAuthorize).not.toHaveBeenCalled();
  });

  it("does not call the provider without explicit Release authorization and deployment binding",async()=>{
    const x=fixture();
    const execute=vi.fn();
    const authorize=vi.fn(async()=>({ok:true}));
    x.project.gates=[{id:"release-ready",status:"ready"}] as EvolveProject["gates"];
    const unauthorized=await runServerReleaseOrchestration(x.project,{authorize,execute});
    expect(unauthorized.control).toBe("stop");
    expect(execute).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not call the release provider when the durable grant is missing or expired",async()=>{
    const x=fixture();
    const execute=vi.fn();
    const authorize=vi.fn(async()=>({ok:false,reason:"grant expired"}));
    const outcome=await runServerReleaseOrchestration(x.project,{authorize,execute});
    expect(outcome.control).toBe("stop");
    expect(outcome.project.campaign.stopReason).toContain("server-release-authorization-pending");
    expect(outcome.reason).toContain("grant expired");
    expect(execute).not.toHaveBeenCalled();
  });

  it("pauses after an uncertain provider exception instead of automatically replaying production writes",async()=>{
    const x=fixture();
    const outcome=await runServerReleaseOrchestration(x.project,{authorize:async()=>({ok:true}),execute:async()=>{throw new Error("network lost after request");}});
    expect(outcome.control).toBe("stop");
    expect(outcome.project.campaign.status).toBe("paused");
    expect(outcome.project.campaign.stopReason).toContain("server-release-provider-pending");
  });
});
