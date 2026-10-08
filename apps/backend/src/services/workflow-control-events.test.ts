// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {createEvolutionEvent,type EvolutionEvent} from "@evolution/contracts";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";
import {appendWorkflowControlEvent} from "./workflow-control-events";
const original=createEvolutionEvent({id:"evt-control-plan-0",missionId:"mission",jobId:"control",checkpointId:"checkpoint",type:"ActionPlanned",source:"vercel-workflow-control",payload:{action:"understand",iteration:0,nested:{first:1,second:2}},at:"2026-10-08T00:00:00.000Z"});
const retry={...original,at:"2026-10-08T00:01:00.000Z"};
describe("Workflow control Event retry",()=>{
  it("does not read another Event on a successful first append",async()=>{
    const append=vi.fn(async()=>undefined),read=vi.fn();
    await appendWorkflowControlEvent({append},original,read);
    expect(append).toHaveBeenCalledExactlyOnceWith(original);expect(read).not.toHaveBeenCalled();
  });
  it("replays the exact committed time with JSONB-normalized intent",async()=>{
    const stored={...original,payload:{nested:{second:2,first:1},iteration:0,action:"understand"}};
    const append=vi.fn().mockRejectedValueOnce(new EventIdempotencyConflictError(original.id)).mockResolvedValueOnce(undefined);
    const read=vi.fn(async()=>stored);
    await appendWorkflowControlEvent({append},retry,read);
    expect(read).toHaveBeenCalledExactlyOnceWith(original.id);
    expect(append).toHaveBeenNthCalledWith(2,stored);expect(stored.at).toBe(original.at);
  });
  it("completes an Evidence mirror after the original Event committed",async()=>{
    let stored:EvolutionEvent|undefined;let mirrored=false;
    const append=vi.fn(async(value:EvolutionEvent)=>{
      if(!stored){stored=value;throw new EventEvidenceMirrorError(value.id,new Error("mirror unavailable"));}
      if(JSON.stringify(value)!==JSON.stringify(stored))throw new EventIdempotencyConflictError(value.id);
      mirrored=true;
    });
    await expect(appendWorkflowControlEvent({append},original,async()=>stored)).rejects.toBeInstanceOf(EventEvidenceMirrorError);
    await appendWorkflowControlEvent({append},retry,async()=>stored);
    expect(stored).toEqual(original);expect(mirrored).toBe(true);expect(append).toHaveBeenCalledTimes(3);
  });
  it.each([
    {id:"another"},{missionId:"another"},{jobId:"another"},{checkpointId:"another"},
    {type:"CheckpointCreated" as const},{source:"another"},{correlationId:"another"},{causationId:"another"},{payload:{action:"different"}},
  ])("rejects changed intent %j without mirroring it",async(change)=>{
    const error=new EventIdempotencyConflictError(original.id),append=vi.fn().mockRejectedValue(error);
    await expect(appendWorkflowControlEvent({append},retry,async()=>({...original,...change}))).rejects.toBe(error);
    expect(append).toHaveBeenCalledOnce();
  });
  it("does not treat an unknown append error as an identity replay",async()=>{
    const error=new Error("network failed"),append=vi.fn().mockRejectedValue(error),read=vi.fn();
    await expect(appendWorkflowControlEvent({append},retry,read)).rejects.toBe(error);expect(read).not.toHaveBeenCalled();
  });
  it("does not accept a missing authoritative Event",async()=>{
    const error=new EventIdempotencyConflictError(original.id),append=vi.fn().mockRejectedValue(error);
    await expect(appendWorkflowControlEvent({append},retry,async()=>undefined)).rejects.toBe(error);expect(append).toHaveBeenCalledOnce();
  });
  it("propagates a failed exact read so it can retry later",async()=>{
    const error=new Error("database unavailable"),append=vi.fn().mockRejectedValue(new EventIdempotencyConflictError(original.id));
    await expect(appendWorkflowControlEvent({append},retry,async()=>{throw error;})).rejects.toBe(error);expect(append).toHaveBeenCalledOnce();
  });
  it("keeps a repeated mirror failure visible",async()=>{
    const error=new EventEvidenceMirrorError(original.id,new Error("mirror unavailable"));
    const append=vi.fn().mockRejectedValueOnce(new EventIdempotencyConflictError(original.id)).mockRejectedValueOnce(error);
    await expect(appendWorkflowControlEvent({append},retry,async()=>original)).rejects.toBe(error);
  });
  it("validates stored Event data before attempting the recovery append",async()=>{
    const append=vi.fn().mockRejectedValue(new EventIdempotencyConflictError(original.id));
    await expect(appendWorkflowControlEvent({append},retry,async()=>({...original,type:"invalid"} as unknown as EvolutionEvent))).rejects.toThrow();
    expect(append).toHaveBeenCalledOnce();
  });
});
