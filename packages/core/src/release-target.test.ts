import { describe,expect,it } from "vitest";
import type { EvolveProject, ReleaseState } from "@evolution/contracts";
import { beginReleaseCycle, projectHasLiveReleaseDecision, projectHasOnlineReleaseTarget, projectReleaseMode, projectUsesConnectorRelease, projectUsesHttpRelease, transitionReleaseTarget } from "./release-target";

const baseRelease:ReleaseState={
  status:"idle",
  trafficPercent:0,
  kpis:[],
  evidenceMode:"none",
  history:[],
};

function switchableProject(status:ReleaseState["status"]="idle"){
  return {
    releaseTarget:{
      provider:"vercel",mode:"preview-promote",status:"connected",
      label:"Vercel · old",projectId:"prj_old",productionUrl:"https://old.example",healthPath:"/",
    },
    release:{
      ...baseRelease,
      status,
      candidateId:"C1",
      trafficPercent:status==="promoted"?100:0,
      evidenceMode:status==="idle"?"none":"live",
      healthy:status==="idle"?undefined:true,
      observationStatus:status==="idle"?undefined:"healthy",
      deploymentId:"dpl-old",
      sourceGitCommitSha:"abc1234",
      sourceGitBranch:"evolve/mission/C1",
      sourceGitRepository:"acme/app",
      sourceGitPullNumber:7,
      sourceGitPullUrl:"https://github.com/acme/app/pull/7",
      kpis:[{key:"latency",label:"Latency",value:120,unit:"ms"}],
      history:[{at:"2026-09-22T01:00:00Z",action:"shadow",note:"old provider"}],
    },
    gates:[
      {id:"target-ready",label:"Target Ready",status:"approved"},
      {id:"release-ready",label:"Release Ready",status:"approved",approvedAt:"2026-09-22T01:00:00Z",note:"old approval"},
    ],
    updatedAt:"2026-09-22T01:00:00Z",
  } as unknown as EvolveProject;
}

describe("release target domain",()=>{
  it("keeps validation target independent from Vercel release target",()=>{
    const project={
      targetConnection:{adapter:"artifact"},
      releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected"},
    } as EvolveProject;
    expect(projectHasOnlineReleaseTarget(project)).toBe(true);
    expect(projectReleaseMode(project)).toBe("preview-promote");
  });

  it("does not mistake an HTTP validation Runner for a Production Release target",()=>{
    const project={
      targetConnection:{adapter:"http",connectionId:"runner-gateway",status:"connected"},
    } as EvolveProject;
    expect(projectUsesHttpRelease(project)).toBe(false);
    expect(projectHasOnlineReleaseTarget(project)).toBe(false);
    expect(projectReleaseMode(project)).toBe("progressive");
  });

  it("keeps explicit HTTP Release independent from the validation target",()=>{
    const project={
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected"},
      releaseTarget:{
        provider:"http",mode:"preview-promote",status:"connected",
        label:"HTTP Release",connectionId:"http-release-proxy",healthPath:"/",
      },
    } as EvolveProject;
    expect(projectUsesHttpRelease(project)).toBe(true);
    expect(projectHasOnlineReleaseTarget(project)).toBe(true);
    expect(projectReleaseMode(project)).toBe("preview-promote");
  });

  it("treats an explicitly configured Connector as an online release target",()=>{
    const project={
      targetConnection:{adapter:"connector",status:"connected",connector:{connectorId:"workflow-main",targetId:"workflow-42"}},
      releaseTarget:{provider:"connector",mode:"preview-promote",status:"connected"},
    } as EvolveProject;
    expect(projectUsesConnectorRelease(project)).toBe(true);
    expect(projectHasOnlineReleaseTarget(project)).toBe(true);
    expect(projectReleaseMode(project)).toBe("preview-promote");
  });

  it("preserves current Release evidence when only non-identity target metadata changes",()=>{
    const project=switchableProject("idle");
    const next=transitionReleaseTarget(project,{
      ...project.releaseTarget!,
      label:"Vercel · renamed",
      projectName:"Renamed Project",
    },"2026-09-22T02:00:00Z");
    expect(next.release).toEqual(project.release);
    expect(next.gates.find((gate)=>gate.id==="release-ready")?.status).toBe("approved");
    expect(next.releaseTarget?.label).toBe("Vercel · renamed");
  });

  it("invalidates all provider-specific Release evidence and Gate D when switching an idle target",()=>{
    const project=switchableProject("idle");
    const next=transitionReleaseTarget(project,{
      provider:"http",mode:"preview-promote",status:"connected",
      label:"HTTP Release",connectionId:"http-release-proxy",healthPath:"/",
    },"2026-09-22T02:00:00Z");
    expect(next.release).toEqual(baseRelease);
    expect(next.releaseTarget).toMatchObject({provider:"http",connectionId:"http-release-proxy"});
    expect(next.gates.find((gate)=>gate.id==="release-ready")).toMatchObject({status:"pending",approvedAt:undefined});
    expect(next.gates.find((gate)=>gate.id==="release-ready")?.note).toContain("重新确认 Release Ready");
  });

  it("allows disconnect after rollback but clears the old provider evidence",()=>{
    const project=switchableProject("rolled-back");
    const next=transitionReleaseTarget(project,{
      provider:"none",mode:"progressive",status:"not-configured",label:"未连接发布平台",healthPath:"/",
    });
    expect(next.release).toEqual(baseRelease);
    expect(next.releaseTarget?.provider).toBe("none");
    expect(next.gates.find((gate)=>gate.id==="release-ready")?.status).toBe("pending");
  });

  it.each(["shadow","canary-20","promoted"] as const)("refuses to orphan a live %s Release by switching providers",(status)=>{
    const project=switchableProject(status);
    expect(()=>transitionReleaseTarget(project,{
      provider:"http",mode:"preview-promote",status:"connected",
      label:"HTTP Release",connectionId:"http-release-proxy",healthPath:"/",
    })).toThrow(/不能静默切换或断开发布平台/);
    expect(project.release.status).toBe(status);
  });

  it("clears orphaned legacy Release evidence when no online target is currently bound",()=>{
    const project=switchableProject("promoted");
    project.releaseTarget=undefined;
    const next=transitionReleaseTarget(project,{
      provider:"http",mode:"preview-promote",status:"connected",
      label:"HTTP Release",connectionId:"http-release-proxy",healthPath:"/",
    });
    expect(next.release).toEqual(baseRelease);
    expect(next.gates.find((gate)=>gate.id==="release-ready")?.status).toBe("pending");
  });

  it("preserves the currently promoted deployment as rollback baseline when a new cycle starts",()=>{
    const current:ReleaseState={
      ...baseRelease,
      status:"promoted",
      candidateId:"candidate-old",
      trafficPercent:100,
      evidenceMode:"live",
      deploymentId:"dpl-stable",
      stableDeploymentId:"dpl-older",
      sourceGitCommitSha:"old-sha",
      sourceGitBranch:"evolve/old",
      sourceGitRepository:"acme/app",
      sourceGitPullNumber:17,
      sourceGitPullUrl:"https://github.com/acme/app/pull/17",
      healthy:true,
    };
    const next=beginReleaseCycle(current,"candidate-new");
    expect(next.status).toBe("idle");
    expect(next.candidateId).toBe("candidate-new");
    expect(next.stableDeploymentId).toBe("dpl-stable");
    expect(next.deploymentId).toBeUndefined();
    expect(next.sourceGitCommitSha).toBeUndefined();
    expect(next.sourceGitBranch).toBeUndefined();
    expect(next.sourceGitRepository).toBeUndefined();
    expect(next.sourceGitPullNumber).toBeUndefined();
    expect(next.sourceGitPullUrl).toBeUndefined();
    expect(next.trafficPercent).toBe(0);
    expect(next.evidenceMode).toBe("none");
  });

  it("requires a real live terminal release decision for online closure",()=>{
    const project={
      targetConnection:{adapter:"http"},
      releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",connectionId:"http-release-proxy",healthPath:"/"},
      experimentRun:{winnerId:"candidate-live"},
      release:{...baseRelease,status:"promoted",candidateId:"candidate-live",evidenceMode:"live",healthy:true,observationStatus:"healthy"},
    } as unknown as EvolveProject;
    expect(projectHasLiveReleaseDecision(project)).toBe(true);
    project.release={...project.release,observationStatus:"observing"};
    expect(projectHasLiveReleaseDecision(project)).toBe(false);
    project.release={...project.release,status:"rolled-back",observationStatus:"healthy"};
    expect(projectHasLiveReleaseDecision(project)).toBe(true);
    project.release={...project.release,healthy:false};
    expect(projectHasLiveReleaseDecision(project)).toBe(false);
    project.release={...project.release,status:"promoted",candidateId:"candidate-old",healthy:true,observationStatus:"healthy"};
    expect(projectHasLiveReleaseDecision(project)).toBe(false);
  });
});
