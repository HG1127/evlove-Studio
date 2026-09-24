import {describe,expect,it} from "vitest";
import {ArtifactRegistrationRequestSchema,BinaryArtifactUploadMetadataSchema,MAX_BINARY_ARTIFACT_BYTES} from "./artifact-contract";
import {EvolutionJobCreateRequestSchema} from "./job-contract";
import {HarnessPrepareRequestSchema} from "./workflow-contract";

describe("backend request bounds",()=>{
  it("limits Artifact registration by UTF-8 bytes",()=>{
    const base={id:"artifact-1",missionId:"mission-1",content:"x"};
    expect(ArtifactRegistrationRequestSchema.safeParse(base).success).toBe(true);
    expect(ArtifactRegistrationRequestSchema.safeParse({...base,content:"汉".repeat(2_000_000)}).success).toBe(false);
  });

  it("limits Job creation metadata size",()=>{
    const base={idempotencyKey:"request-1",type:"campaign",label:"Run"};
    expect(EvolutionJobCreateRequestSchema.safeParse(base).success).toBe(true);
    expect(EvolutionJobCreateRequestSchema.safeParse({...base,metadata:{payload:"x".repeat(33_000)}}).success).toBe(false);
  });

  it("rejects malformed Harness preparation inputs",()=>{
    expect(HarnessPrepareRequestSchema.safeParse({missionId:"mission-1",jobId:"job-1"}).success).toBe(true);
    expect(HarnessPrepareRequestSchema.safeParse({missionId:""}).success).toBe(false);
    expect(HarnessPrepareRequestSchema.safeParse({missionId:"mission-1",jobId:17}).success).toBe(false);
    expect(HarnessPrepareRequestSchema.safeParse({missionId:"mission-1",unexpected:true}).success).toBe(false);
  });

  it("bounds binary Artifact upload identity and content type",()=>{
    expect(MAX_BINARY_ARTIFACT_BYTES).toBe(20*1024*1024);
    expect(BinaryArtifactUploadMetadataSchema.safeParse({id:"artifact-1",mimeType:"application/pdf"}).success).toBe(true);
    expect(BinaryArtifactUploadMetadataSchema.safeParse({id:"x".repeat(201),mimeType:"application/pdf"}).success).toBe(false);
    expect(BinaryArtifactUploadMetadataSchema.safeParse({id:"artifact-1",mimeType:"x".repeat(201)}).success).toBe(false);
  });
});
