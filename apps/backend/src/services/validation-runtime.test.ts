// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {ProductionRuntimePorts} from "@evolution/contracts";

const {records}=vi.hoisted(()=>({records:new Map<string,unknown>()}));
vi.mock("./production-runtime",()=>({
  getServerValidationResult:async(id:string)=>records.get(id),
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
    events:{append:async(event:unknown)=>{events.push(event);const payload=(event as {payload:{validation?:{id:string}}}).payload;if(payload.validation)records.set(payload.validation.id,payload.validation);},list:async()=>[]},
  } as unknown as ProductionRuntimePorts;
  return {production,events};
}

describe("durable Artifact validation",()=>{
  beforeEach(()=>records.clear());

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
    await expect(validateArtifact(target.production,{...input,checks:{minBytes:2}}))
      .rejects.toBeInstanceOf(ValidationIdempotencyConflictError);
  });
});
