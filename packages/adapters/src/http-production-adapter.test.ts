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
      if(method==="PUT")return new Response(JSON.stringify({ok:true,jobId:"j1"}),{status:200,headers:{"Content-Type":"application/json"}});
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
      expect(url.searchParams.get("pageLimit")).toBe(url.pathname.endsWith("/missions")?"10":"100");
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

  it("resumes a failed Mission page at the same cursor with a smaller batch and keeps complete state",async()=>{
    const projects=["a","b","c"].map(id=>({...demoProject,id}));
    const calls:Array<{cursor:string|null;limit:number}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input),"http://localhost"),cursor=url.searchParams.get("cursor"),limit=Number(url.searchParams.get("pageLimit"));calls.push({cursor,limit});
      if(!cursor)return new Response(JSON.stringify({items:[missionEnvelope(projects[0],8)],nextCursor:"a"}));
      if(cursor==="a"&&limit>2)throw new TypeError("connection reset while receiving page");
      if(cursor==="a")return new Response(JSON.stringify({items:projects.slice(1).map(project=>missionEnvelope(project,9)),nextCursor:"c"}));
      return new Response(JSON.stringify({items:[]}));
    }));
    const ports=createHttpProductionPorts("/api/evolution");
    expect(await ports.missions.list()).toEqual(projects.map(project=>missionEnvelope(project,1).payload));
    expect(calls).toEqual([{cursor:null,limit:10},{cursor:"a",limit:10},{cursor:"a",limit:5},{cursor:"a",limit:2},{cursor:"c",limit:2}]);
    calls.length=0;await ports.missions.list();expect(calls[0]?.limit).toBe(2);
  });

  it("bounds transport recovery at one row instead of restarting the collection indefinitely",async()=>{
    const limits:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{limits.push(new URL(String(input),"http://localhost").searchParams.get("pageLimit")!);throw new TypeError("connection reset");}));
    await expect(createHttpProductionPorts("/api/evolution").missions.list()).rejects.toThrow("connection reset");
    expect(limits).toEqual(["10","5","2","1"]);
  });

  it.each(["credential-rejected","schema-unavailable","invalid-response"])("does not mask permanent %s as recoverable pagination",async reason=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",reason}}),{status:503,headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fetch);
    await expect(createHttpProductionPorts("/api/evolution").missions.list()).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("recovers a transient unavailable read without dropping the complete envelope",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",reason:"rate-limited-or-timeout"}}),{status:503}))
      .mockResolvedValueOnce(new Response(JSON.stringify({items:[missionEnvelope(demoProject,4)]})));vi.stubGlobal("fetch",fetch);
    expect(await createHttpProductionPorts("/api/evolution").missions.list()).toEqual([missionEnvelope(demoProject,4).payload]);
    expect(fetch.mock.calls.map(call=>new URL(String(call[0]),"http://localhost").searchParams.get("pageLimit"))).toEqual(["10","5"]);
  });

  it("rejects a malformed successful page without trying a smaller query",async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({items:[{}]})));vi.stubGlobal("fetch",fetch);
    await expect(createHttpProductionPorts("/api/evolution").missions.list()).rejects.toThrow();expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries a lost response body without treating it as an empty page",async()=>{
    const interrupted=new Response(new ReadableStream({start(controller){controller.error(new TypeError("body connection terminated"));}}));
    const fetch=vi.fn().mockResolvedValueOnce(interrupted).mockResolvedValueOnce(new Response(JSON.stringify({items:[missionEnvelope(demoProject,5)]})));vi.stubGlobal("fetch",fetch);
    expect(await createHttpProductionPorts("/api/evolution").missions.list()).toEqual([missionEnvelope(demoProject,5).payload]);expect(fetch).toHaveBeenCalledTimes(2);
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
      if(url.includes("/missions?pageLimit=10")&&method==="GET"){
        return new Response(JSON.stringify({items:[remoteEnvelope]}),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.endsWith("/missions/mission-cas")&&method==="PUT"){
        saveBody=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
        return new Response(JSON.stringify(savedEnvelope),{status:200,headers:{"Content-Type":"application/json"}});
      }
      if(url.endsWith("/missions/mission-cas")&&method==="DELETE"){
        deleteIfMatch=new Headers(init?.headers).get("If-Match");
        return new Response(JSON.stringify({ok:true,missionId:"mission-cas"}),{status:200,headers:{"Content-Type":"application/json"}});
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
      if(url.includes("/missions?pageLimit=10")&&method==="GET"){
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
      "项目同步 HTTP 401: Trusted Evolution actor headers are required",
    );
  });

  it("identifies the failing collection and safely explains a data-plane 503",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({statusMessage:"Server Data Plane 当前不可用",data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",reason:"credential-rejected"}}),{status:503,headers:{"Content-Type":"application/json"}})));
    const ports=createHttpProductionPorts("/api/evolution");
    await expect(ports.missions.list()).rejects.toThrow("项目同步 HTTP 503: 后台数据库拒绝访问");
    await expect(ports.jobs.list()).rejects.toThrow("任务同步 HTTP 503: 后台数据库拒绝访问");
  });

  it("uses append-only event and binary artifact routes",async()=>{
    const event=EvolutionEventSchema.parse({
      schemaVersion:"event-v1",id:"e1",missionId:"m1",type:"JobCompleted",source:"test",payload:{ok:true},at,
    });
    let artifactText="hello";
    const calls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);const method=init?.method??"GET";calls.push(method+" "+url);
      if(url.endsWith("/events")&&method==="POST")return new Response(JSON.stringify({ok:true,eventId:"e1"}),{status:200});
      if(url.includes("/events?"))return new Response(JSON.stringify([event]),{status:200,headers:{"Content-Type":"application/json"}});
      if(url.endsWith("/artifacts/a1")&&method==="PUT"){artifactText=await (init!.body as Blob).text();return new Response(JSON.stringify({ok:true,artifactId:"a1",size:7}),{status:200});}
      if(url.endsWith("/artifacts/a1")&&method==="GET")return new Response(artifactText,{status:200,headers:{"Content-Type":"text/plain"}});
      if(url.endsWith("/artifacts/a1")&&method==="DELETE")return new Response(JSON.stringify({ok:true,artifactId:"a1"}),{status:200});
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
  it("rejects successful write responses with the wrong identity or byte count",async()=>{
    const job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-expected",type:"parse",status:"queued",label:"Parse",
      idempotencyKey:"parse:expected",createdAt:at,updatedAt:at,
    });
    const event=EvolutionEventSchema.parse({
      schemaVersion:"event-v1",id:"event-expected",type:"JobCompleted",source:"test",payload:{},at,
    });
    const ports=createHttpProductionPorts("/api/evolution");
    const reply=(value:unknown)=>vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(value),{status:200})));
    reply({ok:true,jobId:"job-other"});
    await expect(ports.jobs.put(job)).rejects.toThrow("Job save receipt identity mismatch");
    reply({ok:true,eventId:"event-other"});
    await expect(ports.events.append(event)).rejects.toThrow("Event append receipt identity mismatch");
    reply({ok:true,artifactId:"artifact-expected",size:1});
    await expect(ports.artifacts.put("artifact-expected",new Blob(["12345"]))).rejects.toThrow("Artifact upload receipt size mismatch");
    reply({ok:true,artifactId:"artifact-other",size:5});
    await expect(ports.artifacts.put("artifact-expected",new Blob(["12345"]))).rejects.toThrow("Artifact upload receipt identity mismatch");
    reply({ok:true,artifactId:"artifact-other"});
    await expect(ports.artifacts.delete("artifact-expected")).rejects.toThrow("Artifact delete receipt identity mismatch");
    reply({ok:true});
    await expect(ports.jobs.put(job)).rejects.toThrow();
  });

  it("rejects malformed Event lists instead of turning them into an empty ledger",async()=>{
    const ports=createHttpProductionPorts("/api/evolution");
    for(const value of [{},{items:null},{items:"invalid"}]){
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(value),{status:200})));
      await expect(ports.events.list("mission-1")).rejects.toThrow();
    }
  });

  it("rejects mismatched Mission and cancel receipts",async()=>{
    const project={...demoProject,id:"mission-expected"};
    const ports=createHttpProductionPorts("/api/evolution");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(missionEnvelope({...project,id:"mission-other"},1)),{status:200})));
    await expect(ports.missions.get(project.id)).rejects.toThrow("Mission get receipt identity mismatch");
    await expect(ports.missions.save(project)).rejects.toThrow("Mission save receipt identity mismatch");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({ok:true,missionId:"mission-other"}),{status:200})));
    await expect(ports.missions.delete(project.id)).rejects.toThrow("Mission delete receipt identity mismatch");
    const workflow={runId:"run-1",bound:true,exists:true,statusBefore:"running",statusAfter:"cancelled",cancelIssued:true,reason:"workflow-run-cancelled"};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({ok:true,jobId:"job-other",status:"cancelled",workflow}),{status:200})));
    await expect(ports.jobs.cancel("job-expected")).rejects.toThrow("Job cancel receipt identity mismatch");
  });
  it("rejects mismatched read identities and empty continuation cursors",async()=>{
    const project={...demoProject,id:"mission-expected"};
    const wrongEnvelope={...missionEnvelope(project,1),missionId:"mission-other"};
    const ports=createHttpProductionPorts("/api/evolution");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({items:[wrongEnvelope]}),{status:200})));
    await expect(ports.missions.list()).rejects.toThrow("Mission envelope identity mismatch");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({items:[missionEnvelope(project,1)],nextCursor:""}),{status:200})));
    await expect(ports.missions.list()).rejects.toThrow();
    const job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-other",type:"parse",status:"queued",label:"Parse",
      idempotencyKey:"parse:other",createdAt:at,updatedAt:at,
    });
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(job),{status:200})));
    await expect(ports.jobs.get("job-expected")).rejects.toThrow("Job get receipt identity mismatch");
  });
  it("rejects repeated identities across collection pages",async()=>{
    const project={...demoProject,id:"mission-repeat"};
    const envelope=missionEnvelope(project,1);
    const job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-repeat",type:"parse",status:"queued",label:"Parse",
      idempotencyKey:"parse:repeat",createdAt:at,updatedAt:at,
    });
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input),"http://localhost");
      const item=url.pathname.endsWith("/missions")?envelope:job;
      return new Response(JSON.stringify({items:[item],nextCursor:url.searchParams.has("cursor")?undefined:"first"}),{status:200});
    }));
    const ports=createHttpProductionPorts("/api/evolution");
    await expect(ports.missions.list()).rejects.toThrow("Duplicate missions page item mission-repeat");
    await expect(ports.jobs.list()).rejects.toThrow("Duplicate jobs page item job-repeat");
  });
  it("bounds an Artifact upload that never responds so the outbox can retain the bytes",async()=>{
    const controller=new AbortController();
    const timeout=vi.spyOn(AbortSignal,"timeout").mockReturnValue(controller.signal);
    try{
      vi.stubGlobal("fetch",vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
        expect(init.signal).toBe(controller.signal);
        init.signal?.addEventListener("abort",()=>reject(init.signal?.reason),{once:true});
      })));
      const request=createHttpProductionPorts("/api/evolution").artifacts.put("frozen-id",new Blob(["exact bytes"]));
      const check=expect(request).rejects.toThrow("upload deadline");
      controller.abort(new Error("upload deadline"));await check;
      expect(timeout).toHaveBeenCalledWith(30000);
    }finally{timeout.mockRestore();}
  });

});
