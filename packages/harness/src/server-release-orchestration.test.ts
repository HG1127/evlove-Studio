import {describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult} from "@evolution/contracts";
import {runServerReleaseOrchestration} from "./server-release-orchestration";

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

function receipt(action:"shadow"|"promote"|"rollback",healthy=true):ReleaseAdapterResult{
  return {
    ok:healthy,trafficPercent:action==="promote"?100:0,note:action,healthy,kpis:[],evidenceMode:"live",
    effectiveAction:action,observationStatus:healthy?"healthy":"unhealthy",
    stableDeploymentId:"dpl-stable",deploymentId:action==="rollback"?"dpl-stable":"dpl-preview",
    artifactHashes:action==="rollback"?undefined:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    environment:action==="shadow"?"preview":"production",observedAt:"2026-09-20T15:00:00Z",sampleSize:1,windowMinutes:0.1,
  };
}

describe("server release orchestration",()=>{
  it("runs preview then promote on the same bound deployment",async()=>{
    const x=fixture();
    const execute=vi.fn(async({action}:{action:"shadow"|"promote"|"rollback"})=>receipt(action));
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
