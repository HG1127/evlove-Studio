import {describe,expect,it} from "vitest";
import {
  canAcceptValidatedArtifact,evaluateArtifactValidationChecks,passedArtifactValidationChecksMatch,
} from "./artifact-validation-checks";

const bytes=new TextEncoder().encode("exact accepted artifact").buffer as ArrayBuffer;
const digest="a".repeat(64);

describe("exact Artifact validation checks",()=>{
  it("replays a persisted passed decision against the same bytes",()=>{
    const result=evaluateArtifactValidationChecks({
      expectedSha256:digest,minBytes:10,maxBytes:100,containsText:"accepted artifact",
    },bytes,"text/plain",digest);
    expect(result.unsupported).toEqual([]);
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every((check)=>check.passed)).toBe(true);
    expect(passedArtifactValidationChecksMatch(result.checks,bytes,"text/plain",digest)).toBe(true);
    expect(canAcceptValidatedArtifact({
      status:"passed",artifactId:"artifact-1",artifactSha256:digest,checks:result.checks,
    })).toBe(true);
  });

  it("rejects empty, duplicate, and contradicted passed claims",()=>{
    const [check]=evaluateArtifactValidationChecks({minBytes:10},bytes,"text/plain",digest).checks;
    expect(passedArtifactValidationChecksMatch([],bytes,"text/plain",digest)).toBe(false);
    expect(passedArtifactValidationChecksMatch([check,check],bytes,"text/plain",digest)).toBe(false);
    expect(passedArtifactValidationChecksMatch([{...check,actual:999}],bytes,"text/plain",digest)).toBe(false);
    expect(passedArtifactValidationChecksMatch([{...check,expected:bytes.byteLength+1}],bytes,"text/plain",digest)).toBe(false);
  });

  it("does not treat unsupported binary text or malformed UTF-8 as a pass",()=>{
    const check={name:"containsText" as const,passed:true,expected:"accepted",actual:true,detail:"claimed pass"};
    expect(passedArtifactValidationChecksMatch([check],bytes,"application/octet-stream",digest)).toBe(false);
    expect(passedArtifactValidationChecksMatch([check],new Uint8Array([255]).buffer,"text/plain",digest)).toBe(false);
  });
});
