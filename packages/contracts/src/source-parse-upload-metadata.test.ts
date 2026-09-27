import {describe,expect,it} from "vitest";
import {SourceParseStartResponseSchema,SourceParseUploadMetadataSchema,SourceParseWorkflowAnyInputSchema} from "./source-ingest-contract";

const valid={
  name:"source.txt",mimeType:"text/plain",role:"target",sessionId:"session-1",
  artifactId:"artifact-1",lastModified:1_790_250_000_000,
};

describe("Source Parse upload metadata",()=>{
  it("accepts bounded, explicit Artifact identity metadata",()=>{
    expect(SourceParseUploadMetadataSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an invalid role instead of silently treating it as target",()=>{
    expect(SourceParseUploadMetadataSchema.safeParse({...valid,role:"unknown"}).success).toBe(false);
  });

  it("rejects oversized session IDs, Artifact IDs and filenames",()=>{
    for(const input of [
      {...valid,sessionId:"s".repeat(201)},
      {...valid,artifactId:"a".repeat(201)},
      {...valid,name:"n".repeat(256)},
    ])expect(SourceParseUploadMetadataSchema.safeParse(input).success).toBe(false);
  });
});

describe("Source Parse Workflow input versioning",()=>{
  const legacy={jobId:"parse-1",inputRef:"input-1",outputRef:"output-1",
    artifactId:"artifact-1",name:"source.txt",mimeType:"text/plain",size:5,
    role:"target",requestedAt:"2026-09-24T00:00:00.000Z"};

  it("accepts persisted legacy inputs and generation-bound v2 inputs",()=>{
    expect(SourceParseWorkflowAnyInputSchema.safeParse(legacy).success).toBe(true);
    expect(SourceParseWorkflowAnyInputSchema.safeParse({...legacy,
      schemaVersion:"source-parse-workflow-v2",generation:2,contentSha256:"a".repeat(64),
    }).success).toBe(true);
  });

  it("never downgrades malformed v2 input to the legacy contract",()=>{
    expect(SourceParseWorkflowAnyInputSchema.safeParse({...legacy,
      schemaVersion:"source-parse-workflow-v2",generation:-1,contentSha256:"bad",
    }).success).toBe(false);
  });
});

describe("Source Parse start receipt",()=>{
  const receipt={jobId:"parse-1",artifactId:"artifact-1",status:"queued"};

  it("requires a real run ID while the Workflow is active",()=>{
    expect(SourceParseStartResponseSchema.safeParse(receipt).success).toBe(false);
    expect(SourceParseStartResponseSchema.safeParse({...receipt,runId:"run-1"}).success).toBe(true);
  });

  it("rejects empty Job and Artifact identities",()=>{
    expect(SourceParseStartResponseSchema.safeParse({...receipt,jobId:"",runId:"run-1"}).success).toBe(false);
    expect(SourceParseStartResponseSchema.safeParse({...receipt,artifactId:"",runId:"run-1"}).success).toBe(false);
  });
  it("allows a verified completed Parse result with no historic run ID",()=>{
    expect(SourceParseStartResponseSchema.safeParse({...receipt,status:"completed",reused:true}).success).toBe(true);
  });
});