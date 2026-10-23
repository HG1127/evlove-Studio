import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,missionEnvelope,type EvolveProject} from "@evolution/contracts";
import {demoProject} from "../data/mock-project";
import {inspectServerMissionControl} from "./server-mission-control-client";

const id="audit-evolution-existing-html";
const now="2026-10-21T04:00:00.000Z";
const project={
  ...demoProject,id,
  campaign:{...demoProject.campaign,status:"idle" as const,currentRound:0},
  candidates:[],outputArtifacts:[],
} as EvolveProject;
const envelope=missionEnvelope(project,3);
function job(status:"queued"|"running"|"waiting"|"completed"|"failed",runId?:string){
  return EvolutionJobSchema.parse({
    schemaVersion:"job-v1",id:"workflow-control-old",missionId:id,
    type:"campaign",status,label:"Existing HTML audit",
    idempotencyKey:"workflow-control:"+id+":audit-html-existing",
    generation:1,attempts:0,priority:70,
    ...(runId?{outputRef:runId}:{}),
    createdAt:now,updatedAt:now,
  });
}
function server(jobs:ReturnType<typeof job>[],workflow?:{exists:boolean;status?:string}){
  const requests:string[]=[];
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);
    requests.push(url);
    if(url.startsWith("/api/evolution/missions/")){
      return new Response(JSON.stringify(envelope),{status:200});
    }
    if(url.startsWith("/api/evolution/jobs?")){
      return new Response(JSON.stringify(jobs),{status:200});
    }
    if(url.startsWith("/api/evolution/status?")){
      return new Response(JSON.stringify({
        workflow,job:jobs[0],events:[],
      }),{status:200});
    }
    throw new Error("Unexpected request "+url);
  });
  vi.stubGlobal("fetch",fetcher);
  return {requests,fetcher};
}
afterEach(()=>vi.unstubAllGlobals());

describe("read-only authenticated Mission status must precede HTML start controls",()=>{
  it("reports an already-running durable Workflow even when cached UI says waiting to start",async()=>{
    const data=server([job("running","wrun-existing")],{exists:true,status:"running"});
    const observed=await inspectServerMissionControl(id);
    expect(observed).toMatchObject({
      missionId:id,revision:3,
      state:"active",campaignStatus:"idle",
      latestJob:{status:"running",id:"workflow-control-old"},
      runId:"wrun-existing",workflowStatus:"running",
    });
    expect(observed.reason).toContain("禁止再次启动");
    expect(data.requests).toHaveLength(3);
    expect(data.requests.every(path=>path.startsWith("/api/evolution/"))).toBe(true);
  });
  it("allows start only on an authenticated empty durable Mission with no prior Job",async()=>{
    server([]);
    const observed=await inspectServerMissionControl(id);
    expect(observed.state).toBe("ready");
    expect(observed.revision).toBe(3);
    expect(observed.latestJob).toBeUndefined();
  });
  it("blocks legacy Campaign receipts whose idempotency key differs from workflow-control",async()=>{
    const legacy=EvolutionJobSchema.parse({
      ...job("waiting"),id:"legacy-campaign-waiting",idempotencyKey:"legacy-import:existing-run",
    });
    server([legacy]);
    const observed=await inspectServerMissionControl(id);
    expect(observed).toMatchObject({
      state:"active",latestJob:{id:"legacy-campaign-waiting",status:"waiting"},
    });
    expect(observed.reason).toContain("禁止再次启动");
  });
  it("requires manual checkpoint review for an old terminal Job, never infers a new start",async()=>{
    server([job("failed","wrun-terminal")],{exists:true,status:"failed"});
    const observed=await inspectServerMissionControl(id);
    expect(observed.state).toBe("needs-review");
    expect(observed.runId).toBe("wrun-terminal");
  });
  it("fails closed on absent workflow status or lost Job binding",async()=>{
    server([job("waiting","wrun-unavailable")],{exists:false});
    expect((await inspectServerMissionControl(id)).state).toBe("active");
    server([job("completed")]);
    expect((await inspectServerMissionControl(id)).state).toBe("needs-review");
  });
  it("cancels both parallel Mission/Job reads when the route is refreshed or unmounted",async()=>{
    const controller=new AbortController();
    const fetcher=vi.fn((_input:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      const signal=init?.signal;
      signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
    }));
    vi.stubGlobal("fetch",fetcher);
    const pending=inspectServerMissionControl(id,controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(pending).rejects.toMatchObject({name:"AbortError"});
    expect(fetcher.mock.calls.every(([,init])=>init?.signal?.aborted)).toBe(true);
  });
  it("does not read without a valid Operator Session or invent server state",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusMessage:"需要先建立可信操作员身份",
    }),{status:401})));
    await expect(inspectServerMissionControl(id)).rejects.toThrow("连接后端工作区");
  });
});
