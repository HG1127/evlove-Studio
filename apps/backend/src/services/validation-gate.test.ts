// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {createEvolutionEvent,type EvolutionEvent,type ProductionRuntimePorts} from "@evolution/contracts";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";

const {appendEvidence,mirror,readEvent}=vi.hoisted(()=>({appendEvidence:vi.fn(),mirror:vi.fn(),readEvent:vi.fn()}));
vi.mock("./evidence-ledger",async(importOriginal)=>({
  ...await importOriginal<typeof import("./evidence-ledger")>(),
  appendEvidenceLedger:appendEvidence,mirrorEvolutionEventToEvidenceLedger:mirror,
}));
vi.mock("./production-runtime",()=>({getServerEventById:readEvent}));
import {CheckpointBindingError,evaluateCheckpointValidation} from "./validation-gate";

function runtime(checkpointId="checkpoint-1"){
  return {
    missions:{get:vi.fn(async()=>({campaign:{checkpoint:{id:checkpointId}}}))},
    events:{append:vi.fn(async()=>undefined)},
  } as unknown as ProductionRuntimePorts;
}

const input={missionId:"mission-1",checkpointId:"checkpoint-1",artifactId:"artifact-1",
  artifactSha256:"a".repeat(64),validationId:"validation-1",status:"passed" as const};

describe("checkpoint validation gate",()=>{
  beforeEach(()=>{
    appendEvidence.mockReset();appendEvidence.mockResolvedValue({id:"evidence-1"});
    mirror.mockReset();mirror.mockResolvedValue(undefined);
    readEvent.mockReset();
  });

  it("accepts only the current persisted checkpoint",async()=>{
    const ports=runtime();
    await expect(evaluateCheckpointValidation(ports,input)).resolves.toMatchObject({accepted:true});
    expect(ports.events.append).toHaveBeenCalledOnce();
    expect(appendEvidence).toHaveBeenCalledOnce();
  });

  it("rejects a validation bound to another checkpoint before writing evidence",async()=>{
    const ports=runtime("checkpoint-new");
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(CheckpointBindingError);
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("does not accept a passed claim without the exact Artifact hash",async()=>{
    const result=await evaluateCheckpointValidation(runtime(),{...input,artifactSha256:""});
    expect(result.accepted).toBe(false);
  });

  it("recovers an existing Event and completes Evidence after its append failed",async()=>{
    const ports=runtime();
    let persisted:EvolutionEvent|undefined;
    ports.events.append=vi.fn(async(event:EvolutionEvent)=>{
      if(persisted)throw new EventIdempotencyConflictError(event.id);
      persisted=event;
    });
    readEvent.mockImplementation(async()=>persisted);
    appendEvidence.mockRejectedValueOnce(new Error("temporary ledger failure"));
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toThrow("temporary ledger failure");
    await expect(evaluateCheckpointValidation(ports,input)).resolves.toMatchObject({accepted:true});
    const calls=vi.mocked(ports.events.append).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({id:"checkpoint-validation:validation-1"});
    expect(readEvent).toHaveBeenCalledWith("checkpoint-validation:validation-1");
    expect(mirror).toHaveBeenCalledWith(persisted);
    expect(appendEvidence).toHaveBeenCalledTimes(2);
  });

  it("rejects an existing Event with a different checkpoint decision",async()=>{
    const ports=runtime();
    ports.events.append=vi.fn(async()=>{throw new EventIdempotencyConflictError("checkpoint-validation:validation-1");});
    readEvent.mockResolvedValue({id:"checkpoint-validation:validation-1",payload:{status:"failed"}});
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(EventIdempotencyConflictError);
    expect(mirror).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("reports a retryable mirror failure without appending checkpoint Evidence",async()=>{
    const ports=runtime();
    ports.events.append=vi.fn(async()=>{throw new EventIdempotencyConflictError("checkpoint-validation:validation-1");});
    const persisted=createEvolutionEvent({
      id:"checkpoint-validation:validation-1",missionId:input.missionId,
      checkpointId:input.checkpointId,type:"CheckpointAccepted",source:"backend-validation-gate",
      payload:{artifactId:input.artifactId,artifactSha256:input.artifactSha256,
        validationId:input.validationId,status:input.status},
      at:"2026-09-25T00:00:00.000Z",
    });
    readEvent.mockResolvedValue(persisted);
    mirror.mockRejectedValueOnce(new Error("temporary mirror failure"));
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(EventEvidenceMirrorError);
    expect(appendEvidence).not.toHaveBeenCalled();
  });
});
