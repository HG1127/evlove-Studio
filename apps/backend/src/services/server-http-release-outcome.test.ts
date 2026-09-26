// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult} from "@evolution/contracts";

const {grant,record}=vi.hoisted(()=>({
  grant:vi.fn(async()=>({id:"grant"})),
  record:vi.fn(async(_project:EvolveProject,_receipt:ReleaseAdapterResult)=>{void _project;void _receipt;return{recorded:true,inserted:1,reason:"ok",telemetry:{warnings:[]}};}),
}));

vi.mock("./release-approval-store",()=>({getActiveReleaseApprovalGrant:grant}));
vi.mock("./release-outcome-telemetry",()=>({recordHttpReleaseOutcomeObservation:record}));

import {runServerMissionRelease} from "./server-release-orchestration";

const previousUrl=process.env.EVOLUTION_TARGET_RELEASE_URL;

afterEach(()=>{
  if(previousUrl===undefined)delete process.env.EVOLUTION_TARGET_RELEASE_URL;
  else process.env.EVOLUTION_TARGET_RELEASE_URL=previousUrl;
  vi.unstubAllGlobals();
  grant.mockClear();
  record.mockClear();
});

function fixture(){
  const candidate={
    id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[{
      id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now",
    }],
  } as unknown as Candidate;
  return{
    id:"http-release-outcome",version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],
    targetConnection:{adapter:"artifact",connectionId:"artifact-runtime",status:"connected",label:"Artifact Target"},
    releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",connectionId:"release-http",healthPath:"/"},
    experimentRun:{winnerId:"C1"},candidates:[candidate],searchChampion:{candidate},
    gates:[{id:"release-ready",status:"approved"}],
    campaign:{status:"running",schedule:{enabled:false}},
    release:{status:"idle",candidateId:"C1",trafficPercent:0,kpis:[],evidenceMode:"none",history:[]},
  } as unknown as EvolveProject;
}

describe("server HTTP release outcome persistence",()=>{
  it("records a live receipt only after Harness binds it to the exact Mission release state",async()=>{
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://release.internal/action";
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ok:true,trafficPercent:0,note:"shadow healthy",healthy:true,kpis:[],evidenceMode:"live",
      effectiveAction:"shadow",observationStatus:"healthy",deploymentId:"http-candidate",stableDeploymentId:"http-stable",
      artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
      environment:"preview",observedAt:"2026-09-22T02:00:00Z",latencyMs:25,sampleSize:2,windowMinutes:1,
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    const outcome=await runServerMissionRelease(fixture());
    expect(outcome.project.release.observedAt).toBe("2026-09-22T02:00:00Z");
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0].release.deploymentId).toBe("http-candidate");
    expect(record.mock.calls[0]?.[1]).toMatchObject({effectiveAction:"shadow",deploymentId:"http-candidate"});
    expect(outcome.outcomeTelemetry).toMatchObject({status:"recorded",inserted:1});
  });

  it("does not persist an HTTP receipt rejected by exact artifact binding",async()=>{
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://release.internal/action";
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ok:true,trafficPercent:0,note:"wrong artifact",healthy:true,kpis:[],evidenceMode:"live",
      effectiveAction:"shadow",observationStatus:"healthy",deploymentId:"http-candidate",
      artifactHashes:[{sourceArtifactId:"source",contentHash:"wrong"}],
      environment:"preview",observedAt:"2026-09-22T02:01:00Z",
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    const outcome=await runServerMissionRelease(fixture());
    expect(outcome.control).toBe("stop");
    expect(outcome.project.campaign.stopReason).toContain("server-release-receipt-invalid");
    expect(record).not.toHaveBeenCalled();
    expect(outcome.outcomeTelemetry).toBeUndefined();
  });

  it("reports an Outcome write failure without changing the accepted Release",async()=>{
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://release.internal/action";
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ok:true,trafficPercent:0,note:"shadow healthy",healthy:true,kpis:[],evidenceMode:"live",
      effectiveAction:"shadow",observationStatus:"healthy",deploymentId:"http-candidate",stableDeploymentId:"http-stable",
      artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
      environment:"preview",observedAt:"2026-09-22T02:02:00Z",latencyMs:25,sampleSize:2,windowMinutes:1,
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    record.mockRejectedValueOnce(new Error("private database error"));
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
    try{
      const outcome=await runServerMissionRelease(fixture());
      expect(outcome.control).toBe("continue");
      expect(outcome.project.release.observedAt).toBe("2026-09-22T02:02:00Z");
      expect(outcome.outcomeTelemetry).toMatchObject({status:"failed"});
      expect(warn).toHaveBeenCalled();
    }finally{
      warn.mockRestore();
    }
  });
});
