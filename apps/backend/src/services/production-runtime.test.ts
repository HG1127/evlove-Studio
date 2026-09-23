// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import {
  getServerProductionRuntime,
  MissionRevisionConflictError,
  resetServerProductionRuntime,
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
});
