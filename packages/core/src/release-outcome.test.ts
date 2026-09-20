import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {
  PRODUCTION_OUTCOME_FRESHNESS_MS,
  productionOutcomeFreshness,
  projectHasFreshHealthyProductionOutcome,
  releaseAuditTimeline,
} from "./release-outcome";

function project(observedAt?:string):EvolveProject{
  return {
    release:{
      status:"promoted",
      candidateId:"C1",
      deploymentId:"dpl_candidate",
      stableDeploymentId:"dpl_stable",
      trafficPercent:100,
      healthy:true,
      kpis:[],
      evidenceMode:"live",
      observationStatus:"healthy",
      environment:"production",
      observedAt,
      history:[{
        at:"2026-09-20T08:00:00.000Z",
        action:"promote",
        note:"promoted",
        candidateId:"C1",
        deploymentId:"dpl_candidate",
        artifactHashes:[{sourceArtifactId:"source",contentHash:"hash"}],
        evidenceMode:"live",
        environment:"production",
        observedAt:"2026-09-20T08:00:00.000Z",
        healthy:true,
        observationStatus:"healthy",
      }],
    },
  } as unknown as EvolveProject;
}

describe("production outcome freshness",()=>{
  const now=Date.parse("2026-09-20T08:30:00.000Z");

  it("treats an outcome exactly on the 30 minute boundary as fresh",()=>{
    const p=project("2026-09-20T08:00:00.000Z");
    expect(productionOutcomeFreshness(p,{now}).status).toBe("fresh");
    expect(projectHasFreshHealthyProductionOutcome(p,{now})).toBe(true);
  });

  it("marks older production evidence stale without calling it a release failure",()=>{
    const p=project(new Date(now-PRODUCTION_OUTCOME_FRESHNESS_MS-1).toISOString());
    const result=productionOutcomeFreshness(p,{now});
    expect(result.status).toBe("stale");
    expect(result.reason).toContain("freshness");
    expect(projectHasFreshHealthyProductionOutcome(p,{now})).toBe(false);
  });

  it("returns unknown when the mission has no production observation timestamp",()=>{
    expect(productionOutcomeFreshness(project(undefined),{now}).status).toBe("unknown");
  });

  it("builds a newest-first audit timeline and includes current recovery state",()=>{
    const p=project("2026-09-20T08:00:00.000Z");
    p.release.recovery={status:"manual-check",action:"promote",reason:"unknown production",at:"2026-09-20T08:05:00.000Z",lastObservedAt:"2026-09-20T08:06:00.000Z"};
    const timeline=releaseAuditTimeline(p);
    expect(timeline[0]).toMatchObject({source:"recovery",action:"recovery:manual-check"});
    expect(timeline[1]).toMatchObject({source:"history",candidateId:"C1",deploymentId:"dpl_candidate"});
  });
});
