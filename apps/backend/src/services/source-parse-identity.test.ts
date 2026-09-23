// @vitest-environment node
import {describe,expect,it} from "vitest";
import {sourceParseIdempotencyIdentity} from "./source-parse-identity";

const base={
  artifactId:"artifact-1",
  name:"input.txt",
  mimeType:"text/plain",
  role:"target" as const,
};

describe("source parse identity",()=>{
  it("distinguishes different bytes even when size and timestamps could match",()=>{
    const a=sourceParseIdempotencyIdentity({...base,bytes:new TextEncoder().encode("ABCDE")});
    const b=sourceParseIdempotencyIdentity({...base,bytes:new TextEncoder().encode("12345")});
    expect(a.contentSha256).not.toBe(b.contentSha256);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it("is stable for an identical semantic upload",()=>{
    const first=sourceParseIdempotencyIdentity({...base,bytes:new TextEncoder().encode("same")});
    const second=sourceParseIdempotencyIdentity({...base,bytes:new TextEncoder().encode("same")});
    expect(second).toEqual(first);
    expect(first.idempotencyKey).toMatch(/^parse-v2:[a-f0-9]{64}$/);
    expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not reuse parsed output when role, file name or MIME meaning changes",()=>{
    const bytes=new TextEncoder().encode("same");
    const original=sourceParseIdempotencyIdentity({...base,bytes});
    expect(sourceParseIdempotencyIdentity({...base,role:"reference",bytes}).idempotencyKey).not.toBe(original.idempotencyKey);
    expect(sourceParseIdempotencyIdentity({...base,name:"renamed.txt",bytes}).idempotencyKey).not.toBe(original.idempotencyKey);
    expect(sourceParseIdempotencyIdentity({...base,mimeType:"application/octet-stream",bytes}).idempotencyKey).not.toBe(original.idempotencyKey);
  });
});
