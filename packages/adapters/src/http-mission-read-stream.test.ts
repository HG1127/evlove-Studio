import {afterEach,describe,expect,it,vi} from "vitest";
import {missionEnvelope} from "@evolution/contracts";
import {demoProject} from "../../../src/features/evolve/data/mock-project";
import {createHttpMissionReadStream,MissionReadStreamError} from "./http-mission-read-stream";
const version="mission-read-stream-v1";
const pending={schemaVersion:version,type:"pending"};
const envelope=missionEnvelope({...demoProject,id:"mission/a"},8);
const complete={schemaVersion:version,type:"complete",envelope};
const response=(records:unknown[])=>new Response(records.map(record=>JSON.stringify(record)).join("\n")+"\n",{headers:{"Content-Type":"application/x-ndjson"}});
afterEach(()=>vi.unstubAllGlobals());
describe("full Mission stream reader",()=>{
  it("accepts only a terminal full receipt after pending records",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("/api/evolution/missions/mission%2Fa/read");expect(init?.cache).toBe("no-store");expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response([pending,pending,complete]);
    }));
    const fallback=vi.fn();expect(await createHttpMissionReadStream("/api/evolution",fallback)("mission/a")).toEqual(envelope);expect(fallback).not.toHaveBeenCalled();
  });
  it.each([[pending],[complete],[{...pending,schemaVersion:"wrong"},complete],[{...pending,unexpected:true},complete],[pending,complete,pending],[pending,complete,complete],[pending,{...complete,envelope:{}}],[pending,{...complete,envelope:{...envelope,missionId:"other"}}]])("rejects missing, malformed, mismatched or trailing terminal data",async(...records)=>{
    const fetch=vi.fn(async()=>response(records));vi.stubGlobal("fetch",fetch);
    await expect(createHttpMissionReadStream("/api/evolution",vi.fn())("mission/a")).rejects.toThrow("本次同步未完成");expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not reveal parser document fragments",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(pending)+'\n{"private-document-fragment":',{headers:{"Content-Type":"application/x-ndjson"}})));
    let failure:unknown;try{await createHttpMissionReadStream("/api/evolution",vi.fn())("mission/a");}catch(error){failure=error;}
    expect(String(failure)).not.toContain("private-document-fragment");expect(String(failure)).toContain("本次同步未完成");
  });
  it.each(["network-error","upstream-unavailable","rate-limited-or-timeout","invalid-response","schema-unavailable","credential-rejected","unknown"])("classifies only explicit validated %s error records",async reason=>{
    vi.stubGlobal("fetch",vi.fn(async()=>response([pending,{schemaVersion:version,type:"error",failure:{code:"SERVER_DATA_PLANE_UNAVAILABLE",status:503,reason}}])));
    const read=createHttpMissionReadStream("/api/evolution",vi.fn());
    await expect(read("mission/a")).rejects.toMatchObject({name:"MissionReadStreamError",retryable:["network-error","upstream-unavailable","rate-limited-or-timeout"].includes(reason)});
  });
  it("maps an explicit not-found terminal to absence",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>response([pending,{schemaVersion:version,type:"error",failure:{code:"MISSION_NOT_FOUND",status:404,reason:"not-found"}}])));
    expect(await createHttpMissionReadStream("/api/evolution",vi.fn())("mission/a")).toBeUndefined();
  });
  it("does not accept a valid terminal before the transport reaches EOF",async()=>{
    const networkFailure=new TypeError("transport interrupted");let streamController:ReadableStreamDefaultController<Uint8Array>;
    const stream=new ReadableStream<Uint8Array>({start(controller){streamController=controller;controller.enqueue(new TextEncoder().encode(JSON.stringify(pending)+"\n"+JSON.stringify(complete)+"\n"));}});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(stream,{headers:{"Content-Type":"application/x-ndjson"}})));
    const read=createHttpMissionReadStream("/api/evolution",vi.fn())("mission/a");const check=expect(read).rejects.toBe(networkFailure);
    await Promise.resolve();streamController!.error(networkFailure);await check;
  });
  it("keeps compatibility only for an initially absent stream route",async()=>{
    const fetch=vi.fn(async()=>new Response(null,{status:404}));vi.stubGlobal("fetch",fetch);const fallback=vi.fn(async()=>envelope);
    const read=createHttpMissionReadStream("/api/evolution",fallback);expect(await read("mission/a")).toEqual(envelope);await read("mission/a");expect(fetch).toHaveBeenCalledOnce();expect(fallback).toHaveBeenCalledTimes(2);
  });
  it("never hides an authorization failure or a disappearing confirmed route",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(response([pending,complete])).mockResolvedValueOnce(new Response(null,{status:404})).mockResolvedValueOnce(new Response(null,{status:403}));vi.stubGlobal("fetch",fetch);const fallback=vi.fn();
    const read=createHttpMissionReadStream("/api/evolution",fallback);await read("mission/a");await expect(read("mission/a")).rejects.toThrow("HTTP 404");await expect(read("mission/a")).rejects.toThrow("HTTP 403");expect(fallback).not.toHaveBeenCalled();
  });
  it("exposes no automatic retry for arbitrary protocol errors",()=>{
    expect(new MissionReadStreamError({code:"SERVER_DATA_PLANE_UNAVAILABLE",status:503,reason:"invalid-response"}).retryable).toBe(false);
  });
});
