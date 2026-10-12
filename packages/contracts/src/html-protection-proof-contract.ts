import { z } from "zod";

const identity = z.string().min(1).max(512);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const status = z.enum(["verified", "partial", "unverified", "failed"]);
export const HtmlProtectionEvidenceKindSchema = z.enum(["static", "browser", "semantic", "visual", "manual"]);
export const HtmlProtectionObligationSchema = z.object({
  id: identity,
  sourceArtifactId: identity,
  kind: z.enum(["html-format", "card-content", "card-title", "card-structure", "card-attributes", "embedded-css", "embedded-script", "external-reference", "inline-handler", "browser-behavior", "core-method", "visual-layout", "unknown-runtime"]),
  target: z.string().min(1).max(2048),
  description: z.string().min(1).max(8000),
  evidenceKind: HtmlProtectionEvidenceKindSchema,
  support: z.enum(["supported", "unresolved"]),
}).strict().superRefine((obligation, ctx) => {
  if (obligation.kind === "unknown-runtime" && (obligation.support !== "unresolved" || obligation.evidenceKind !== "browser")) {
    ctx.addIssue({ code: "custom", message: "Unknown runtime obligations must remain unresolved browser obligations" });
  }
  if (obligation.kind === "browser-behavior" && obligation.evidenceKind !== "browser") {
    ctx.addIssue({ code: "custom", message: "Browser behavior requires browser evidence" });
  }
  if (obligation.kind === "visual-layout" && obligation.evidenceKind !== "visual" && obligation.evidenceKind !== "manual") {
    ctx.addIssue({ code: "custom", message: "Visual layout requires visual or manual evidence" });
  }
});
export type HtmlProtectionObligation = z.infer<typeof HtmlProtectionObligationSchema>;

export const HtmlProtectionArtifactIdentitySchema = z.object({
  sourceArtifactId: identity,
  sha256,
  byteLength: z.number().int().positive(),
}).strict();
export const HtmlProtectionProofBindingSchema = z.object({
  missionId: identity,
  testCaseId: identity,
  criterionId: identity,
  paperSha256: sha256,
  original: HtmlProtectionArtifactIdentitySchema,
  executed: HtmlProtectionArtifactIdentitySchema,
  subject: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("current"), versionId: identity }).strict(),
    z.object({ kind: z.literal("candidate"), candidateId: identity }).strict(),
  ]),
}).strict().refine((binding) => binding.original.sourceArtifactId === binding.executed.sourceArtifactId,
  "Original and executed files must belong to the same source artifact");
export type HtmlProtectionProofBinding = z.infer<typeof HtmlProtectionProofBindingSchema>;

/** Observation records are supplied by trusted ports, never inferred from AI prose or tags. */
export const HtmlProtectionEvidenceSchema = z.object({
  schemaVersion: z.literal("html-protection-evidence-v1"),
  id: identity,
  binding: HtmlProtectionProofBindingSchema,
  kind: HtmlProtectionEvidenceKindSchema,
  producer: z.enum(["core-static", "browser-runner", "semantic-runtime", "visual-judge", "human"]),
  obligationIds: z.array(identity).min(1).max(5000),
  verificationStatus: status,
  observedAt: z.string().datetime({ offset: true }),
}).strict().refine((evidence) => ({
  static: "core-static", browser: "browser-runner", semantic: "semantic-runtime", visual: "visual-judge", manual: "human",
})[evidence.kind] === evidence.producer, "Evidence producer does not match the observation kind");
export type HtmlProtectionEvidence = z.infer<typeof HtmlProtectionEvidenceSchema>;

export const HtmlProtectionObligationReceiptSchema = z.object({
  obligationId: identity,
  verificationStatus: status,
  evidenceIds: z.array(identity).max(5000),
}).strict().refine((receipt) => receipt.verificationStatus === "unverified" || receipt.evidenceIds.length > 0,
  "Verified, partial and failed obligations require observation references");
export type HtmlProtectionObligationReceipt = z.infer<typeof HtmlProtectionObligationReceiptSchema>;

/**
 * Additive transport contract. Passing Zod is not execution provenance.
 * Domain validation also requires the expected binding, independently derived
 * obligation set and trusted observation records.
 */
export const HtmlProtectionProofSchema = z.object({
  schemaVersion: z.literal("html-protection-proof-v1"),
  binding: HtmlProtectionProofBindingSchema,
  requiredObligations: z.array(HtmlProtectionObligationSchema).min(1).max(5000),
  receipts: z.array(HtmlProtectionObligationReceiptSchema).max(5000),
  evidence: z.array(HtmlProtectionEvidenceSchema).max(5000),
  verificationStatus: status,
}).strict();
export type HtmlProtectionProof = z.infer<typeof HtmlProtectionProofSchema>;
