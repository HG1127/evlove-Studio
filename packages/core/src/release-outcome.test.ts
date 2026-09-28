import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {
  appendReleaseObservation,
  PRODUCTION_OUTCOME_MIN_HEALTHY_STREAK,
  PRODUCTION_OUTCOME_FRESHNESS_MS,
  PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS,
  productionOutcomeFreshness,
  productionOutcomeTrend,
  projectHasFreshHealthyProductionOutcome,
  projectHasStableHealthyProductionOutcome,
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

  it("rejects future production timestamps beyond the allowed clock skew",()=>{
    const future=new Date(now+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS+1).toISOString();
    const p=project(future);
    const result=productionOutcomeFreshness(p,{now});
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("时钟漂移");
    expect(projectHasFreshHealthyProductionOutcome(p,{now})).toBe(false);
  });

  it("tolerates small clock skew without converting it into negative age",()=>{
    const p=project(new Date(now+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS).toISOString());
    const result=productionOutcomeFreshness(p,{now});
    expect(result.status).toBe("fresh");
    expect(result.ageMs).toBe(0);
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

  it("deduplicates identical observations and enforces retention/count bounds",()=>{
    const first={
      source:"reconcile" as const,action:"reconcile" as const,at:"2026-09-20T08:00:00.000Z",
      candidateId:"C1",deploymentId:"dpl_candidate",evidenceMode:"live" as const,environment:"production",
      healthy:true,observationStatus:"healthy" as const,reason:"ok",
    };
    let ledger=appendReleaseObservation([],first,{maxEntries:3,retentionMs:60*60*1000});
    ledger=appendReleaseObservation(ledger,first,{maxEntries:3,retentionMs:60*60*1000});
    expect(ledger).toHaveLength(1);
    for(let minute=1;minute<=4;minute++){
      ledger=appendReleaseObservation(ledger,{...first,at:`2026-09-20T08:0${minute}:00.000Z`},{maxEntries:3,retentionMs:60*60*1000});
    }
    expect(ledger).toHaveLength(3);
    expect(ledger.map((item)=>item.at)).toEqual([
      "2026-09-20T08:02:00.000Z","2026-09-20T08:03:00.000Z","2026-09-20T08:04:00.000Z",
    ]);
  });

  it("drops observations outside the retention window when a new observation arrives",()=>{
    const current=[{
      id:"old",
      source:"reconcile" as const,action:"reconcile" as const,at:"2026-09-10T08:00:00.000Z",
      candidateId:"C1",deploymentId:"dpl_candidate",evidenceMode:"live" as const,environment:"production",
      healthy:true,observationStatus:"healthy" as const,reason:"old health",
    }];
    const ledger=appendReleaseObservation(current,{
      source:"reconcile",action:"reconcile",at:"2026-09-20T08:00:00.000Z",
      candidateId:"C1",deploymentId:"dpl_candidate",evidenceMode:"live",environment:"production",
      healthy:true,observationStatus:"healthy",reason:"new health",
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.at).toBe("2026-09-20T08:00:00.000Z");
  });

  it("requires consecutive healthy observations before treating production as stable",()=>{
    const p=project("2026-09-20T08:29:00.000Z");
    p.release.observations=[];
    p.release.observations=appendReleaseObservation(p.release.observations,{
      source:"release-action",action:"promote",at:"2026-09-20T08:28:00.000Z",
      candidateId:"C1",deploymentId:"dpl_candidate",evidenceMode:"live",environment:"production",
      healthy:true,observationStatus:"healthy",reason:"promote health",
    });
    expect(PRODUCTION_OUTCOME_MIN_HEALTHY_STREAK).toBe(2);
    expect(productionOutcomeTrend(p,{now}).status).toBe("healthy-insufficient");
    expect(projectHasStableHealthyProductionOutcome(p,{now})).toBe(false);
    p.release.observations=appendReleaseObservation(p.release.observations,{
      source:"reconcile",action:"reconcile",at:"2026-09-20T08:29:00.000Z",
      candidateId:"C1",deploymentId:"dpl_candidate",evidenceMode:"live",environment:"production",
      healthy:true,observationStatus:"healthy",reason:"refresh health",
    });
    expect(productionOutcomeTrend(p,{now}).status).toBe("stable-healthy");
    expect(projectHasStableHealthyProductionOutcome(p,{now})).toBe(true);
  });

  it("does not count a prior Candidate on the same Deployment toward current stability",()=>{
    const p=project("2026-09-20T08:29:00.000Z");
    const base={
      source:"reconcile" as const,action:"reconcile" as const,deploymentId:"dpl_candidate",
      evidenceMode:"live" as const,environment:"production",healthy:true,observationStatus:"healthy" as const,reason:"health",
    };
    p.release.observations=[
      {...base,id:"old-1",candidateId:"C-old",at:"2026-09-20T08:27:00.000Z"},
      {...base,id:"old-2",candidateId:"C-old",at:"2026-09-20T08:28:00.000Z"},
      {...base,id:"current",candidateId:"C1",at:"2026-09-20T08:29:00.000Z"},
    ];
    const trend=productionOutcomeTrend(p,{now});
    expect(trend.status).toBe("healthy-insufficient");
    expect(trend.healthyStreak).toBe(1);
    expect(trend.observations).toBe(1);
    expect(projectHasStableHealthyProductionOutcome(p,{now})).toBe(false);
  });
  it("does not count far-future observations toward the stable healthy streak",()=>{
    const p=project("2026-09-20T08:29:00.000Z");
    const base={
      source:"reconcile" as const,action:"reconcile" as const,candidateId:"C1",deploymentId:"dpl_candidate",
      evidenceMode:"live" as const,environment:"production",healthy:true,observationStatus:"healthy" as const,reason:"health",
    };
    p.release.observations=[
      {...base,id:"valid",at:"2026-09-20T08:29:00.000Z"},
      {...base,id:"future",at:"2026-09-20T08:40:00.000Z"},
    ];
    const trend=productionOutcomeTrend(p,{now});
    expect(trend.status).toBe("healthy-insufficient");
    expect(trend.healthyStreak).toBe(1);
    expect(trend.observations).toBe(1);
  });

  it("detects degrading and flapping production trends",()=>{
    const p=project("2026-09-20T08:29:00.000Z");
    const base={
      source:"reconcile" as const,action:"reconcile" as const,candidateId:"C1",deploymentId:"dpl_candidate",
      evidenceMode:"live" as const,environment:"production",reason:"health",
    };
    p.release.observations=[
      {...base,id:"u1",at:"2026-09-20T08:28:00.000Z",healthy:false,observationStatus:"unhealthy"},
      {...base,id:"u2",at:"2026-09-20T08:29:00.000Z",healthy:false,observationStatus:"unhealthy"},
    ];
    p.release.healthy=false;
    p.release.observationStatus="unhealthy";
    expect(productionOutcomeTrend(p,{now}).status).toBe("degrading");

    p.release.healthy=true;
    p.release.observationStatus="healthy";
    p.release.observations=[
      {...base,id:"h1",at:"2026-09-20T08:26:00.000Z",healthy:true,observationStatus:"healthy"},
      {...base,id:"u3",at:"2026-09-20T08:27:00.000Z",healthy:false,observationStatus:"unhealthy"},
      {...base,id:"h2",at:"2026-09-20T08:29:00.000Z",healthy:true,observationStatus:"healthy"},
    ];
    expect(productionOutcomeTrend(p,{now}).status).toBe("flapping");
  });
});
