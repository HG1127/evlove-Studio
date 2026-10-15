import {describe,expect,it} from "vitest";
import {ReviewedHoldoutRequestSchema,ReviewedHoldoutRunInputSchema} from "./reviewed-holdout-contract";
const binding={schemaVersion:"reviewed-holdout-binding-v1",missionId:"m",sourceUpdatedAt:"at",baselineId:"b",baselineSha256:"a".repeat(64),
  candidateId:"C1",snapshotSha256:"b".repeat(64),frozenSha256:"c".repeat(64),originalSha256:"d".repeat(64),
  hiddenSha256:"e".repeat(64),inputSha256:"f".repeat(64),physicalSha256:"1".repeat(64),scoringRouteFingerprint:"route"};
const request={binding,idempotencyKey:"same",humanReviewNote:"Human checked the exact review",preserveReview:true,preserveAcceptanceGates:true};
describe("reviewed Holdout boundary DTO",()=>{
  it("requires explicit preservation and exact identities",()=>expect(ReviewedHoldoutRequestSchema.parse(request)).toEqual(request));
  it.each([
    {preserveReview:false},{preserveAcceptanceGates:false},{humanReviewNote:""},{idempotencyKey:""},
    {scheduledFor:"later"},{retry:true},{approval:{actorId:"forged"}},{humanReviewNote:"x".repeat(2001)},
    {binding:{...binding,frozenSha256:"bad"}},{binding:{...binding,skipGateF:true}},
  ])("rejects missing consent, drift or unapproved scope %j",change=>expect(ReviewedHoldoutRequestSchema.safeParse({...request,...change}).success).toBe(false));
  it("requires server input identity and rejects a service approval",()=>{
    expect(ReviewedHoldoutRunInputSchema.safeParse({...request}).success).toBe(false);
    expect(ReviewedHoldoutRunInputSchema.safeParse({missionId:"m",controlJobId:"j",controlOwnerKey:"k",requestedAt:"at",
      approval:{schemaVersion:"reviewed-holdout-approval-v1",request,actorId:"svc",actorSource:"service",confirmedAt:"at"}}).success).toBe(false);
  });
});

const recovery={schemaVersion:"reviewed-invalid-output-recovery-v1",preserveFailedAttempts:true,acknowledgeNoValidVerdict:true,priorAttempts:[{controlJobId:"old-job",runId:"old-run",validationSha256:"a".repeat(64),approvalSha256:"b".repeat(64),sdkEvidenceSha256:"c".repeat(64),scoringRouteFingerprint:"old-route"}]};
it("accepts explicit bounded invalid-only recovery references as an additive request field",()=>expect(ReviewedHoldoutRequestSchema.parse({...request,invalidOutputRecovery:recovery})).toEqual({...request,invalidOutputRecovery:recovery}));
it.each([{preserveFailedAttempts:false},{acknowledgeNoValidVerdict:false},{priorAttempts:[]},{priorAttempts:Array(9).fill(recovery.priorAttempts[0])},{skipGateF:true},{priorAttempts:[{...recovery.priorAttempts[0],sdkEvidenceSha256:"invalid"}]}])("rejects incomplete or widened recovery declarations %#",change=>expect(ReviewedHoldoutRequestSchema.safeParse({...request,invalidOutputRecovery:{...recovery,...change}}).success).toBe(false));

it.each(["controlJobId","runId","scoringRouteFingerprint"])("bounds new recovery reference %s",field=>expect(ReviewedHoldoutRequestSchema.safeParse({...request,invalidOutputRecovery:{...recovery,priorAttempts:[{...recovery.priorAttempts[0],[field]:"x".repeat(257)}]}}).success).toBe(false));
