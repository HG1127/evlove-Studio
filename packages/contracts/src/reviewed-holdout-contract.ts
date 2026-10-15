import {z} from "zod";

const sha=z.string().regex(/^[0-9a-f]{64}$/);
export const ReviewedHoldoutBindingSchema=z.object({
  schemaVersion:z.literal("reviewed-holdout-binding-v1"),
  missionId:z.string().min(1),sourceUpdatedAt:z.string().min(1),
  baselineId:z.string().min(1),baselineSha256:sha,
  candidateId:z.string().min(1),snapshotSha256:sha,frozenSha256:sha,originalSha256:sha,
  hiddenSha256:sha,inputSha256:sha,physicalSha256:sha,scoringRouteFingerprint:z.string().min(1),
}).strict();
export type ReviewedHoldoutBinding=z.infer<typeof ReviewedHoldoutBindingSchema>;
export const ReviewedInvalidOutputRecoverySchema=z.object({
  schemaVersion:z.literal("reviewed-invalid-output-recovery-v1"),
  preserveFailedAttempts:z.literal(true),acknowledgeNoValidVerdict:z.literal(true),
  priorAttempts:z.array(z.object({controlJobId:z.string().min(1).max(256),runId:z.string().min(1).max(256),
    validationSha256:sha,approvalSha256:sha,sdkEvidenceSha256:sha,scoringRouteFingerprint:z.string().min(1).max(256)}).strict()).min(1).max(8),
}).strict();
export type ReviewedInvalidOutputRecovery=z.infer<typeof ReviewedInvalidOutputRecoverySchema>;
export const ReviewedHoldoutPreviewSchema=z.object({
  binding:ReviewedHoldoutBindingSchema,
  invalidOutputRecovery:ReviewedInvalidOutputRecoverySchema.optional(),
  reviewNotes:z.array(z.string()),
  preservationNotice:z.literal("REVIEW 保留；仅同一冻结文件的隔离隐藏验证；验收标准、保护要求和 Gate F 不豁免。"),
}).strict();
export type ReviewedHoldoutPreview=z.infer<typeof ReviewedHoldoutPreviewSchema>;
export const ReviewedHoldoutRequestSchema=z.object({
  binding:ReviewedHoldoutBindingSchema,
  idempotencyKey:z.string().trim().min(1).max(160),
  humanReviewNote:z.string().trim().min(8).max(2000),
  invalidOutputRecovery:ReviewedInvalidOutputRecoverySchema.optional(),
  preserveReview:z.literal(true),
  preserveAcceptanceGates:z.literal(true),
}).strict();
export type ReviewedHoldoutRequest=z.infer<typeof ReviewedHoldoutRequestSchema>;

/** Private SDK input. No public general Workflow start accepts this authority. */
export const ReviewedHoldoutRunInputSchema=z.object({
  missionId:z.string().min(1),controlJobId:z.string().min(1),controlOwnerKey:z.string().min(1),requestedAt:z.string().min(1),
  approval:z.object({
    schemaVersion:z.literal("reviewed-holdout-approval-v1"),
    request:ReviewedHoldoutRequestSchema,actorId:z.string().min(1),actorSource:z.enum(["browser-session","trusted-header","internal-dev"]),
    confirmedAt:z.string().min(1),
  }).strict(),
}).strict();
export type ReviewedHoldoutRunInput=z.infer<typeof ReviewedHoldoutRunInputSchema>;
