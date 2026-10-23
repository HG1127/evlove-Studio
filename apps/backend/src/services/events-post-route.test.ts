// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {createEvolutionEvent} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError} from "./evidence-ledger";
import route from "../../server/api/evolution/events.post";
import {EventEvidenceMirrorError,EventIdempotencyConflictError,EventReadbackError} from "./event-persistence";

const append=vi.hoisted(()=>vi.fn());
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({events:{append}})}));

const event=createEvolutionEvent({
  id:"event-route-1",missionId:"mission-1",type:"MissionUpdated",source:"test",payload:{},
});
function request(){
  return mockEvent(new Request("http://localhost/api/evolution/events",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(event),
  }));
}

afterEach(()=>append.mockReset());

describe("Event POST retry semantics",()=>{
  it("returns the Event ID after both writes succeed",async()=>{
    append.mockResolvedValue(undefined);
    expect(await route(request())).toEqual({ok:true,eventId:event.id});
  });

  it("returns 409 for the same ID with different authoritative content",async()=>{
    append.mockRejectedValue(new EventIdempotencyConflictError(event.id));
    await expect(route(request())).rejects.toMatchObject({statusCode:409});
  });

  it("returns 409 for a conflicting immutable Evidence mirror",async()=>{
    append.mockRejectedValue(new EventEvidenceIdentityConflictError(event.id,new Error("duplicate")));
    await expect(route(request())).rejects.toMatchObject({statusCode:409});
  });

  it("returns 503 with a same-ID retry instruction after a mirror failure",async()=>{
    append.mockRejectedValue(new EventEvidenceMirrorError(event.id,new Error("private")));
    await expect(route(request())).rejects.toMatchObject({
      statusCode:503,
      statusMessage:"Event Evidence mirror unavailable",
      data:{code:"EVENT_EVIDENCE_MIRROR_FAILED",message:expect.stringContaining("同一事件 ID")},
    });
  });
  it("reports an unconfirmed readback as retryable without exposing private details",async()=>{
    append.mockRejectedValue(new EventReadbackError(event.id));
    await expect(route(request())).rejects.toMatchObject({
      statusCode:503,data:{code:"EVENT_READBACK_UNAVAILABLE",message:expect.stringContaining("重试")},
    });
  });

});
