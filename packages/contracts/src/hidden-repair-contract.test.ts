import {describe,expect,it} from "vitest";
import {ArtifactRepairAttemptSchema,ArtifactRepairAttemptV1Schema,ExperimentPolicySchema} from "./evolve-schemas";
const old={version:"artifact-targeted-repair-v1",id:"r",round:1,attempt:1,status:"running",parentCandidateId:"c",inputFingerprint:"a".repeat(64),finalPaperHash:"p",failedCriterionIds:["CONTENT"],
 evidence:{version:"repair-evidence-reference-v1",artifactId:"e",missionId:"m",candidateId:"c",sha256:"b".repeat(64),size:1,mimeType:"application/json"},estimatedCost:0,startedAt:"2026-10-28T00:00:00Z"};
describe("ordinary Hidden repair contract versions",()=>{
  it("preserves legacy serialization and leaves old policies opted out",()=>{
    expect(JSON.stringify(ArtifactRepairAttemptSchema.parse(old))).toBe(JSON.stringify(ArtifactRepairAttemptV1Schema.parse(old)));
    expect(Object.keys(ArtifactRepairAttemptSchema.parse(old))[0]).toBe("version");
    expect(ArtifactRepairAttemptSchema.parse({...old,feedbackKind:"relative-target-regression"})).not.toHaveProperty("feedbackKind");
    expect(ExperimentPolicySchema.parse({})).not.toHaveProperty("hiddenFailureRepair");
  });
  it("requires an explicit v2 classification without changing the existing one-slot attempt fields",()=>{
    const next={...old,version:"artifact-targeted-repair-v2",feedbackKind:"combined-criterion-failure"};
    expect(ArtifactRepairAttemptSchema.parse(next)).toMatchObject({version:next.version,feedbackKind:next.feedbackKind,attempt:1});
    expect(ArtifactRepairAttemptSchema.safeParse({...next,feedbackKind:undefined}).success).toBe(false);
    expect(ArtifactRepairAttemptSchema.safeParse({...next,independentFinalFeedback:"forbidden"}).success).toBe(false);
  });
});
