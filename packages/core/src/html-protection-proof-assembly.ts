import { HtmlProtectionEvidenceSchema, HtmlProtectionObligationSchema, HtmlProtectionProofBindingSchema,
  HtmlProtectionProofSchema, type HtmlProtectionEvidence, type HtmlProtectionObligation, type HtmlProtectionProofBinding } from "@evolution/contracts";
import { validateHtmlProtectionProof } from "./html-protection-proof";
/** Construct truthful receipts from ALL independently collected observations, including failures. */
export function assembleHtmlProtectionProof(args: { binding: HtmlProtectionProofBinding;
  requiredObligations: readonly HtmlProtectionObligation[]; trustedEvidence: readonly HtmlProtectionEvidence[] }) {
  const binding = HtmlProtectionProofBindingSchema.parse(args.binding);
  const requiredObligations = HtmlProtectionObligationSchema.array().min(1).max(5000).parse(args.requiredObligations);
  const evidence = HtmlProtectionEvidenceSchema.array().max(5000).parse(args.trustedEvidence);
  const receipts = requiredObligations.map(obligation => {
    const observations = evidence.filter(item => item.obligationIds.includes(obligation.id));
    const failure = observations.some(item => item.verificationStatus === "failed");
    const verified = obligation.support === "supported" && observations.length > 0 && observations.every(item => item.verificationStatus === "verified");
    const partial = obligation.support === "unresolved" ? observations.length > 0
      : observations.some(item => item.verificationStatus === "verified" || item.verificationStatus === "partial");
    return { obligationId: obligation.id, verificationStatus: failure ? "failed" as const : verified ? "verified" as const
      : partial ? "partial" as const : "unverified" as const, evidenceIds: observations.map(item => item.id) };
  });
  const failure = receipts.some(item => item.verificationStatus === "failed");
  const complete = receipts.every(item => item.verificationStatus === "verified");
  const partial = receipts.some(item => item.verificationStatus === "verified" || item.verificationStatus === "partial");
  const proof = HtmlProtectionProofSchema.parse({ schemaVersion: "html-protection-proof-v1", binding, requiredObligations, evidence, receipts,
    verificationStatus: failure ? "failed" : complete ? "verified" : partial ? "partial" : "unverified" });
  const validation = validateHtmlProtectionProof({ proof, expectedBinding: binding, requiredObligations, trustedEvidence: evidence });
  if (!validation.valid) throw Error("Collected HTML protection observations conflict with exact required scope");
  return { proof, validation };
}
