import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolutionEventSchema,EvolutionJobSchema,missionEnvelope} from "@evolution/contracts";
import {demoProject} from "../../../src/features/evolve/data/mock-project";
import {createHttpProductionPorts,MissionRevisionConflictError} from "./http-production-adapter";

const at="2026-09-20T10:00:00.000Z";

describe("HTTP production adapter",()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it("round-trips job metadata through the backend API contract",async()=>{
    const job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"j1",missionId:"m1",type:"parse",status:"running",label:"Parse",
      idempotencyKey:"parse:a:1",generation:1,attempts:1,priority:80,
      metadata:{sessionId:"s1",artifactId:"a1"},createdAt:at,updatedAt:at,
    });
    const calls:Array<{url:string;method:string;body?:string}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      const method=init?.method??"GET";
      calls.push({url,method,body:typeof init?.body==="string"?init.body:undefined});
      if(method==="PUT")return new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json"}});
      if(url.endsWith("/jobs/j1"))return new Response(JSON.stringify(job),{status:200,headers:{"Content-Type":"application/json"}});
      if(url.includes("/jobs?"))return new Response(JSON.stringify({items:[job]}),{status:200,headers:{"Content-Type":"application/json"}});
      throw new Error("unexpected "+method+" "+url);
    }));
    const ports=createHttpProductionPorts("/api/evolution/");
    await ports.jobs.put(job);
    expect(await ports.jobs.get("j1")).toEqual(job);
    expect(await ports.jobs.list("m1")).toEqual([job]);
    expect(JSON.parse(calls.find((call)=>call.method==="PUT")!.body!).metadata).toEqual(job.metadata);
    expect(calls.some((call)=>call.url==="/api/evolution/jobs?missionId=m1&pageLimit=100")).toBe(true);
  });

  it("collects short HTTP pages before completing Mission and Job synchronization",async()=>{
    const earlier={...demoProject,id:"mission-a",updatedAt:at};
    const later={...demoProject,id:"mission-b",updatedAt:"2026-09-20T10:01:00.000Z"};
    const jobA=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-a",type:"parse",status:"queued",label:"A",
      idempotencyKey:"a",createdAt:at,updatedAt:at,
    });
    const jobB=EvolutionJobSchema.parse({...jobA,id:"job-b",idempotencyKey:"b",updatedAt:later.updatedAt});
    const calls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input),"http://localhost");
      calls.push(url.pathname+url.search);
      expect(url.searchParams.get("pageLimit")).toBe("100");
      const cursor=url.searchParams.get("cursor");
      if(url.pathname.endsWith("/missions")){
        const page=cursor==="mission-a"?{items:[missionEnvelope(later,2)],nextCursor:"mission-b"}
          :cursor==="mission-b"?{items:[]}:{items:[missionEnvelope(earlier,1)],nextCursor:"mission-a"};
        return new Response(JSON.stringify(page),{status:200});
      }
      if(url.pathname.endsWith("/jobs")){
        const page=cursor==="job-a"?{items:[jobB],nextCursor:"job-b"}
          :cursor==="job-b"?{items:[]}:{items:[jobA],nextCursor:"job-a"};
        return new Response(JSON.stringify(page),{status:200});
      }
      throw new Error("unexpected "+url);
    }));
    const ports=createHttpProductionPorts("/api/evolution");
    expect((await ports.missions.list()).map((mission)=>mission.id)).toEqual(["mission-b","mission-a"]);
    expect((await ports.jobs.list()).map((job)=>job.id)).toEqual(["job-b","job-a"]);
    expect(calls).toHaveLength(6);
  });

  it("validates the Workflow cancellation receipt before reporting Job cancellation",async()=>{
    const receipt={ok:true,jobId:"j1",status:"cancelled",workflow:{
      runId:"run-1",bound:true,exists:true,statusBefore:"running",statusAfter:"cancelled",
      cancelIssued:true,reason:"workflow-run-cancelled",
    }};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(receipt),{status:200})));
    const ports=createHttpProductionPorts("/api/evolution");
    await expect(ports.jobs.cancel("j1")).resolves.toBeUndefined();
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ...receipt,workflow:{...receipt.workflow,cancelIssued:"yes"},
    }),{status:200})));
    await expect(ports.jobs.cancel("j1")).rejects.toThrow();
  });

  it("tracks Mission revision across list/save/delete and sends If-Match on delete",async()=>{
    const remoteProject={...demoProject,id:"mission-cas",name:"Remote",updatedAt:"2026-09-20T10:00:00.000Z"};
    const localProject={...remoteProject,name:"Local edit",updatedAt:"2026-09-20T10:01:00.000Z"};
    const remoteEnvelope=missionEnvelope(remoteProject,4);
    const savedEnvelope=missionEnvelope(localProject,5);
    let saveBody:Record<string,unknown>|undefined;
    let deleteIfMatch:string|null=null;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";
      if(url.includes("/missions?pageLimit=100")&&method==="GET"){
        return new Response(JSON.stringify({items:[remoteEnvelope]}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.endsWith("/missions/mission-cas")&&method==="PUT"){
        saveBody=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        return new Response(JSON.stringify(savedEnvelope),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.endsWith("/missions/mission-cas")&&method==="DELETE"){
        deleteIfMatch=new Headers(init?.headers).get("If-Match");
        return new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      throw new Error("unexpected "+method+" "+url);
    }));

    const ports=createHttpProductionPorts("/api/evolution");
    expect((await ports.missions.list())[0]?.name).toBe("Remote");
    await ports.missions.save(localProject);
    expect(saveBody?.revision).toBe(4);
    await ports.missions.delete("mission-cas");
    expect(deleteIfMatch).toBe('"5"');
  });

  it("surfaces a typed Mission revision conflict without advancing the cached revision",async()=>{
    const project={...demoProject,id:"mission-conflict",updatedAt:"2026-09-20T10:00:00.000Z"};
    const envelope=missionEnvelope(project,7);
    const bodies:number[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";
      if(url.includes("/missions?pageLimit=100")&&method==="GET"){
        return new Response(JSON.stringify({items:[envelope]}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.endsWith("/missions/mission-conflict")&&method==="PUT"){
        bodies.push((JSON.parse(String(init?.body)) as {revision:number}).revision);
        return new Response(JSON.stringify({
          statusCode:409,statusMessage:"Mission mission-conflict revision conflict: expected 7, current 8",
          data:{code:"MISSION_REVISION_CONFLICT",currentRevision:8},
        }),{status:409,headers:{"Content-Type":"application/json"}});
      }
      throw new Error("unexpected "+method+" "+url);
    }));

    const ports=createHttpProductionPorts("/api/evolution");
    await ports.missions.list();
    await expect(ports.missions.save({...project,updatedAt:"2026-09-20T10:02:00.000Z"}))
      .rejects.toBeInstanceOf(MissionRevisionConflictError);
    await expect(ports.missions.save({...project,updatedAt:"2026-09-20T10:03:00.000Z"}))
      .rejects.toBeInstanceOf(MissionRevisionConflictError);
    expect(bodies).toEqual([7,7]);
  });

  it("surfaces bounded server auth details instead of hiding the 401 cause",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:401,
      statusMessage:"Trusted Evolution actor headers are required",
    }),{status:401,headers:{"Content-Type":"application/json"}})));
    const ports=createHttpProductionPorts("/api/evolution");
    await expect(ports.missions.list()).rejects.toThrow(
      "Production API HTTP 401: Trusted Evolution actor headers are required",
    );
  });

  it("uses append-only event and binary artifact routes",async()=>{
    const event=EvolutionEventSchema.parse({
      schemaVersion:"event-v1",id:"e1",missionId:"m1",type:"JobCompleted",source:"test",payload:{ok:true},at,
    });
    let artifactText="hello";
    const calls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";calls.push(method+" "+url);
      if(url.endsWith("/events")&&method==="POST")return new Response(JSON.stringify({ok:true}),{status:200});
      if(url.includes("/events?"))return new Response(JSON.stringify([event]),{status:200,headers:{"Content-Type":"application/json"}});
      if(url.endsWith("/artifacts/a1")&&method==="PUT"){artifactText=await (init!.body as Blob).text();return new Response(JSON.stringify({ok:true}),{status:200});}
      if(url.endsWith("/artifacts/a1")&&method==="GET")return new Response(artifactText,{status:200,headers:{"Content-Type":"text/plain"}});
      if(url.endsWith("/artifacts/a1")&&method==="DELETE")return new Response(JSON.stringify({ok:true}),{status:200});
      throw new Error("unexpected "+method+" "+url);
    }));
    const ports=createHttpProductionPorts("/api/evolution");
    await ports.events.append(event);
    expect(await ports.events.list("m1",25)).toEqual([event]);
    await ports.artifacts.put("a1",new Blob(["changed"],{type:"text/plain"}));
    expect(await (await ports.artifacts.get("a1"))!.text()).toBe("changed");
    await ports.artifacts.delete("a1");
    expect(calls).toContain("DELETE /api/evolution/artifacts/a1");
  });
});
