// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import {createEvolutionEvent,EvolutionJobSchema,missionEnvelope,type EvolutionJob} from "@evolution/contracts";
import {
  bindServerJobWorkflowRun,
  compareAndSwapServerMissionEnvelopeWithEvent,
  createServerJobIdempotent,
  getServerProductionRuntime,
  listServerActiveJobs,
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

  it("carries the revision read by a worker through sequential CAS writes and delete",async()=>{
    const expectedWrites:number[]=[];
    const expectedDeletes:number[]=[];
    let currentRevision=3;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.includes("/rest/v1/missions?select=*&order=updated_at.desc")){
        return new Response(JSON.stringify([missionRow(currentRevision)]),{status:200});
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
      if(url.includes("/rest/v1/missions?select=*&order=updated_at.desc")){
        return new Response(JSON.stringify([missionRow(5)]),{status:200});
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
      if(url.includes("/rest/v1/missions?select=*&order=updated_at.desc")){
        return new Response(JSON.stringify([missionRow(6)]),{status:200});
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
      if(url.includes("type=eq.parse"))return new Response(JSON.stringify([jobRow(parse)]),{status:200});
      if(url.includes("type=eq.campaign&idempotency_key=like.workflow-control*")){
        return new Response(JSON.stringify([jobRow(control)]),{status:200});
      }
      return new Response("unexpected query",{status:500});
    }));
    expect((await listServerActiveJobs(2)).map((job)=>job.id)).toEqual(["parse-1","control-1"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
