// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {missionEnvelope,type MissionEnvelope} from "@evolution/contracts";
import {createHttpProductionPorts} from "@evolution/adapters";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import {missionReadStream} from "./mission-read-stream";
const envelope=missionEnvelope({...demoProject,id:"streamed"},8);
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe("bounded full Mission streaming",()=>{
  it("keeps a read longer than 60 seconds pending until a validated full receipt arrives",async()=>{
    vi.useFakeTimers();let resolve!:(value:MissionEnvelope)=>void;
    const held=new Promise<MissionEnvelope>(done=>{resolve=done;});
    const response=missionReadStream(async()=>held);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");expect(response.headers.has("content-length")).toBe(false);expect(response.headers.get("cache-control")).toContain("no-transform");
    vi.stubGlobal("fetch",vi.fn(async()=>response));let settled=false;
    const read=createHttpProductionPorts("/api/evolution",{missionStream:true}).missions.get("streamed");void read.then(()=>{settled=true;});
    await vi.advanceTimersByTimeAsync(70_000);expect(settled).toBe(false);
    resolve(envelope);expect(await read).toEqual(envelope.payload);expect(vi.getTimerCount()).toBe(0);
  });
  it("publishes sanitized failure records without private exception content",async()=>{
    const records=(await missionReadStream(async()=>{throw new Error("private SQL document secret");}).text()).trim().split("\n").map(line=>JSON.parse(line));
    expect(records).toEqual([{schemaVersion:"mission-read-stream-v1",type:"pending"},{schemaVersion:"mission-read-stream-v1",type:"error",failure:{code:"SERVER_DATA_PLANE_UNAVAILABLE",status:503,reason:"unknown"}}]);expect(JSON.stringify(records)).not.toContain("private SQL");
  });
  it("preserves known unavailable reasons but never emits an invalid full receipt",async()=>{
    const known=await missionReadStream(async()=>{throw {statusCode:503,data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",reason:"schema-unavailable"},message:"private"};}).text();
    expect(known).toContain('"reason":"schema-unavailable"');expect(known).not.toContain("private");
    const malformed=await missionReadStream(async()=>({missionId:"streamed"}) as MissionEnvelope).text();expect(malformed).toContain('"reason":"invalid-response"');expect(malformed).not.toContain('"type":"complete"');
  });
  it("ends a hung read at 120 seconds and aborts the upstream signal",async()=>{
    vi.useFakeTimers();let signal!:AbortSignal;
    const response=missionReadStream(async upstream=>{signal=upstream;return new Promise(()=>{});});const text=response.text();
    await vi.advanceTimersByTimeAsync(120_000);expect(signal.aborted).toBe(true);expect(await text).toContain('"reason":"network-error"');expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels both upstream work and timers when the consumer disconnects",async()=>{
    vi.useFakeTimers();let signal!:AbortSignal;
    const response=missionReadStream(async upstream=>{signal=upstream;return new Promise(()=>{});});
    const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"pending"');await reader.cancel();
    expect(signal.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
  });
  it("streams a multi-megabyte complete receipt with unchanged Unicode and identity",async()=>{
    const large=missionEnvelope({...demoProject,id:"large",name:"完整项目".repeat(550_000)},8);vi.stubGlobal("fetch",vi.fn(async()=>missionReadStream(async()=>large)));
    expect(await createHttpProductionPorts("/api/evolution",{missionStream:true}).missions.get("large")).toEqual(large.payload);
  });
});
