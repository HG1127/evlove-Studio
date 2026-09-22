// @vitest-environment node
import {describe,expect,it} from "vitest";
import type {EvolveProject,OutcomeMetricBatchRequest} from "@evolution/contracts";
import {PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS} from "@evolution/core";
import {bindOutcomeMetricBatchToMission,resolveOutcomeAnalysisCandidate} from "./outcome-ingestion";

const now=Date.parse("2026-09-22T08:00:00.000Z");

function mission(){
  return{
    id:"mission-outcome",
    release:{
      status:"canary-20",candidateId:"C1",deploymentId:"dpl-candidate",stableDeploymentId:"dpl-stable",
      trafficPercent:20,kpis:[],evidenceMode:"live",history:[],
    },
  } as unknown as EvolveProject;
}

function batch():OutcomeMetricBatchRequest{
  return{
    missionId:"mission-outcome",candidateId:"C1",
    samples:[
      {arm:"stable",candidateId:"C1",deploymentId:"dpl-stable",metricKey:"conversion",metricKind:"business",direction:"higher",value:.2,segment:"all",source:"manual",observedAt:"2026-09-22T07:59:00.000Z",metadata:{}},
      {arm:"candidate",deploymentId:"dpl-candidate",metricKey:"conversion",metricKind:"business",direction:"higher",value:.25,segment:"all",source:"manual",observedAt:"2026-09-22T07:59:30.000Z",metadata:{}},
    ],
  };
}

describe("Outcome ingestion Mission binding",()=>{
  it("normalizes missing sample candidate identity only after exact Release deployment binding",()=>{
    const bound=bindOutcomeMetricBatchToMission(mission(),batch(),{now});
    expect(bound.candidateId).toBe("C1");
    expect(bound.samples).toEqual([
      expect.objectContaining({arm:"stable",candidateId:"C1",deploymentId:"dpl-stable"}),
      expect.objectContaining({arm:"candidate",candidateId:"C1",deploymentId:"dpl-candidate"}),
    ]);
  });

  it("rejects batch/sample candidate drift and arm/deployment relabeling",()=>{
    const wrongBatch={...batch(),candidateId:"C2"};
    expect(()=>bindOutcomeMetricBatchToMission(mission(),wrongBatch,{now})).toThrow(/batch candidateId/);
    const wrongSample=batch();wrongSample.samples[0]={...wrongSample.samples[0]!,candidateId:"C2"};
    expect(()=>bindOutcomeMetricBatchToMission(mission(),wrongSample,{now})).toThrow(/sample 0 candidateId/);
    const wrongDeployment=batch();wrongDeployment.samples[1]={...wrongDeployment.samples[1]!,deploymentId:"dpl-stable"};
    expect(()=>bindOutcomeMetricBatchToMission(mission(),wrongDeployment,{now})).toThrow(/candidate deployment/);
  });

  it("requires the single promoted/rolled-back deployment to use its truthful arm",()=>{
    const promoted=mission();promoted.release.status="promoted";promoted.release.stableDeploymentId="dpl-candidate";
    const promotedBatch=batch();promotedBatch.samples=[{...promotedBatch.samples[1]!,arm:"candidate",deploymentId:"dpl-candidate"}];
    expect(()=>bindOutcomeMetricBatchToMission(promoted,promotedBatch,{now})).not.toThrow();
    promotedBatch.samples=[{...promotedBatch.samples[0]!,arm:"stable",deploymentId:"dpl-candidate"}];
    expect(()=>bindOutcomeMetricBatchToMission(promoted,promotedBatch,{now})).toThrow(/single active deployment role candidate/);

    const rolled=mission();rolled.release.status="rolled-back";rolled.release.deploymentId="dpl-stable";rolled.release.stableDeploymentId="dpl-stable";
    const rolledBatch=batch();rolledBatch.samples=[{...rolledBatch.samples[0]!,arm:"stable",deploymentId:"dpl-stable"}];
    expect(()=>bindOutcomeMetricBatchToMission(rolled,rolledBatch,{now})).not.toThrow();
  });

  it("rejects invalid or materially future timestamps",()=>{
    const invalid=batch();invalid.samples[0]={...invalid.samples[0]!,observedAt:"not-a-date"};
    expect(()=>bindOutcomeMetricBatchToMission(mission(),invalid,{now})).toThrow(/observedAt is invalid/);
    const future=batch();future.samples[0]={...future.samples[0]!,observedAt:new Date(now+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS+1).toISOString()};
    expect(()=>bindOutcomeMetricBatchToMission(mission(),future,{now})).toThrow(/future clock skew/);
  });

  it("rejects incomparable Stable/Candidate metric contracts in the same batch",()=>{
    const wrongUnit=batch();
    wrongUnit.samples[1]={...wrongUnit.samples[1]!,unit:"percent"};
    wrongUnit.samples[0]={...wrongUnit.samples[0]!,unit:"ratio"};
    expect(()=>bindOutcomeMetricBatchToMission(mission(),wrongUnit,{now}))
      .toThrow(/inconsistent kind\/direction\/unit\/source/);

    const wrongSource=batch();
    wrongSource.samples[1]={...wrongSource.samples[1]!,source:"other-source"};
    expect(()=>bindOutcomeMetricBatchToMission(mission(),wrongSource,{now}))
      .toThrow(/inconsistent kind\/direction\/unit\/source/);
  });

  it("defaults analysis to current Release Candidate while preserving explicit historical candidate analysis",()=>{
    expect(resolveOutcomeAnalysisCandidate(mission())).toBe("C1");
    expect(resolveOutcomeAnalysisCandidate(mission(),"C0")).toBe("C0");
    const noCurrent=mission();noCurrent.release.candidateId=undefined;
    expect(()=>resolveOutcomeAnalysisCandidate(noCurrent)).toThrow(/candidateId is required/);
  });
});
