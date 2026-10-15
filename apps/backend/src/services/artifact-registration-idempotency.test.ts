// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createEvolutionEvent,type EvolutionEvent,type ProductionRuntimePorts} from "@evolution/contracts";

const appendEvidence=vi.hoisted(()=>vi.fn());
vi.mock("./evidence-ledger",async(importOriginal)=>({
  ...await importOriginal<typeof import("./evidence-ledger")>(),appendEvidenceLedger:appendEvidence,
}));
import {linkArtifactEvidence,reconcileArtifactRegistration} from "./artifact-lifecycle";
import {appendServerEvent,EventIdempotencyConflictError,rowEvent} from "./event-persistence";

const content="unchanged physical source";
const sha256=createHash("sha256").update(content).digest("hex");
const input={missionId:"mission-replay",artifactId:"artifact-replay",sha256,kind:"source"};
function strictRuntime(){
  const rows=new Map<string,Record<string,unknown>>();
  const request=vi.fn(async(path:string,init?:RequestInit)=>{
    if(path==="events?on_conflict=id"){
      const row=JSON.parse(String(init?.body)) as Record<string,unknown>;
      if(!rows.has(String(row.id)))rows.set(String(row.id),row);
      return undefined;
    }
    if(path.startsWith("events?select=*")){
      const id=new URL("https://fixture.invalid/"+path).searchParams.get("id")?.slice(3);
      return id&&rows.has(id)?[rows.get(id)]:[];
    }
    throw new Error("Unexpected test persistence request");
  });
  const get=vi.fn(async(id:string)=>rows.has(id)?rowEvent(rows.get(id)!):undefined);
  const append=vi.fn(async(event:EvolutionEvent)=>appendServerEvent(request,event,async()=>undefined));
  const runtime={
    missions:{get:vi.fn(async()=>({id:input.missionId}))},
    jobs:{get:vi.fn(async()=>undefined)},
    artifacts:{
      get:vi.fn(async()=>new Blob([content],{type:"text/plain"})),
      getMetadata:vi.fn(async()=>({id:input.artifactId,missionId:input.missionId,kind:"source",sha256,
        mimeType:"text/plain",sizeBytes:Buffer.byteLength(content)})),
    },events:{get,append,list:vi.fn(async()=>Array.from(rows.values()).map(rowEvent))},
  } as unknown as ProductionRuntimePorts;
  return {runtime,rows,get,append,request};
}

describe("registered Artifact audit replay with strict persisted Event identity",()=>{
  beforeEach(()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-15T00:00:00.000Z"));
    appendEvidence.mockReset();appendEvidence.mockResolvedValue({id:"registration-evidence"});
  });
  afterEach(()=>vi.useRealTimers());

  it("reconciles the same physical registration later without inventing a new Event timestamp",async()=>{
    const ports=strictRuntime();await linkArtifactEvidence(ports.runtime,input);
    const original=structuredClone([...ports.rows.values()][0]);
    vi.setSystemTime(new Date("2026-10-15T00:00:10.000Z"));
    await expect(reconcileArtifactRegistration(ports.runtime,{missionId:input.missionId,artifactId:input.artifactId}))
      .resolves.toMatchObject({status:"reconciled",sha256,sizeBytes:Buffer.byteLength(content)});
    vi.setSystemTime(new Date("2026-10-15T00:01:00.000Z"));
    await expect(reconcileArtifactRegistration(ports.runtime,{missionId:input.missionId,artifactId:input.artifactId}))
      .resolves.toMatchObject({status:"reconciled"});
    expect(ports.rows.size).toBe(1);expect([...ports.rows.values()][0]).toEqual(original);
    expect(ports.append.mock.calls.map(([event])=>event.at)).toEqual(Array(3).fill(original.at));
    expect(appendEvidence).toHaveBeenCalledTimes(3);
  });

  it("finishes a later ledger retry using the already committed Event",async()=>{
    const ports=strictRuntime();appendEvidence.mockRejectedValueOnce(new Error("ledger unavailable"));
    await expect(linkArtifactEvidence(ports.runtime,input)).rejects.toThrow("ledger unavailable");
    vi.setSystemTime(new Date("2026-10-15T01:00:00.000Z"));
    await expect(linkArtifactEvidence(ports.runtime,input)).resolves.toMatchObject({evidence:{id:"registration-evidence"}});
    expect(ports.rows.size).toBe(1);expect(appendEvidence).toHaveBeenCalledTimes(2);
  });

  it.each([{kind:"candidate"},{jobId:"another-job"}])("still refuses same-ID content drift %j",async(change)=>{
    const ports=strictRuntime();await linkArtifactEvidence(ports.runtime,input);
    vi.setSystemTime(new Date("2026-10-15T01:00:00.000Z"));
    await expect(linkArtifactEvidence(ports.runtime,{...input,...change})).rejects.toBeInstanceOf(EventIdempotencyConflictError);
    expect(appendEvidence).toHaveBeenCalledTimes(1);
  });

  it.each([
    {source:"another-source"},{type:"MissionUpdated"},{payload:{artifactId:"another-artifact"}},
    {checkpoint_id:"unexpected-checkpoint"},{correlation_id:"unexpected-correlation"},
  ])("keeps every other persisted Event field strict: %j",async(change)=>{
    const ports=strictRuntime();await linkArtifactEvidence(ports.runtime,input);
    const [id,row]=[...ports.rows.entries()][0]!;ports.rows.set(id,{...row,...change});
    vi.setSystemTime(new Date("2026-10-15T01:00:00.000Z"));
    await expect(linkArtifactEvidence(ports.runtime,input)).rejects.toBeInstanceOf(EventIdempotencyConflictError);
    expect(appendEvidence).toHaveBeenCalledTimes(1);
  });

  it("preserves the authoritative microsecond timestamp without lossy Date conversion",async()=>{
    const ports=strictRuntime();await linkArtifactEvidence(ports.runtime,input);
    const [id,row]=[...ports.rows.entries()][0]!;ports.rows.set(id,{...row,at:"2026-10-15T00:00:00.123456+00:00"});
    vi.setSystemTime(new Date("2026-10-15T01:00:00.000Z"));
    await expect(linkArtifactEvidence(ports.runtime,input)).resolves.toMatchObject({artifactId:input.artifactId});
    expect(ports.append.mock.calls.at(-1)?.[0].at).toBe("2026-10-15T00:00:00.123456+00:00");
    expect(ports.runtime.events.list).not.toHaveBeenCalled();
  });

  it("does not append or borrow a timestamp when the identity lookup fails",async()=>{
    const ports=strictRuntime();ports.get.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(linkArtifactEvidence(ports.runtime,input)).rejects.toThrow("read unavailable");
    expect(ports.append).not.toHaveBeenCalled();expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("refuses a lookup returning a different Event ID",async()=>{
    const ports=strictRuntime();ports.get.mockResolvedValueOnce(createEvolutionEvent({id:"wrong-event",missionId:input.missionId,
      type:"ArtifactRegistered",source:"backend-artifact-lifecycle",payload:{},at:"2026-10-15T00:00:00.000Z"}));
    await expect(linkArtifactEvidence(ports.runtime,input)).rejects.toThrow("Artifact registration Event lookup returned another identity");
    expect(ports.append).not.toHaveBeenCalled();expect(appendEvidence).not.toHaveBeenCalled();
  });
});