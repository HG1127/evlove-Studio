import { describe,expect,it } from "vitest";
import type { EvolveProject, ReleaseState } from "@evolution/contracts";
import { beginReleaseCycle, projectHasOnlineReleaseTarget, projectReleaseMode } from "./release-target";

const baseRelease:ReleaseState={
  status:"idle",
  trafficPercent:0,
  kpis:[],
  evidenceMode:"none",
  history:[],
};

describe("release target domain",()=>{
  it("keeps validation target independent from Vercel release target",()=>{
    const project={
      targetConnection:{adapter:"artifact"},
      releaseTarget:{provider:"vercel",mode:"preview-promote"},
    } as EvolveProject;
    expect(projectHasOnlineReleaseTarget(project)).toBe(true);
    expect(projectReleaseMode(project)).toBe("preview-promote");
  });

  it("keeps legacy HTTP target release compatible when no dedicated release target exists",()=>{
    const project={
      targetConnection:{adapter:"http"},
    } as EvolveProject;
    expect(projectHasOnlineReleaseTarget(project)).toBe(true);
    expect(projectReleaseMode(project)).toBe("progressive");
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
      healthy:true,
    };
    const next=beginReleaseCycle(current,"candidate-new");
    expect(next.status).toBe("idle");
    expect(next.candidateId).toBe("candidate-new");
    expect(next.stableDeploymentId).toBe("dpl-stable");
    expect(next.deploymentId).toBeUndefined();
    expect(next.trafficPercent).toBe(0);
    expect(next.evidenceMode).toBe("none");
  });
});
