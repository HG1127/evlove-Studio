import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolutionEventSchema,EvolutionJobSchema} from "@evolution/contracts";
import {createHttpProductionPorts} from "./http-production-adapter";

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
      if(url.includes("/jobs"))return new Response(JSON.stringify([job]),{status:200,headers:{"Content-Type":"application/json"}});
      throw new Error("unexpected "+method+" "+url);
    }));
    const ports=createHttpProductionPorts("/api/evolution/");
    await ports.jobs.put(job);
    expect(await ports.jobs.get("j1")).toEqual(job);
    expect(await ports.jobs.list("m1")).toEqual([job]);
    expect(JSON.parse(calls.find((call)=>call.method==="PUT")!.body!).metadata).toEqual(job.metadata);
    expect(calls.some((call)=>call.url==="/api/evolution/jobs?missionId=m1")).toBe(true);
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
