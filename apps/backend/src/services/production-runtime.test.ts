// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import {createEvolutionEvent,EvolutionJobSchema,missionEnvelope,type EvolutionJob} from "@evolution/contracts";
import {
  bindServerJobWorkflowRun,
  compareAndSwapServerMissionEnvelopeWithEvent,
  createServerJobIdempotent,
  createServerJobIdempotentReceipt,
  getServerJobByIdempotencyKey,
  getServerProductionRuntime,
  listServerJobPage,
  listRecentServerParseJobs,
  listServerActiveJobs,
  listServerMissionEnvelopePage,
  listServerMissionEnvelopes,
  ActiveJobQueryError,
  JobStateConflictError,
  MissionRevisionConflictError,
  resetServerProductionRuntime,
  transitionServerJobWithEvent,
} from "./production-runtime";

const originalEnv={...process.env};
const at="2026-09-23T00:00:00.000Z";

function missionRow(revision:number,payload=demoProject){
  return {
    id:payload.id,
    schema_version:"mission-v1",
    revision,
    stage:payload.stage,
    status:payload.campaign.status,
    payload,
    created_at:at,
    updated_at:payload.updatedAt,
  };
}

const baseJob=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"job-monotonic",missionId:demoProject.id,type:"campaign",
  status:"running",label:"Monotonic Job",idempotencyKey:"job-monotonic-key",
  generation:3,attempts:3,priority:70,metadata:{scope:"test"},
  createdAt:at,startedAt:at,updatedAt:at,
});

function jobRow(job:EvolutionJob=baseJob){
  return {
    id:job.id,mission_id:job.missionId??null,schema_version:job.schemaVersion,
    type:job.type,status:job.status,label:job.label,idempotency_key:job.idempotencyKey,
    generation:job.generation,attempts:job.attempts,priority:job.priority,
    checkpoint_id:job.checkpointId??null,input_ref:job.inputRef??null,output_ref:job.outputRef??null,
    metadata:job.metadata??{},progress:job.progress??null,error:job.error??null,
    created_at:job.createdAt,started_at:job.startedAt??null,heartbeat_at:job.heartbeatAt??null,
    finished_at:job.finishedAt??null,updated_at:job.updatedAt,
  };
}

describe("server Mission revision CAS",()=>{
  beforeEach(()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY="server-secret-key-for-runtime-cas-test";
    resetServerProductionRuntime();
  });
  afterEach(()=>{
    process.env={...originalEnv};
    resetServerProductionRuntime();
    vi.unstubAllGlobals();
  });

  it("uses the Supabase secret API key without a bearer token for REST reads",async()=>{
    const key="sb_secret_0123456789abcdefghijklmnop";
    process.env.SUPABASE_SECRET_KEY=key;
    vi.stubGlobal("fetch",vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      const headers=init?.headers as Record<string,string>;
      expect(headers.apikey).toBe(key);
      expect(headers.Authorization).toBeUndefined();
      return new Response("[]",{status:200});
    }));

    expect(await listServerActiveJobs(1)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("fills Event list requests across short Supabase pages",async()=>{
    const ids=["event-z","event-y"];
    const paths:URL[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      paths.push(url);
      expect(url.pathname).toMatch(/\/events$/);
      expect(url.searchParams.get("mission_id")).toBe('eq."mission/a"');
      const id=ids[paths.length-1];
      return new Response(JSON.stringify(id?[{
        id,mission_id:"mission/a",schema_version:"event-v1",type:"MissionUpdated",
        source:"test",payload:{},at,
      }]:[]),{status:200});
    }));
    const events=await getServerProductionRuntime().events.list("mission/a",3);
    expect(events.map((event)=>event.id)).toEqual(ids);
    expect(paths).toHaveLength(3);
    expect(paths[1].searchParams.get("or")).toContain('id.lt."event-z"');
    expect(paths[2].searchParams.get("or")).toContain('id.lt."event-y"');
  });

  it("reads every Mission and Job page even when a page is shorter than the requested limit",async()=>{
    const missionA={...demoProject,id:"mission-a",updatedAt:at};
    const missionB={...demoProject,id:"mission-b",updatedAt:"2026-09-23T00:01:00.000Z"};
    const jobA=EvolutionJobSchema.parse({...baseJob,id:"job-a",missionId:"mission/a",updatedAt:at});
    const jobB=EvolutionJobSchema.parse({
      ...baseJob,id:"job-b",missionId:"mission/a",updatedAt:"2026-09-23T00:02:00.000Z",
    });
    const paths:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      paths.push(url.pathname+url.search);
      expect(url.searchParams.get("limit")).toBe("500");
      expect(url.searchParams.get("order")).toBe("id.asc");
      const cursor=url.searchParams.get("id");
      if(url.pathname.endsWith("/missions")){
        const rows=cursor==="gt.mission-a"?[missionRow(2,missionB)]
          :cursor==="gt.mission-b"?[]:[missionRow(1,missionA)];
        return new Response(JSON.stringify(rows),{status:200});
      }
      if(url.pathname.endsWith("/jobs")){
        expect(url.searchParams.get("mission_id")).toBe("eq.mission/a");
        const rows=cursor==="gt.job-a"?[jobRow(jobB)]
          :cursor==="gt.job-b"?[]:[jobRow(jobA)];
        return new Response(JSON.stringify(rows),{status:200});
      }
      throw new Error("unexpected request "+url);
    }));

    expect((await listServerMissionEnvelopes()).map((item)=>item.missionId))
      .toEqual(["mission-b","mission-a"]);
    const runtime=getServerProductionRuntime();
    expect((await runtime.missions.list()).map((item)=>item.id))
      .toEqual(["mission-b","mission-a"]);
    expect((await runtime.jobs.list("mission/a")).map((item)=>item.id))
      .toEqual(["job-b","job-a"]);
    expect(paths).toHaveLength(9);
    expect(paths.filter((path)=>path.includes("id=gt."))).toHaveLength(6);
  });

  it("serves a bounded cursor page for HTTP Mission and Job readers",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      expect(url.searchParams.get("limit")).toBe("25");
      if(url.pathname.endsWith("/missions")){
        expect(url.searchParams.get("id")).toBe("gt.mission-a");
        return new Response(JSON.stringify([missionRow(2,{...demoProject,id:"mission-b"})]),{status:200});
      }
      expect(url.pathname.endsWith("/jobs")).toBe(true);
      expect(url.searchParams.get("mission_id")).toBe("eq.mission/a");
      expect(url.searchParams.get("id")).toBe("gt.job-a");
      return new Response(JSON.stringify([jobRow(EvolutionJobSchema.parse({
        ...baseJob,id:"job-b",missionId:"mission/a",
      }))]),{status:200});
    }));
    expect(await listServerMissionEnvelopePage("mission-a",25)).toMatchObject({
      items:[{missionId:"mission-b"}],nextCursor:"mission-b",
    });
    expect(await listServerJobPage("mission/a","job-a",25)).toMatchObject({
      items:[{id:"job-b"}],nextCursor:"job-b",
    });
  });

  it("carries the revision read by a worker through sequential CAS writes and delete",async()=>{
    const expectedWrites:number[]=[];
    const expectedDeletes:number[]=[];
    let currentRevision=3;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes("/rest/v1/missions?select=*&order=id.asc")){
        return new Response(JSON.stringify(url.includes("&id=gt.")?[]:[missionRow(currentRevision)]),{status:200});
      }
      if(url.endsWith("/rest/v1/rpc/compare_and_swap_mission")){
        const body=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        const expected=Number(body.p_expected_revision);
        expectedWrites.push(expected);
        expect(expected).toBe(currentRevision);
        currentRevision+=1;
        const payload=body.p_payload as typeof demoProject;
        return new Response(JSON.stringify([{
          applied:true,current_revision:currentRevision,
          mission:missionRow(currentRevision,payload),
        }]),{status:200});
      }
      if(url.endsWith("/rest/v1/rpc/delete_mission_if_revision")){
        const body=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        const expected=Number(body.p_expected_revision);
        expectedDeletes.push(expected);
        return new Response(JSON.stringify([{applied:true,current_revision:expected}]),{status:200});
      }
      throw new Error("unexpected request "+url);
    }));

    const runtime=getServerProductionRuntime();
    await runtime.missions.list();
    await runtime.missions.save({...demoProject,name:"CAS-1",updatedAt:"2026-09-23T00:01:00.000Z"});
    await runtime.missions.save({...demoProject,name:"CAS-2",updatedAt:"2026-09-23T00:02:00.000Z"});
    await runtime.missions.delete(demoProject.id);

    expect(expectedWrites).toEqual([3,4]);
    expect(expectedDeletes).toEqual([5]);
  });

  it("isolates revision context between concurrent server runtimes",async()=>{
    let currentRevision=5;
    const attempted:number[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes("/rest/v1/missions?select=*&order=id.asc")){
        return new Response(JSON.stringify(url.includes("&id=gt.")?[]:[missionRow(5)]),{status:200});
      }
      if(url.endsWith("/rest/v1/rpc/compare_and_swap_mission")){
        const body=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        const expected=Number(body.p_expected_revision);
        attempted.push(expected);
        if(expected!==currentRevision){
          return new Response(JSON.stringify([{
            applied:false,current_revision:currentRevision,mission:missionRow(currentRevision),
          }]),{status:200});
        }
        currentRevision+=1;
        const payload=body.p_payload as typeof demoProject;
        return new Response(JSON.stringify([{
          applied:true,current_revision:currentRevision,mission:missionRow(currentRevision,payload),
        }]),{status:200});
      }
      throw new Error("unexpected request "+url);
    }));

    const requestA=getServerProductionRuntime();
    const requestB=getServerProductionRuntime();
    expect(requestA).not.toBe(requestB);
    await Promise.all([requestA.missions.list(),requestB.missions.list()]);

    await requestA.missions.save({...demoProject,name:"Request A",updatedAt:"2026-09-23T00:01:00.000Z"});
    await expect(requestB.missions.save({...demoProject,name:"Request B stale",updatedAt:"2026-09-23T00:02:00.000Z"}))
      .rejects.toMatchObject({
        code:"MISSION_REVISION_CONFLICT",
        expectedRevision:5,
        currentRevision:6,
      } satisfies Partial<MissionRevisionConflictError>);
    expect(attempted).toEqual([5,5]);
  });

  it("uses the atomic monotonic Job and Event RPC and rejects terminal-state regression",async()=>{
    let call=0;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rest/v1/rpc/put_evolution_job_with_event")){
        const body=JSON.parse(String(init?.body??"{}")) as {p_job:EvolutionJob;p_event:{jobId:string}};
        expect(body.p_job.generation).toBe(3);
        expect(body.p_event.jobId).toBe(baseJob.id);
        call+=1;
        if(call===1){
          return new Response(JSON.stringify([{
            applied:true,reason:"updated",job:jobRow(body.p_job),
          }]),{status:200});
        }
        const completed=EvolutionJobSchema.parse({
          ...baseJob,status:"completed",finishedAt:"2026-09-23T00:05:00.000Z",updatedAt:"2026-09-23T00:05:00.000Z",
        });
        return new Response(JSON.stringify([{
          applied:false,reason:"terminal-immutable",job:jobRow(completed),
        }]),{status:200});
      }
      throw new Error("unexpected request "+url);
    }));

    const runtime=getServerProductionRuntime();
    await runtime.jobs.put(baseJob);
    const error=await runtime.jobs.put({...baseJob,updatedAt:"2026-09-23T00:06:00.000Z"}).catch((cause)=>cause);
    expect(error).toBeInstanceOf(JobStateConflictError);
    expect(error).toMatchObject({
      name:"JobStateConflictError",code:"JOB_STATE_CONFLICT",reason:"terminal-immutable",
      current:{status:"completed",generation:3},
    });
  });

  it("binds cancel to the observed Job generation and rejects a stale cancel",async()=>{
    let cancelCall=0;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes("/rest/v1/jobs?id=eq.job-monotonic&select=*&limit=1")){
        return new Response(JSON.stringify([jobRow(baseJob)]),{status:200});
      }
      if(url.endsWith("/rest/v1/rpc/cancel_evolution_job_generation_with_event")){
        const body=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        expect(body.p_expected_generation).toBe(3);
        cancelCall+=1;
        if(cancelCall===1){
          const cancelled=EvolutionJobSchema.parse({
            ...baseJob,status:"cancelled",finishedAt:"2026-09-23T00:04:00.000Z",updatedAt:"2026-09-23T00:04:00.000Z",
          });
          return new Response(JSON.stringify([{applied:true,reason:"cancelled",job:jobRow(cancelled)}]),{status:200});
        }
        const retry=EvolutionJobSchema.parse({
          ...baseJob,status:"running",generation:4,attempts:4,updatedAt:"2026-09-23T00:05:00.000Z",
        });
        return new Response(JSON.stringify([{applied:false,reason:"generation-conflict",job:jobRow(retry)}]),{status:200});
      }
      throw new Error("unexpected request "+url);
    }));

    const runtimeA=getServerProductionRuntime();
    await runtimeA.jobs.get(baseJob.id);
    await runtimeA.jobs.cancel(baseJob.id);

    const runtimeB=getServerProductionRuntime();
    await runtimeB.jobs.get(baseJob.id);
    const error=await runtimeB.jobs.cancel(baseJob.id).catch((cause)=>cause);
    expect(error).toBeInstanceOf(JobStateConflictError);
    expect(error).toMatchObject({
      name:"JobStateConflictError",reason:"generation-conflict",current:{generation:4,status:"running"},
    });
  });

  it("binds a Workflow run id to the exact Job generation without changing status",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rest/v1/rpc/bind_evolution_job_workflow_run")){
        const body=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        expect(body).toMatchObject({
          p_id:"job-monotonic",
          p_expected_generation:3,
          p_run_id:"wf-run-123",
          p_binding:"metadata",
        });
        const bound=EvolutionJobSchema.parse({
          ...baseJob,
          metadata:{...(baseJob.metadata??{}),runId:"wf-run-123"},
          updatedAt:"2026-09-23T00:07:00.000Z",
        });
        return new Response(JSON.stringify([{applied:true,reason:"bound",job:jobRow(bound)}]),{status:200});
      }
      throw new Error("unexpected request "+url);
    }));

    const bound=await bindServerJobWorkflowRun("job-monotonic",3,"wf-run-123","metadata");
    expect(bound).toMatchObject({
      id:"job-monotonic",generation:3,status:"running",metadata:{runId:"wf-run-123"},
    });
  });

  it("rejects a stale server worker instead of overwriting the current Mission",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes("/rest/v1/missions?select=*&order=id.asc")){
        return new Response(JSON.stringify(url.includes("&id=gt.")?[]:[missionRow(6)]),{status:200});
      }
      if(url.endsWith("/rest/v1/rpc/compare_and_swap_mission")){
        const body=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        expect(body.p_expected_revision).toBe(6);
        return new Response(JSON.stringify([{
          applied:false,current_revision:7,mission:missionRow(7),
        }]),{status:200});
      }
      throw new Error("unexpected request "+url);
    }));

    const runtime=getServerProductionRuntime();
    await runtime.missions.list();
    await expect(runtime.missions.save({...demoProject,updatedAt:"2026-09-23T00:03:00.000Z"}))
      .rejects.toMatchObject({
        name:"MissionRevisionConflictError",
        code:"MISSION_REVISION_CONFLICT",
        expectedRevision:6,
        currentRevision:7,
      } satisfies Partial<MissionRevisionConflictError>);
  });

  it("creates a Job through the idempotent database RPC",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toContain("/rpc/create_evolution_job_idempotent");
      const body=JSON.parse(String(init?.body)) as {p_job:EvolutionJob};
      expect(body.p_job.idempotencyKey).toBe(baseJob.idempotencyKey);
      return new Response(JSON.stringify([{applied:true,reason:"created",job:jobRow(body.p_job)}]),{status:200});
    }));
    expect(await createServerJobIdempotent(baseJob)).toEqual(baseJob);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("distinguishes an idempotent Workflow start replay from a new Job",async()=>{
    const prior=EvolutionJobSchema.parse({...baseJob,id:"workflow-control-prior",outputRef:"run-prior"});
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      expect(String(input)).toContain("/rpc/create_evolution_job_idempotent");
      return new Response(JSON.stringify([{applied:true,reason:"idempotent-replay",job:jobRow(prior)}]),{status:200});
    }));
    expect(await createServerJobIdempotentReceipt({...baseJob,id:"workflow-control-new"}))
      .toEqual({job:prior,reused:true});
  });

  it("sends the Job state and Event in one atomic RPC request",async()=>{
    const event=createEvolutionEvent({id:"event-1",missionId:demoProject.id,jobId:baseJob.id,
      type:"JobCompleted",source:"test",payload:{from:"running",to:"completed",priorUpdatedAt:at}});
    const finished=EvolutionJobSchema.parse({...baseJob,status:"completed",finishedAt:at});
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toContain("/rpc/transition_evolution_job_with_event");
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(body).toMatchObject({p_id:baseJob.id,p_expected_generation:3,p_event:event,p_job:finished});
      return new Response(JSON.stringify([{applied:true,reason:"transitioned",job:jobRow(finished)}]),{status:200});
    }));
    expect(await transitionServerJobWithEvent(finished,event)).toEqual(finished);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sends Checkpoint mutation and Event in one revision guarded RPC",async()=>{
    const envelope=missionEnvelope(demoProject,4);
    const event=createEvolutionEvent({id:"checkpoint-1",missionId:demoProject.id,checkpointId:"checkpoint-1",
      type:"CheckpointCreated",source:"test",payload:{round:1}});
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toContain("/rpc/compare_and_swap_mission_with_event");
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(body).toMatchObject({p_id:demoProject.id,p_expected_revision:4,p_event:event});
      return new Response(JSON.stringify([{
        applied:true,current_revision:5,mission:missionRow(5,demoProject),
      }]),{status:200});
    }));
    expect((await compareAndSwapServerMissionEnvelopeWithEvent(envelope,event)).revision).toBe(5);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("scans active Workflow-backed Jobs without unrelated Job starvation",async()=>{
    const parse=EvolutionJobSchema.parse({...baseJob,id:"parse-1",type:"parse",idempotencyKey:"parse-1",updatedAt:"2026-09-23T00:01:00.000Z"});
    const control=EvolutionJobSchema.parse({...baseJob,id:"control-1",idempotencyKey:"workflow-control:control-1",updatedAt:"2026-09-23T00:02:00.000Z"});
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      expect(url).not.toContain("status=in.");
      if(url.includes("&or="))return new Response("[]",{status:200});
      if(!url.includes("status=eq.running"))return new Response("[]",{status:200});
      if(url.includes("type=eq.parse"))return new Response(JSON.stringify([jobRow(parse)]),{status:200});
      if(url.includes("type=eq.campaign&idempotency_key=like.workflow-control*")){
        return new Response(JSON.stringify([jobRow(control)]),{status:200});
      }
      return new Response("unexpected query",{status:500});
    }));
    expect((await listServerActiveJobs(2)).map((job)=>job.id)).toEqual(["parse-1","control-1"]);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  it("fills an active Job scan across one-row server pages",async()=>{
    const jobs=[
      EvolutionJobSchema.parse({...baseJob,id:"parse-a",type:"parse",idempotencyKey:"parse-a"}),
      EvolutionJobSchema.parse({...baseJob,id:"parse-b",type:"parse",idempotencyKey:"parse-b"}),
      EvolutionJobSchema.parse({...baseJob,id:"control-c",idempotencyKey:"workflow-control:c"}),
    ];
    const paths:URL[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      paths.push(url);
      expect(url.searchParams.get("order")).toBe("updated_at.asc,id.asc");
      if(url.searchParams.get("status")!=="eq.running")return new Response("[]",{status:200});
      const cursor=url.searchParams.get("or");
      const next=url.searchParams.get("type")==="eq.parse"
        ?cursor?.includes("id.gt.\"parse-b\"")?undefined
          :cursor?.includes("id.gt.\"parse-a\"")?jobs[1]:jobs[0]
        :cursor?undefined:jobs[2];
      return new Response(JSON.stringify(next?[jobRow(next)]:[]),{status:200});
    }));
    expect((await listServerActiveJobs(3)).map((job)=>job.id))
      .toEqual(["control-c","parse-a","parse-b"]);
    expect(paths.filter((path)=>path.searchParams.has("or"))).toHaveLength(3);
    expect(paths).toHaveLength(9);
  });

  it("attributes an active Job read failure to its filter without exposing the response",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>String(input).includes("type=eq.campaign")
      ?new Response("private detail",{status:401})
      :new Response("[]",{status:200})));
    try{await listServerActiveJobs(2);throw new Error("expected rejection");}
    catch(error){
      expect(error).toBeInstanceOf(ActiveJobQueryError);
      expect((error as ActiveJobQueryError).query).toBe("campaign");
    }
  });

  it("looks up a Parse retry by its indexed idempotency key",async()=>{
    const parse=EvolutionJobSchema.parse({...baseJob,id:"parse-1",type:"parse",idempotencyKey:"parse:a/b c"});
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      expect(String(input)).toContain("idempotency_key=eq.parse%3Aa%2Fb%20c&limit=1");
      return new Response(JSON.stringify([jobRow(parse)]),{status:200});
    }));
    expect(await getServerJobByIdempotencyKey(parse.idempotencyKey)).toEqual(parse);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds Parse recovery to recent rows in one session",async()=>{
    const parse=EvolutionJobSchema.parse({...baseJob,id:"parse-1",type:"parse",idempotencyKey:"parse-1",
      metadata:{sessionId:"session/1"}});
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      expect(url.searchParams.get("type")).toBe("eq.parse");
      expect(url.searchParams.get("updated_at")).toBe('gte."2026-09-17T00:00:00.000Z"');
      expect(url.searchParams.get("metadata->>sessionId")).toBe('eq."session/1"');
      expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
      return new Response(JSON.stringify(url.searchParams.has("or")?[]:[jobRow(parse)]),{status:200});
    }));
    expect(await listRecentServerParseJobs({
      since:"2026-09-17T00:00:00.000Z",sessionId:"session/1",limit:60,
    })).toEqual([parse]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fills Parse recovery across one-row server pages without losing timestamp ties",async()=>{
    const jobs=["parse-c","parse-b","parse-a"].map((id)=>EvolutionJobSchema.parse({
      ...baseJob,id,type:"parse",idempotencyKey:id,metadata:{sessionId:"session-1"},
    }));
    const paths:URL[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      paths.push(url);
      const cursor=url.searchParams.get("or");
      const next=cursor?.includes('id.lt."parse-a"')?undefined
        :cursor?.includes('id.lt."parse-b"')?jobs[2]
          :cursor?.includes('id.lt."parse-c"')?jobs[1]:jobs[0];
      return new Response(JSON.stringify(next?[jobRow(next)]:[]),{status:200});
    }));
    expect((await listRecentServerParseJobs({since:at,sessionId:"session-1",limit:4}))
      .map((job)=>job.id)).toEqual(["parse-c","parse-b","parse-a"]);
    expect(paths).toHaveLength(4);
    expect(paths[1].searchParams.get("or")).toContain('id.lt."parse-c"');
  });
});
