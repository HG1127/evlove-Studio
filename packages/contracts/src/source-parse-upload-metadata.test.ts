import {describe,expect,it} from "vitest";
import {SourceParseUploadMetadataSchema} from "./source-ingest-contract";

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
