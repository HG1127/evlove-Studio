// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError} from "./evidence-ledger";
import {reconcileEventEvidence,type EventEvidenceReconcileDependencies} from "./event-evidence-reconciliation";

const scoped=createEvolutionEvent({
  id:"evt-a",missionId:"mission-1",type:"JobQueued",source:"backend-job-lifecycle",payload:{},
});
const unscoped=createEvolutionEvent({id:"evt-b",type:"MissionUpdated",source:"test",payload:{}});

function dependencies(overrides:Partial<EventEvidenceReconcileDependencies>={}):EventEvidenceReconcileDependencies{
  return {
    list:vi.fn(async()=>({events:[scoped,unscoped],nextCursor:unscoped.id})),
    lookup:vi.fn(async()=>undefined),
    mirror:vi.fn(async()=>({id:"event-ledger-evt-a"})),
    configured:()=>true,
    ...overrides,
  };
}

describe("Event Evidence reconciliation",()=>{
  it("previews missing mirrors without writing, and carries an ID cursor",async()=>{
    const deps=dependencies();
    const result=await reconcileEventEvidence({limit:2},deps);
    expect(result).toMatchObject({inspected:2,missing:1,repaired:0,nextCursor:"evt-b"});
    expect(result.results).toEqual([
      {eventId:"evt-a",status:"missing"},{eventId:"evt-b",status:"unscoped"},
    ]);
    expect(deps.mirror).not.toHaveBeenCalled();
    expect(deps.list).toHaveBeenCalledWith({missionId:undefined,afterId:undefined,limit:2});
  });

  it("repairs a missing transactional Event mirror from the stored Event",async()=>{
    const deps=dependencies();
    const result=await reconcileEventEvidence({missionId:"mission-1",afterId:"evt-0",limit:2,repair:true},deps);
    expect(result).toMatchObject({inspected:2,missing:0,repaired:1,conflicts:0,failed:0});
    expect(deps.mirror).toHaveBeenCalledWith(scoped);
    expect(deps.list).toHaveBeenCalledWith({missionId:"mission-1",afterId:"evt-0",limit:2});
  });

  it("checks an existing mirror in repair mode and reports it as present",async()=>{
    const deps=dependencies({lookup:vi.fn(async()=>({id:"event-ledger-evt-a"}))});
    const preview=await reconcileEventEvidence({limit:2},deps);
    expect(preview.results[0]).toEqual({eventId:"evt-a",status:"present"});
    expect(deps.mirror).not.toHaveBeenCalled();
    const repaired=await reconcileEventEvidence({limit:2,repair:true},deps);
    expect(repaired).toMatchObject({repaired:0,conflicts:0,failed:0});
    expect(repaired.results[0]).toEqual({eventId:"evt-a",status:"present"});
    expect(deps.mirror).toHaveBeenCalledWith(scoped);
  });

  it("surfaces a failed Ledger lookup without attempting a write",async()=>{
    const deps=dependencies({lookup:vi.fn(async()=>{throw new Error("private");})});
    const result=await reconcileEventEvidence({limit:2,repair:true},deps);
    expect(result).toMatchObject({failed:1,repaired:0});
    expect(result.results[0]).toEqual({eventId:"evt-a",status:"failed"});
    expect(deps.mirror).not.toHaveBeenCalled();
  });

  it("reports immutable identity conflicts separately from transient failures",async()=>{
    const deps=dependencies({
      mirror:vi.fn(async()=>{throw new EventEvidenceIdentityConflictError(scoped.id,new Error("duplicate"));}),
    });
    const result=await reconcileEventEvidence({limit:2,repair:true},deps);
    expect(result).toMatchObject({repaired:0,conflicts:1,failed:0});
    expect(result.results[0]).toEqual({eventId:"evt-a",status:"conflict"});
  });

  it("fails explicitly when signing is unavailable or a page exceeds the cap",async()=>{
    await expect(reconcileEventEvidence({repair:true},dependencies({configured:()=>false})))
      .rejects.toThrow("not configured");
    await expect(reconcileEventEvidence({limit:51},dependencies()))
      .rejects.toThrow();
    await expect(reconcileEventEvidence({limit:1},dependencies()))
      .rejects.toThrow("exceeded");
  });
});
