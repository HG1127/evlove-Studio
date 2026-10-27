import {describe,expect,it} from "vitest";
import {ExperimentPolicySchema,VisibleRepairAttemptSchema} from "./evolve-schemas";
const reserved={id:"repair",round:1,attempt:1,status:"reserved",parentCandidateId:"parent",failedCriterionIds:["ABS","REL"],
  inputFingerprint:"a".repeat(64),finalPaperHash:"paper",reservedAt:"2026-10-28T00:00:00.000Z",version:"experiment-visible-repair-v2",experimentFingerprint:"b".repeat(64)};
const evidence={version:"repair-evidence-reference-v1",artifactId:"report",missionId:"mission",candidateId:"parent",sha256:"c".repeat(64),size:123,mimeType:"application/json"};
describe("versioned Visible mixed-feedback claims",()=>{
  it("preserves legacy canonical rows without adding classification or accepting a v3 kind",()=>{
    const parsed=VisibleRepairAttemptSchema.parse(reserved);
    expect(parsed).toEqual(reserved);expect(parsed).not.toHaveProperty("feedbackKind");
    expect(JSON.stringify(VisibleRepairAttemptSchema.parse(JSON.parse(JSON.stringify(parsed))))).toBe(JSON.stringify(parsed));
    expect(VisibleRepairAttemptSchema.safeParse({...reserved,feedbackKind:"combined-criterion-failure"}).success).toBe(false);
  });
  it("requires explicit classification and archived evidence before a v3 call can run",()=>{
    const row={...reserved,version:"experiment-visible-repair-v3",feedbackKind:"combined-criterion-failure"};
    expect(VisibleRepairAttemptSchema.parse(row)).toEqual(row);
    expect(VisibleRepairAttemptSchema.safeParse({...reserved,version:"experiment-visible-repair-v3"}).success).toBe(false);
    expect(VisibleRepairAttemptSchema.safeParse({...row,status:"running"}).success).toBe(false);
    expect(VisibleRepairAttemptSchema.safeParse({...row,status:"running",evidence}).success).toBe(true);
    expect(VisibleRepairAttemptSchema.safeParse({...row,experiment:{}}).success).toBe(false);
    expect(ExperimentPolicySchema.parse({visibleFailureRepair:"experiment-visible-repair-v3"}).visibleFailureRepair).toBe("experiment-visible-repair-v3");
  });
});
