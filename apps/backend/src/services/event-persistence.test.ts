// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError} from "./evidence-ledger";
import {
  appendServerEvent,eventRow,EventEvidenceMirrorError,EventIdempotencyConflictError,
  probeServerEventReadback,
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
    expect(request.mock.calls[1][0]).toContain('id=eq.%22event-1%22');
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
    expect(query.get("id")).toBe('eq."health-probe:no-such-event"');
    expect(query.get("limit")).toBe("1");
  });
});
