// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,VercelReleaseObservation} from "@evolution/contracts";
import {collectConfiguredOutcomeTelemetry,getOutcomeTelemetryConfigState} from "./outcome-telemetry-source";
import {analyzeOutcomeSamples} from "@evolution/core";

const originalTelemetry=process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON;
const originalToken=process.env.PRODUCT_METRICS_TOKEN;

function restore(name:string,value:string|undefined){
  if(value===undefined)delete process.env[name];
  else process.env[name]=value;
}

function fixture(){
  const candidate={id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[]} as unknown as Candidate;
  return {
    id:"mission-telemetry",
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
    productionHealth:{ready:true,url:"https://stable.example.com",checkedAt:"2026-09-21T03:00:00.000Z",latencyMs:100,checks:[],message:"ok"},
    boundDeployment:{id:"dpl-candidate",url:"https://candidate.example.com",state:"READY",target:"preview"},
    errors:[],
  };
}

beforeEach(()=>{
  delete process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON;
  delete process.env.PRODUCT_METRICS_TOKEN;
});

afterEach(()=>{
  restore("EVOLUTION_OUTCOME_TELEMETRY_JSON",originalTelemetry);
  restore("PRODUCT_METRICS_TOKEN",originalToken);
  vi.unstubAllGlobals();
});

describe("outcome telemetry source",()=>{
  const configureTasks=()=>{process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
    id:"tasks",urlTemplate:"https://metrics.example.com/{deploymentId}",
    sampling:{kind:"independent-task",recordsPath:"tasks",taskIdPath:"id",observedAtPath:"completedAt",deploymentIdPath:"deployment"},
    metrics:[{metricKey:"acceptance_rate",metricKind:"business",direction:"higher",path:"accepted",unit:"ratio"}],
  }]);};
  it("keeps task identities stable across polls and release traffic changes",async()=>{
    configureTasks();
    vi.stubGlobal("fetch",vi.fn(async(input:string|URL|Request)=>{
      const deployment=decodeURIComponent(new URL(String(input)).pathname.slice(1)),stable=deployment==="dpl-stable";
      return new Response(JSON.stringify({tasks:Array.from({length:30},(_,i)=>({id:deployment+"-task-"+i,completedAt:"2026-09-21T00:00:00Z",deployment,accepted:stable?i<15:i<27}))}));
    }));
    const project=fixture(),first=await collectConfiguredOutcomeTelemetry(project,observation());
    project.release.trafficPercent=50;project.release.status="canary-50";
    const second=await collectConfiguredOutcomeTelemetry(project,{...observation(),checkedAt:"2026-09-21T04:00:00Z"});
    expect(first.samples).toHaveLength(60);expect(second.samples).toEqual(first.samples);
    const result=analyzeOutcomeSamples({missionId:project.id,candidateId:"C1",minimumSamplesPerArm:30,
      samples:[...first.samples,...second.samples].map(sample=>({...sample,id:sample.id!,missionId:project.id,workspaceId:"workspace"}))});
    expect(result).toMatchObject({verdict:"healthy",independentSampleCount:60,excludedSampleCount:60});
    expect(result.metrics[0]).toMatchObject({stable:{count:30},candidate:{count:30}});
  });
  it.each(["missing-id","invalid-time","wrong-deployment","conflicting-record"])("does not invent task identity for %s",async(kind)=>{
    configureTasks();
    vi.stubGlobal("fetch",vi.fn(async(input:string|URL|Request)=>{
      const deployment=decodeURIComponent(new URL(String(input)).pathname.slice(1));
      const row={id:kind==="missing-id"?undefined:deployment+"-task",completedAt:kind==="invalid-time"?"not-a-time":"2026-09-21T00:00:00Z",deployment:kind==="wrong-deployment"?"other":deployment,accepted:true};
      return new Response(JSON.stringify({tasks:kind==="conflicting-record"?[row,{...row,accepted:false}]:[row]}));
    }));
    const result=await collectConfiguredOutcomeTelemetry(fixture(),observation());
    expect(result.samples).toEqual([]);expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("does not treat an explicitly empty source list as ready telemetry",()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON="[]";
    const state=getOutcomeTelemetryConfigState();
    expect(state.configured).toBe(true);
    expect(state.ready).toBe(false);
    expect(state.errors.length).toBeGreaterThan(0);
  });

  it("fails readiness when a configured credential env is missing",()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"business",
      urlTemplate:"https://metrics.example.com/{deploymentId}",
      auth:{type:"bearer",env:"PRODUCT_METRICS_TOKEN"},
      metrics:[{metricKey:"conversion_rate",metricKind:"business",direction:"higher",path:"metrics.conversionRate"}],
    }]);
    const state=getOutcomeTelemetryConfigState();
    expect(state.configured).toBe(true);
    expect(state.ready).toBe(false);
    expect(state.errors.join(" ")).toContain("PRODUCT_METRICS_TOKEN");
  });

  it("rejects multi-arm telemetry that cannot distinguish Stable from Candidate",()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"global-metrics",
      urlTemplate:"https://metrics.example.com/global?mission={missionId}",
      metrics:[{metricKey:"conversion_rate",metricKind:"business",direction:"higher",path:"conversion"}],
    }]);
    const state=getOutcomeTelemetryConfigState();
    expect(state.configured).toBe(true);
    expect(state.ready).toBe(false);
    expect(state.errors.join(" ")).toContain("multi-arm telemetry requires");
  });

  it("pulls stable and candidate business/cost metrics with explicit metric semantics",async()=>{
    process.env.PRODUCT_METRICS_TOKEN="secret-token";
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"product",
      urlTemplate:"https://metrics.example.com/release?deployment={deploymentId}&arm={arm}",
      auth:{type:"bearer",env:"PRODUCT_METRICS_TOKEN"},
      metrics:[
        {metricKey:"conversion_rate",metricKind:"business",direction:"higher",path:"metrics.conversionRate",unit:"ratio"},
        {metricKey:"cost_per_request",metricKind:"cost",direction:"lower",path:"metrics.costPerRequest",unit:"usd"},
      ],
    }]);
    const fetchMock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      const url=new URL(String(input));
      expect(init?.headers).toMatchObject({Authorization:"Bearer secret-token"});
      const candidate=url.searchParams.get("arm")==="candidate";
      return new Response(JSON.stringify({metrics:{
        conversionRate:candidate?0.24:0.2,
        costPerRequest:candidate?0.08:0.1,
      }}),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);

    const result=await collectConfiguredOutcomeTelemetry(fixture(),observation());
    expect(result.ready).toBe(true);
    expect(result.requestCount).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.samples).toHaveLength(4);
    expect(result.samples).toEqual(expect.arrayContaining([
      expect.objectContaining({arm:"stable",metricKey:"conversion_rate",metricKind:"business",direction:"higher",value:0.2}),
      expect.objectContaining({arm:"candidate",metricKey:"conversion_rate",metricKind:"business",direction:"higher",value:0.24}),
      expect.objectContaining({arm:"stable",metricKey:"cost_per_request",metricKind:"cost",direction:"lower",value:0.1}),
      expect.objectContaining({arm:"candidate",metricKey:"cost_per_request",metricKind:"cost",direction:"lower",value:0.08}),
    ]));
  });

  it("is fail-soft when a metric path is missing",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"safety",
      urlTemplate:"https://metrics.example.com/{deploymentId}",
      arms:["candidate"],
      metrics:[{metricKey:"error_rate",metricKind:"safety",direction:"lower",path:"missing.errorRate"}],
    }]);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({metrics:{errorRate:0.01}}),{status:200})));

    const result=await collectConfiguredOutcomeTelemetry(fixture(),observation());
    expect(result.requestCount).toBe(1);
    expect(result.samples).toEqual([]);
    expect(result.warnings.join(" ")).toContain("missing or non-numeric");
  });

  it("collects HTTP provider telemetry by deployment id without requiring a deployment URL",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"http-product",
      urlTemplate:"https://metrics.example.com/{deploymentId}?arm={arm}",
      arms:["candidate"],
      metrics:[{metricKey:"conversion_rate",metricKind:"business",direction:"higher",path:"conversion"}],
    }]);
    vi.stubGlobal("fetch",vi.fn(async(input:string|URL|Request)=>{
      expect(String(input)).toContain("dpl-candidate");
      return new Response(JSON.stringify({conversion:0.31}),{status:200,headers:{"Content-Type":"application/json"}});
    }));
    const result=await collectConfiguredOutcomeTelemetry(fixture(),{
      observedAt:"2026-09-21T03:15:00.000Z",
      trafficPercent:20,
      rollingReleaseActive:true,
    });
    expect(result.requestCount).toBe(1);
    expect(result.samples).toEqual([
      expect.objectContaining({arm:"candidate",deploymentId:"dpl-candidate",metricKey:"conversion_rate",value:0.31,observedAt:"2026-09-21T03:15:00.000Z"}),
    ]);
  });

  it("warns instead of inventing a deployment URL for HTTP telemetry",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"url-required",
      urlTemplate:"https://metrics.example.com/?target={deploymentUrl}",
      arms:["candidate"],
      metrics:[{metricKey:"conversion_rate",metricKind:"business",direction:"higher",path:"conversion"}],
    }]);
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    const result=await collectConfiguredOutcomeTelemetry(fixture(),{observedAt:"2026-09-21T03:15:00.000Z"});
    expect(result.requestCount).toBe(0);
    expect(result.samples).toEqual([]);
    expect(result.warnings.join(" ")).toContain("deploymentUrl");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
