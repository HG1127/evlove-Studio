import { z } from "zod";
const identity = z.string().min(1).max(512);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** Integrity reference only. Its DTO never supplies execution or acceptance authority. */
export const HtmlProtectionAuthorityReferenceSchema = z.object({
  schemaVersion: z.literal("html-protection-authority-reference-v1"),
  blobId: identity, sha256, byteLength: z.number().int().positive().max(32_000_000),
  criterionId: identity, executionId: identity, jobId: identity, generation: z.number().int().positive(),
  inputSha256: sha256, planSha256: sha256, scoringRouteFingerprint: identity,
  policyVersion: identity, observedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type HtmlProtectionAuthorityReference = z.infer<typeof HtmlProtectionAuthorityReferenceSchema>;
