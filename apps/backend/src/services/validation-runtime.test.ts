// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {EvolutionEvent,ProductionRuntimePorts} from "@evolution/contracts";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";

const {records,readRecord,mirror}=vi.hoisted(()=>({
  records:new Map<string,{event:EvolutionEvent;result:unknown}>(),readRecord:vi.fn(),mirror:vi.fn(),
}));
vi.mock("./production-runtime",()=>({
  getServerValidationRecord:readRecord,
  getServerValidationResult:async(id:string)=>records.get(id)?.result,
}));
vi.mock("./evidence-ledger",async(importOriginal)=>({
  ...await importOriginal<typeof import("./evidence-ledger")>(),
  mirrorEvolutionEventToEvidenceLedger:mirror,
}));

import {canAcceptCheckpoint,getValidation,ValidationIdempotencyConflictError,validateArtifact} from "./validation-runtime";

const text="the exact accepted artifact";
const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
const sha256=[...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");

function runtime(args:{artifact?:Blob;metadata?:Record<string,unknown>}={}){
  const events:unknown[]=[];
  const production={
    missions:{get:async(id:string)=>id==="mission-1"?{id}:undefined},
    jobs:{},
    artifacts:{
      get:async(id:string)=>id==="artifact-1"?args.artifact??new Blob([text],{type:"text/plain"}):undefined,
      getMetadata:async()=>args.metadata??{
        id:"artifact-1",schemaVersion:"artifact-v1",missionId:"mission-1",jobId:"job-1",kind:"document",
        bucket:"evolution-artifacts",objectPath:"artifacts/artifact-1",mimeType:"text/plain",sizeBytes:text.length,
        sha256,createdAt:"2026-09-24T00:00:00.000Z",updatedAt:"2026-09-24T00:00:00.000Z",
      },
    },
    events:{append:async(event:unknown)=>{
      events.push(event);
      const value=event as EvolutionEvent;
      const result=value.payload.validation as {id:string}|undefined;
      if(result)records.set(result.id,{event:value,result});
    },list:async()=>[]},
  } as unknown as ProductionRuntimePorts;
  return {production,events};
}

describe("durable Artifact validation",()=>{
  beforeEach(()=>{
    records.clear();
    readRecord.mockReset();
    readRecord.mockImplementation(async(id:string)=>records.get(id));
    mirror.mockReset();
    mirror.mockResolvedValue(undefined);
  });

  it("passes only explicit checks bound to the stored Mission and exact Artifact hash",async()=>{
    const target=runtime();
    const result=await validateArtifact(target.production,{
      missionId:"mission-1",jobId:"job-1",checkpointId:"round-1",artifactId:"artifact-1",
      artifactSha256:sha256,idempotencyKey:"validate-1",
      checks:{expectedSha256:sha256,minBytes:10,maxBytes:100,containsText:"accepted artifact"},
    });
    expect(result).toMatchObject({status:"passed",artifactSha256:sha256,missionId:"mission-1",checkpointId:"round-1"});
    expect(result.checks).toHaveLength(4);
    expect(canAcceptCheckpoint(result)).toBe(true);
    expect(await getValidation(result.id)).toEqual(result);
    expect(target.events).toHaveLength(1);
  });

  it("keeps missing checks unverified and prevents checkpoint acceptance",async()=>{
    const result=await validateArtifact(runtime().production,{
      missionId:"mission-1",artifactId:"artifact-1",idempotencyKey:"validate-no-checks",
    });
    expect(result.status).toBe("unverified");
    expect(canAcceptCheckpoint(result)).toBe(false);
  });

  it("fails on requested hash drift and Mission binding mismatch",async()=>{
    const wrongHash=await validateArtifact(runtime().production,{
      missionId:"mission-1",artifactId:"artifact-1",artifactSha256:"0".repeat(64),checks:{minBytes:1},
    });
    expect(wrongHash.status).toBe("failed");
    expect(wrongHash.reason).toContain("differs from the requested exact Artifact binding");

    const wrongMission=await validateArtifact(runtime({metadata:{
      id:"artifact-1",schemaVersion:"artifact-v1",missionId:"mission-2",bucket:"evolution-artifacts",
      objectPath:"artifacts/artifact-1",mimeType:"text/plain",sizeBytes:text.length,sha256,
      createdAt:"2026-09-24T00:00:00.000Z",updatedAt:"2026-09-24T00:00:00.000Z",
    }}).production,{missionId:"mission-1",artifactId:"artifact-1",checks:{minBytes:1}});
    expect(wrongMission.status).toBe("failed");
    expect(wrongMission.reason).toContain("different Mission");
  });

  it("reuses an idempotent result and rejects key reuse with changed inputs",async()=>{
    const target=runtime();
    const input={missionId:"mission-1",artifactId:"artifact-1",idempotencyKey:"retry-1",checks:{minBytes:1}};
    const first=await validateArtifact(target.production,input);
    const second=await validateArtifact(target.production,input);
    expect(second).toEqual(first);
    expect(target.events).toHaveLength(1);
    expect(mirror).toHaveBeenCalledWith(records.get(first.id)?.event);
    await expect(validateArtifact(target.production,{...input,checks:{minBytes:2}}))
      .rejects.toBeInstanceOf(ValidationIdempotencyConflictError);
  });

  it("retries the persisted Event Evidence mirror without appending another validation",async()=>{
    const target=runtime();
    const input={missionId:"mission-1",artifactId:"artifact-1",idempotencyKey:"mirror-retry",checks:{minBytes:1}};
    const first=await validateArtifact(target.production,input);
    mirror.mockRejectedValueOnce(new Error("ledger temporarily unavailable"));
    await expect(validateArtifact(target.production,input)).rejects.toBeInstanceOf(EventEvidenceMirrorError);
    expect(await validateArtifact(target.production,input)).toEqual(first);
    expect(target.events).toHaveLength(1);
    expect(mirror).toHaveBeenCalledTimes(2);
  });

  it("returns the canonical result when identical concurrent requests race on the Event ID",async()=>{
    const target=runtime();
    const input={missionId:"mission-1",artifactId:"artifact-1",idempotencyKey:"race",checks:{minBytes:1}};
    const first=await validateArtifact(target.production,input);
    readRecord.mockResolvedValueOnce(undefined);
    target.production.events.append=vi.fn(async()=>{throw new EventIdempotencyConflictError(`validation-result:${first.id}`);});
    expect(await validateArtifact(target.production,input)).toEqual(first);
    expect(mirror).toHaveBeenCalledWith(records.get(first.id)?.event);
    expect(target.events).toHaveLength(1);
  });

  it("rejects a concurrent reuse of the same key with changed checks",async()=>{
    const target=runtime();
    const input={missionId:"mission-1",artifactId:"artifact-1",idempotencyKey:"race-conflict",checks:{minBytes:1}};
    const first=await validateArtifact(target.production,input);
    readRecord.mockResolvedValueOnce(undefined);
    target.production.events.append=vi.fn(async()=>{throw new EventIdempotencyConflictError(`validation-result:${first.id}`);});
    await expect(validateArtifact(target.production,{...input,checks:{minBytes:2}}))
      .rejects.toBeInstanceOf(ValidationIdempotencyConflictError);
  });
});
