import { describe, expect, it } from "vitest";
import { ValidationRunSchema } from "./evolve-schemas";

describe("Hidden recovery byte binding contract",()=>{
  const legacy={id:"validation",status:"failed",runs:[],baselineRuns:[],checks:[]};
  it("keeps legacy rows compatible but unbound",()=>{
    expect(ValidationRunSchema.parse(legacy).executionArtifactFingerprint).toBeUndefined();
    expect(ValidationRunSchema.parse(legacy).executionEvidenceFingerprint).toBeUndefined();
  });
  it("preserves a bounded SHA-256 receipt and rejects invalid values",()=>{
    const sha="a".repeat(64);
    expect(ValidationRunSchema.parse({...legacy,executionArtifactFingerprint:sha}).executionArtifactFingerprint).toBe(sha);
    expect(ValidationRunSchema.parse({...legacy,executionEvidenceFingerprint:"a1234567-500"}).executionEvidenceFingerprint).toBe("a1234567-500");
    expect(ValidationRunSchema.safeParse({...legacy,executionEvidenceFingerprint:"not-bound"}).success).toBe(false);
    for(const value of ["", "old-hash", "a".repeat(65), "g".repeat(64)]) {
      expect(ValidationRunSchema.safeParse({...legacy,executionArtifactFingerprint:value}).success).toBe(false);
    }
  });
});
