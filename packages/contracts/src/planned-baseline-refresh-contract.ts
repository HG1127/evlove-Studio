import { z } from "zod";
import { OriginalArtifactReferenceProofSchema } from "./original-reference-contract";

/** Server-owned continuation of one already committed Plan; never a passing measurement. */
export const PlannedBaselineRefreshSchema = z.object({
  schemaVersion: z.literal("planned-baseline-refresh-v1"),
  missionId: z.string().min(1), round: z.number().int().positive(), checkpointAt: z.string().min(1),
  sourceBaselineId: z.string().min(1), measurementFingerprint: z.string().min(1), planFingerprint: z.string().min(1),
  candidateIds: z.array(z.string().min(1)).min(1), paperHash: z.string().min(1),
  originalReferences: z.array(OriginalArtifactReferenceProofSchema),
  createdAt: z.iso.datetime({ offset: true }), attemptStartedAt: z.iso.datetime({ offset: true }),
  status: z.enum(["refreshing", "retryable", "unsettled"]),
  failedAt: z.iso.datetime({ offset: true }).optional(),
  failureKind: z.enum(["judge", "evidence", "original-binding"]).optional(),
}).strict().superRefine((record, ctx) => {
  if (new Set(record.candidateIds).size !== record.candidateIds.length)
    ctx.addIssue({ code: "custom", path: ["candidateIds"], message: "Candidate identities must be unique" });
  if (new Set(record.originalReferences.map(ref => ref.sourceArtifactId)).size !== record.originalReferences.length
    || record.originalReferences.some(ref => ref.missionId !== record.missionId))
    ctx.addIssue({ code: "custom", path: ["originalReferences"], message: "Original references must be unique and Mission-bound" });
  if (Date.parse(record.attemptStartedAt) < Date.parse(record.createdAt))
    ctx.addIssue({ code: "custom", path: ["attemptStartedAt"], message: "Attempt precedes the continuation" });
  if (record.status !== "refreshing" ? !record.failedAt || !record.failureKind : record.failedAt !== undefined || record.failureKind !== undefined)
    ctx.addIssue({ code: "custom", path: ["status"], message: "Failed or unsettled attempts require failure metadata" });
  if (record.failedAt && Date.parse(record.failedAt) < Date.parse(record.attemptStartedAt))
    ctx.addIssue({ code: "custom", path: ["failedAt"], message: "Failure precedes its attempt" });
});
export type PlannedBaselineRefresh = z.infer<typeof PlannedBaselineRefreshSchema>;

/** Synchronous rejection or a fully received, invalid model reply; never a timeout or unknown transport failure. */
export const CompletedBaselineFailureSchema = z.object({
  httpStatus: z.number().int().min(100).max(599).optional(), code: z.string().optional(), name: z.string().optional(),
}).passthrough().refine(error => {
  if (["SERVER_AI_PROVIDER_TIMEOUT", "SERVER_AI_PROVIDER_NETWORK_ERROR"].includes(error.code ?? "")
    || ["TimeoutError", "AbortError"].includes(error.name ?? "")) return false;
  return [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(error.httpStatus ?? 0)
    || ["AI_OUTPUT_SCHEMA_MISMATCH", "AI_OUTPUT_INVALID_JSON", "AI_OUTPUT_INCOMPLETE", "SERVER_AI_UNAVAILABLE"].includes(error.code ?? "");
});
