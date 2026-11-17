// @vitest-environment node
import {readFileSync} from "node:fs";
import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolveProjectSchema,missionEnvelope} from "@evolution/contracts";
import {P3X_MISSION_ID,P3X_BLOB_ID} from "./p3x-source-binding";
import {P3X_SINGLE_RUN_KEY,startAuthorizedP3XSmoke} from "./p3x-smoke-start";

const fixture=EvolveProjectSchema.parse(JSON.parse(readFileSync("tests/fixtures/p3x-synthetic-task-board/mission.template.json","utf8")));
const base=EvolveProjectSchema.parse({...fixture,sourceArtifacts:[{...fixture.sourceArtifacts[0]!,storageRef:P3X_BLOB_ID}]});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
type Scenario={blocked?:string;sourceUnbound?:boolean;quotaLow?:boolean;quotaStale?:boolean;authFail?:boolean;startStatus?:number};
const make=(args:Scenario={})=>{
  const calls:Array<{url:string;method:string;body?:Record<string,unknown>}>=[];
  const fetcher=vi.fn(async(url:string,init:RequestInit={})=>{
    const method=init.method??"GET";
    const body=typeof init.body==="string"?JSON.parse(init.body):undefined;
    calls.push({url,method,body});
    if(args.authFail)return json({data:{code:"UNAUTHORIZED"}},401);
    if(url==="/api/evolution/lab-job-integrity")
      return json({mode:"read-only",status:args.blocked==="integrity"?"blocked":"clear",issues:args.blocked==="integrity"?[{}]:[]});
    if(url==="/api/evolution/missions/"+P3X_MISSION_ID){
      const payload=args.sourceUnbound?EvolveProjectSchema.parse({...base,sourceArtifacts:[{...base.sourceArtifacts[0]!,storageRef:undefined}]}):base;
      return json(missionEnvelope(payload,2));
    }
    if(url==="/api/evolution/lab-three-generation-readiness")
      return json({mode:"read-only",status:args.blocked==="ready"?"blocked":"preflight-clear",
        blockers:args.blocked==="ready"?["LAB_EXPERIMENT_NOT_ARMED"]:[],
        approvedMissionConfigured:true,missionReady:true});
    if(url==="/api/evolution/minimax-subscription-quota"){
      const observed=new Date(Date.now()-(args.quotaStale?62_000:0)).toISOString();
      const row=(model:string)=>({model,quota:{
        intervalRemainingPercent:args.quotaLow?49:57,weeklyRemainingPercent:96,
        intervalStatus:1,weeklyStatus:1,observedAt:observed,
      }});
      return json({provider:"minimax-m-plan",status:"verified",checkedAt:new Date().toISOString(),
        roles:{generation:row("MiniMax-M3"),judge:row("MiniMax-M3.1-Flash")}});
    }
    if(url==="/api/evolution/start"&&method==="POST")
      return args.startStatus?json({data:{code:"HTML_SANDBOX_NOT_READY"}},args.startStatus)
        :json({missionId:P3X_MISSION_ID,controlJobId:"workflow-control-test-1",runId:"run-test-1",status:"queued"});
    throw Error("Unexpected API call "+method+" "+url);
  });
  vi.stubGlobal("fetch",fetcher);
  return {calls,fetcher};
};
afterEach(()=>vi.unstubAllGlobals());
describe("P3-X isolated single generation authorized and budgeted startup",()=>{
  it("passes only exact approved Mission, fixed idempotency key, explicit permission to existing server endpoint",async()=>{
    const x=make();
    await expect(startAuthorizedP3XSmoke()).resolves.toMatchObject({
      missionId:P3X_MISSION_ID,controlJobId:"workflow-control-test-1",runId:"run-test-1"});
    expect(x.calls.map(x=>x.method+" "+x.url)).toEqual([
      "GET /api/evolution/lab-job-integrity",
      "GET /api/evolution/missions/"+P3X_MISSION_ID,
      "GET /api/evolution/lab-three-generation-readiness",
      "GET /api/evolution/minimax-subscription-quota",
      "POST /api/evolution/start",
    ]);
    expect(x.calls.at(-1)?.body).toEqual({
      missionId:P3X_MISSION_ID,idempotencyKey:P3X_SINGLE_RUN_KEY,
      labExperimentApproval:"explicit-synthetic-lab-v1",
    });
  });
  it("blocks unverified Lab global Job integrity before entering Mission",async()=>{
    const x=make({blocked:"integrity"});
    await expect(startAuthorizedP3XSmoke()).rejects.toThrow(/Job 完整性未通过/);
    expect(x.calls).toHaveLength(1);
  });
  it("blocks unbound frozen HTML and does not read quotas",async()=>{
    const x=make({sourceUnbound:true});
    await expect(startAuthorizedP3XSmoke()).rejects.toThrow(/冻结原版/);
    expect(x.calls).toHaveLength(2);
  });
  it("blocks missing precise armed Mission on backend readiness",async()=>{
    const x=make({blocked:"ready"});
    await expect(startAuthorizedP3XSmoke()).rejects.toThrow(/LAB_EXPERIMENT_NOT_ARMED/);
    expect(x.calls.map(x=>x.url)).not.toContain("/api/evolution/start");
  });
  it("blocks MiniMax five-hour quota below 50%",async()=>{
    const x=make({quotaLow:true});
    await expect(startAuthorizedP3XSmoke()).rejects.toThrow(/额度/);
    expect(x.calls.map(x=>x.url)).not.toContain("/api/evolution/start");
  });
  it("blocks quota snapshots over 30 seconds old",async()=>{
    const x=make({quotaStale:true});
    await expect(startAuthorizedP3XSmoke()).rejects.toThrow(/额度/);
    expect(x.calls.map(x=>x.url)).not.toContain("/api/evolution/start");
  });
  it("does not retry on unauthenticated admin request",async()=>{
    const x=make({authFail:true});
    await expect(startAuthorizedP3XSmoke()).rejects.toThrow(/HTTP 401/);
    expect(x.calls).toHaveLength(1);
  });
  it("never submits second request after Sandbox admission rejects",async()=>{
    const x=make({startStatus:503});
    await expect(startAuthorizedP3XSmoke()).rejects.toThrow(/HTML_SANDBOX_NOT_READY/);
    expect(x.calls.filter(c=>c.method==="POST")).toHaveLength(1);
  });
});
