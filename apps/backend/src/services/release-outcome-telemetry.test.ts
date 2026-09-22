// @vitest-environment node
import {describe,expect,it} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult,VercelReleaseObservation} from "@evolution/contracts";
import {buildHttpReleaseOutcomeBatch,buildReleaseOutcomeBatch} from "./release-outcome-telemetry";

function fixture(){
  const candidate={id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[]} as unknown as Candidate;
  return {
    id:"mission-1",
    candidates:[candidate],
    release:{
      status:"canary-20",
      candidateId:"C1",
      deploymentId:"dpl-candidate",
      stableDeploymentId:"dpl-stable",
      trafficPercent:20,
      kpis:[],
      history:[],
    },
  } as unknown as EvolveProject;
}

function observation():VercelReleaseObservation{
  return {
    provider:"vercel",
    checkedAt:"2026-09-21T03:00:00.000Z",
    productionDeployment:{id:"dpl-stable",url:"https://stable.example.com",state:"READY",target:"production"},
    boundDeployment:{id:"dpl-candidate",url:"https://candidate.example.com",state:"READY",target:"preview"},
    productionHealth:{
      ready:true,url:"https://stable.example.com",checkedAt:"2026-09-21T03:00:00.000Z",latencyMs:120,
      checks:[{path:"/health",ok:true,status:200,latencyMs:110}],message:"ok",
    },
    boundHealth:{
      ready:true,url:"https://candidate.example.com",checkedAt:"2026-09-21T03:00:00.000Z",latencyMs:90,
      checks:[{path:"/health",ok:true,status:200,latencyMs:80}],message:"ok",
    },
    rollingRelease:{
      active:true,
      enabled:true,
      advancementType:"manual-approval",
      candidateDeploymentId:"dpl-candidate",
      stableDeploymentId:"dpl-stable",
      currentStageIndex:1,
      currentPercentage:20,
      stages:[{targetPercentage:5},{targetPercentage:20},{targetPercentage:50},{targetPercentage:100}],
    },
    errors:[],
  };
}

describe("release outcome telemetry",()=>{
  it("maps Production stable and bound Candidate into comparable latency/safety samples",()=>{
    const batch=buildReleaseOutcomeBatch(fixture(),observation());
    expect(batch?.missionId).toBe("mission-1");
    expect(batch?.candidateId).toBe("C1");
    expect(batch?.samples).toHaveLength(8);
    expect(batch?.samples).toEqual(expect.arrayContaining([
      expect.objectContaining({arm:"stable",deploymentId:"dpl-stable",metricKey:"latency_ms",segment:"all",value:120}),
      expect.objectContaining({arm:"candidate",deploymentId:"dpl-candidate",metricKey:"latency_ms",segment:"all",value:90}),
      expect.objectContaining({arm:"stable",metricKey:"http_ok",segment:"path:/health",value:1}),
      expect.objectContaining({arm:"candidate",metricKey:"http_ok",segment:"path:/health",value:1}),
    ]));
    expect(batch?.samples.every((sample)=>sample.metadata?.trafficPercent===20)).toBe(true);
    expect(batch?.samples.every((sample)=>sample.metadata?.rollingReleaseActive===true)).toBe(true);
    expect(batch?.samples.every((sample)=>sample.metadata?.rollingStageIndex===1)).toBe(true);
  });

  it("does not double-count a promoted Candidate as both stable and candidate",()=>{
    const project=fixture();
    project.release.stableDeploymentId="dpl-stable";
    const observed=observation();
    observed.productionDeployment={id:"dpl-candidate",url:"https://candidate.example.com",state:"READY",target:"production"};
    observed.productionHealth=observed.boundHealth!;
    const batch=buildReleaseOutcomeBatch(project,observed);
    expect(batch?.samples.every((sample)=>sample.arm==="candidate")).toBe(true);
    expect(new Set(batch?.samples.map((sample)=>sample.id)).size).toBe(batch?.samples.length);
  });

  it("skips unknown deployments instead of inventing arm assignment",()=>{
    const observed=observation();
    observed.productionDeployment={id:"dpl-unknown",url:"https://unknown.example.com",state:"READY",target:"production"};
    const batch=buildReleaseOutcomeBatch(fixture(),observed);
    expect(batch?.samples.some((sample)=>sample.deploymentId==="dpl-unknown")).toBe(false);
    expect(batch?.samples.every((sample)=>sample.arm==="candidate")).toBe(true);
  });

  it("maps an HTTP live receipt into provider-neutral health and latency samples",()=>{
    const project=fixture();
    project.release.status="promoted";
    project.release.trafficPercent=100;
    const receipt={
      ok:true,trafficPercent:100,note:"healthy",healthy:true,kpis:[],evidenceMode:"live",
      effectiveAction:"promote",observationStatus:"healthy",deploymentId:"dpl-candidate",stableDeploymentId:"dpl-stable",
      artifactHashes:[],environment:"production",observedAt:"2026-09-21T03:10:00.000Z",latencyMs:75,sampleSize:10,windowMinutes:2,
    } as ReleaseAdapterResult;
    const batch=buildHttpReleaseOutcomeBatch(project,receipt);
    expect(batch?.samples).toEqual(expect.arrayContaining([
      expect.objectContaining({arm:"candidate",deploymentId:"dpl-candidate",metricKey:"health_ready",value:1,source:"http-release-observation"}),
      expect.objectContaining({arm:"candidate",deploymentId:"dpl-candidate",metricKey:"latency_ms",value:75,source:"http-release-observation"}),
    ]));
    expect(batch?.samples.every((sample)=>sample.metadata?.provider==="http")).toBe(true);
    expect(batch?.samples.every((sample)=>sample.metadata?.sampleSize===10)).toBe(true);
  });

  it("does not invent an HTTP outcome arm for an unknown deployment receipt",()=>{
    const project=fixture();
    const receipt={
      ok:true,trafficPercent:100,note:"healthy",healthy:true,kpis:[],evidenceMode:"live",
      effectiveAction:"promote",deploymentId:"other-deployment",observedAt:"2026-09-21T03:10:00.000Z",
    } as ReleaseAdapterResult;
    expect(buildHttpReleaseOutcomeBatch(project,receipt)).toBeUndefined();
  });
});
