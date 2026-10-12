// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError} from "./evidence-ledger";
import {
  appendServerEvent,eventRow,EventEvidenceMirrorError,EventIdempotencyConflictError,
  probeServerEventReadback,readServerEventById,
} from "./event-persistence";

const event=createEvolutionEvent({
  id:"event-1",missionId:"mission-1",type:"MissionUpdated",source:"test",
  payload:{z:2,a:{y:2,x:1}},at:"2026-09-25T00:00:00.000Z",
});

describe("direct Event persistence",()=>{
  it("reads back the authoritative Event before mirroring a JSONB-normalized replay",async()=>{
    const persisted={...eventRow(event),at:"2026-09-25T00:00:00+00:00",payload:{a:{x:1,y:2},z:2}};
    const request=vi.fn(async(path:string)=>path.startsWith("events?select=")?[persisted]:undefined);
    const mirror=vi.fn(async()=>undefined);
    await appendServerEvent(request,event,mirror);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe("events?on_conflict=id");
    expect(request.mock.calls[1][0]).toContain('id=eq.event-1');
    expect(mirror).toHaveBeenCalledWith(expect.objectContaining({
      id:"event-1",at:"2026-09-25T00:00:00+00:00",
    }));
  });

  it("rejects reuse of an Event ID for different persisted content",async()=>{
    const request=vi.fn(async(path:string)=>path.startsWith("events?select=")
      ?[{...eventRow(event),payload:{different:true}}]:undefined);
    const mirror=vi.fn(async()=>undefined);
    await expect(appendServerEvent(request,event,mirror))
      .rejects.toBeInstanceOf(EventIdempotencyConflictError);
    expect(mirror).not.toHaveBeenCalled();
  });

  it("distinguishes Event timestamps that differ within one millisecond",async()=>{
    const precise={...event,at:"2026-09-25T00:00:00.123456Z"};
    const request=vi.fn(async(path:string)=>path.startsWith("events?select=")
      ?[{...eventRow(precise),at:"2026-09-25T00:00:00.123457+00:00"}]:undefined);
    const mirror=vi.fn(async()=>undefined);
    await expect(appendServerEvent(request,precise,mirror))
      .rejects.toBeInstanceOf(EventIdempotencyConflictError);
    expect(mirror).not.toHaveBeenCalled();
  });

  it("reports a mirror failure after commit and completes on retry of the same Event",async()=>{
    const request=vi.fn(async(path:string)=>path.startsWith("events?select=")?[eventRow(event)]:undefined);
    const mirror=vi.fn().mockRejectedValueOnce(new Error("transient ledger error"))
      .mockResolvedValueOnce(undefined);
    await expect(appendServerEvent(request,event,mirror))
      .rejects.toBeInstanceOf(EventEvidenceMirrorError);
    await expect(appendServerEvent(request,event,mirror)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(4);
    expect(mirror).toHaveBeenCalledTimes(2);
  });

  it("keeps a mismatched Ledger identity conflict distinct from a retryable failure",async()=>{
    const request=vi.fn(async(path:string)=>path.startsWith("events?select=")?[eventRow(event)]:undefined);
    const mirror=vi.fn(async()=>{throw new EventEvidenceIdentityConflictError(event.id,new Error("duplicate"));});
    await expect(appendServerEvent(request,event,mirror))
      .rejects.toBeInstanceOf(EventEvidenceIdentityConflictError);
  });

  it("does not mirror when the Event cannot be read back",async()=>{
    const request=vi.fn(async(path:string)=>path.startsWith("events?select=")?[]:undefined);
    const mirror=vi.fn(async()=>undefined);
    await expect(appendServerEvent(request,event,mirror))
      .rejects.toThrow("could not be read back");
    expect(mirror).not.toHaveBeenCalled();
  });

  it("probes the exact Event identity readback query without user data",async()=>{
    const paths:string[]=[];
    const request=vi.fn(async(path:string)=>{paths.push(path);return [];});
    expect(await probeServerEventReadback(request)).toBe(true);
    const query=new URL("https://example.supabase.co/rest/v1/"+paths[0]).searchParams;
    expect(query.get("select")).toBe("*");
    expect(query.get("id")).toBe('eq.health-probe:no-such-event');
    expect(query.get("limit")).toBe("1");
  });

  it.each([
    ['colon', 'validation-result:validation:one'],
    ['comma', 'event,one'],
    ['dot', 'event.one'],
    ['asterisk', 'event*one'],
    ['parentheses', 'event(one)'],
    ['quote', 'event"one'],
    ['backslash', 'event\\one'],
    ['query characters', 'event&limit=100#one+two'],
    ['literal percent and Unicode', '事件:%22:一'],
  ])("reads %s as one exact scalar filter value",async(_label,id)=>{
    const stored={...event,id};
    const request=vi.fn(async(path:string)=>{
      const url=new URL("https://example.supabase.co/rest/v1/"+path);
      expect(url.searchParams.get("id")).toBe("eq."+id);
      expect([...url.searchParams.keys()]).toEqual(["select","id","limit"]);
      expect(url.searchParams.get("limit")).toBe("1");
      expect(url.hash).toBe("");
      return url.searchParams.get("id")?.slice(3)===stored.id?[eventRow(stored)]:[];
    });
    await expect(readServerEventById(request,id)).resolves.toEqual(stored);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reads an inserted Workflow Event before mirroring and replaying the same identity",async()=>{
    const stored=new Map<string,ReturnType<typeof eventRow>>();
    const started={...event,id:"evt-workflow-control-real-started",type:"JobStarted" as const};
    const request=vi.fn(async(path:string,init?:RequestInit)=>{
      if(init?.method==="POST"){
        const row=JSON.parse(String(init.body)) as ReturnType<typeof eventRow>;
        if(!stored.has(row.id))stored.set(row.id,row);
        return undefined;
      }
      const filter=new URL("https://db.test/"+path).searchParams.get("id");
      const row=filter?.startsWith("eq.")?stored.get(filter.slice(3)):undefined;
      return row?[row]:[];
    });
    const mirror=vi.fn(async()=>undefined);
    await expect(appendServerEvent(request,started,mirror)).resolves.toBeUndefined();
    await expect(appendServerEvent(request,started,mirror)).resolves.toBeUndefined();
    expect(stored.size).toBe(1);
    expect(mirror).toHaveBeenCalledTimes(2);
    await expect(appendServerEvent(request,{...started,payload:{different:true}},mirror))
      .rejects.toBeInstanceOf(EventIdempotencyConflictError);
    expect(mirror).toHaveBeenCalledTimes(2);
  });

  it("rejects an exact-ID lookup that returns another Event",async()=>{
    await expect(readServerEventById(async()=>[eventRow(event)],"different-id"))
      .rejects.toThrow("another Event");
  });
});
