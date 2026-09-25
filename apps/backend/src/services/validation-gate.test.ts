// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {createEvolutionEvent,type EvolutionEvent,type ProductionRuntimePorts} from "@evolution/contracts";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";

const {appendEvidence,appendValidationEvidence,mirror,readEvent,readValidationRecord}=vi.hoisted(()=>({
  appendEvidence:vi.fn(),appendValidationEvidence:vi.fn(),mirror:vi.fn(),
  readEvent:vi.fn(),readValidationRecord:vi.fn(),
}));
vi.mock("./evidence-ledger",async(importOriginal)=>({
  ...await importOriginal<typeof import("./evidence-ledger")>(),
  appendEvidenceLedger:appendEvidence,mirrorEvolutionEventToEvidenceLedger:mirror,
}));
vi.mock("./evidence-runtime",()=>({registerArtifactEvidence:appendValidationEvidence}));
vi.mock("./production-runtime",()=>({getServerEventById:readEvent,getServerValidationRecord:readValidationRecord}));
import {
  CheckpointArtifactDriftError,CheckpointBindingError,CheckpointValidationEvidenceError,evaluateCheckpointValidation,
} from "./validation-gate";

const artifact=new Blob(["checkpoint artifact bytes"],{type:"text/plain"});
const artifactSha256=createHash("sha256").update("checkpoint artifact bytes").digest("hex");
const durableMetadata={
  id:"artifact-1",missionId:"mission-1",sha256:artifactSha256,sizeBytes:artifact.size,
};

function runtime(checkpointId="checkpoint-1",options:{artifact?:Blob|null;metadata?:Record<string,unknown>|null}={}){
  return {
    missions:{get:vi.fn(async()=>({campaign:{checkpoint:{id:checkpointId}}}))},
    events:{append:vi.fn(async()=>undefined)},
    artifacts:{
      get:vi.fn(async()=>options.artifact===null?undefined:options.artifact??artifact),
      getMetadata:vi.fn(async()=>options.metadata===null?undefined:options.metadata??durableMetadata),
    },
  } as unknown as ProductionRuntimePorts;
}

const input={missionId:"mission-1",checkpointId:"checkpoint-1",artifactId:"artifact-1",
  artifactSha256,validationId:"validation-1",status:"passed" as const};
const validationResult={
  id:input.validationId,missionId:input.missionId,checkpointId:input.checkpointId,
  artifactId:input.artifactId,artifactSha256:input.artifactSha256,status:input.status,
};
const validationEvent=createEvolutionEvent({
  id:"validation-result:"+input.validationId,missionId:input.missionId,
  checkpointId:input.checkpointId,type:"ValidationPassed",source:"backend-validation-runtime",
  payload:{validationId:input.validationId,validation:validationResult},
});

describe("checkpoint validation gate",()=>{
  beforeEach(()=>{
    appendEvidence.mockReset();appendEvidence.mockResolvedValue({id:"evidence-1"});
    appendValidationEvidence.mockReset();appendValidationEvidence.mockResolvedValue({id:"validation-evidence-1"});
    mirror.mockReset();mirror.mockResolvedValue(undefined);
    readEvent.mockReset();
    readValidationRecord.mockReset();readValidationRecord.mockResolvedValue({event:validationEvent,result:validationResult});
  });

  it("accepts only the current persisted checkpoint",async()=>{
    const ports=runtime();
    await expect(evaluateCheckpointValidation(ports,input)).resolves.toMatchObject({accepted:true});
    expect(ports.events.append).toHaveBeenCalledOnce();
    expect(appendEvidence).toHaveBeenCalledOnce();
    expect(mirror).toHaveBeenCalledWith(validationEvent);
    expect(appendValidationEvidence).toHaveBeenCalledOnce();
  });

  it("rejects a validation bound to another checkpoint before writing evidence",async()=>{
    const ports=runtime("checkpoint-new");
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(CheckpointBindingError);
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("rejects a passed claim without the exact Artifact hash",async()=>{
    const ports=runtime();
    await expect(evaluateCheckpointValidation(ports,{...input,artifactSha256:""}))
      .rejects.toBeInstanceOf(CheckpointValidationEvidenceError);
    expect(ports.events.append).not.toHaveBeenCalled();
  });

  it("rejects a missing or differently bound source Validation before accepting",async()=>{
    const ports=runtime();
    readValidationRecord.mockResolvedValueOnce(undefined);
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(CheckpointValidationEvidenceError);
    readValidationRecord.mockResolvedValueOnce({event:validationEvent,
      result:{...validationResult,artifactSha256:"0".repeat(64)}});
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(CheckpointValidationEvidenceError);
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("does not accept when the source Validation Evidence write fails",async()=>{
    const ports=runtime();
    appendValidationEvidence.mockRejectedValueOnce(new Error("temporary validation evidence failure"));
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toThrow("temporary validation evidence failure");
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("does not accept when the source Validation Event mirror fails",async()=>{
    const ports=runtime();
    mirror.mockRejectedValueOnce(new Error("temporary event mirror failure"));
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(EventEvidenceMirrorError);
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendValidationEvidence).not.toHaveBeenCalled();
  });

  it.each([
    {label:"missing Job binding",metadata:{...durableMetadata}},
    {label:"different Job binding",metadata:{...durableMetadata,jobId:"job-2"}},
  ])("rejects accepted Artifact with $label before Evidence writes",async({metadata})=>{
    const result={...validationResult,jobId:"job-1"};
    readValidationRecord.mockResolvedValueOnce({event:createEvolutionEvent({
      id:validationEvent.id,missionId:input.missionId,jobId:"job-1",
      checkpointId:input.checkpointId,type:"ValidationPassed",source:"backend-validation-runtime",
      payload:{validationId:input.validationId,validation:result},
    }),result});
    const ports=runtime("checkpoint-1",{metadata});
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(CheckpointArtifactDriftError);
    expect(mirror).not.toHaveBeenCalled();
    expect(appendValidationEvidence).not.toHaveBeenCalled();
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
  });

  it("accepts the Artifact when its durable Job matches the persisted Validation",async()=>{
    const result={...validationResult,jobId:"job-1"};
    readValidationRecord.mockResolvedValueOnce({event:createEvolutionEvent({
      id:validationEvent.id,missionId:input.missionId,jobId:"job-1",
      checkpointId:input.checkpointId,type:"ValidationPassed",source:"backend-validation-runtime",
      payload:{validationId:input.validationId,validation:result},
    }),result});
    await expect(evaluateCheckpointValidation(runtime("checkpoint-1",{
      metadata:{...durableMetadata,jobId:"job-1"},
    }),input)).resolves.toMatchObject({accepted:true});
  });

  it("records a failed Validation as rejected after completing its source Evidence",async()=>{
    const failed={...validationResult,status:"failed",artifactSha256:undefined};
    const failedEvent=createEvolutionEvent({
      id:validationEvent.id,missionId:input.missionId,checkpointId:input.checkpointId,
      type:"ValidationFailed",source:"backend-validation-runtime",
      payload:{validationId:input.validationId,validation:failed},
    });
    readValidationRecord.mockResolvedValueOnce({event:failedEvent,result:failed});
    const ports=runtime();
    await expect(evaluateCheckpointValidation(ports,{...input,status:"failed",artifactSha256:""}))
      .resolves.toMatchObject({accepted:false});
    expect(mirror).toHaveBeenCalledWith(failedEvent);
    expect(appendValidationEvidence).toHaveBeenCalledOnce();
    expect(ports.events.append).toHaveBeenCalledWith(expect.objectContaining({type:"CheckpointRejected"}));
  });

  it.each([
    {label:"missing bytes",options:{artifact:null}},
    {label:"changed bytes",options:{artifact:new Blob(["changed bytes"],{type:"text/plain"})}},
    {label:"missing metadata",options:{metadata:null}},
    {label:"wrong Mission",options:{metadata:{...durableMetadata,missionId:"mission-2"}}},
    {label:"wrong registered hash",options:{metadata:{...durableMetadata,sha256:"0".repeat(64)}}},
  ])("rejects $label before accepting the checkpoint",async({options})=>{
    const ports=runtime("checkpoint-1",options);
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(CheckpointArtifactDriftError);
    expect(ports.events.append).not.toHaveBeenCalled();
    expect(appendEvidence).not.toHaveBeenCalled();
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
    expect(mirror).toHaveBeenCalledWith(validationEvent);
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
    mirror.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("temporary mirror failure"));
    await expect(evaluateCheckpointValidation(ports,input)).rejects.toBeInstanceOf(EventEvidenceMirrorError);
    expect(appendEvidence).not.toHaveBeenCalled();
  });
});
