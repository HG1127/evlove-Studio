import {
  HtmlProtectionEvidenceSchema,
  HtmlProtectionObligationSchema,
  HtmlProtectionProofBindingSchema,
  HtmlProtectionProofSchema,
  type HtmlProtectionEvidence,
  type HtmlProtectionObligation,
  type HtmlProtectionProofBinding,
} from "@evolution/contracts";
import { indexUniqueById } from "./identity-index";

type Status = "verified" | "partial" | "unverified" | "failed";
export type HtmlProtectionProofValidation = {
  valid: boolean;
  complete: boolean;
  passed: boolean;
  verificationStatus: Status;
  verifiedObligationIds: string[];
  failedObligationIds: string[];
  missingObligationIds: string[];
  unresolvedObligationIds: string[];
  gaps: string[];
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function invalid(gap: string): HtmlProtectionProofValidation {
  return { valid: false, complete: false, passed: false, verificationStatus: "unverified",
    verifiedObligationIds: [], failedObligationIds: [], missingObligationIds: [], unresolvedObligationIds: [], gaps: [gap] };
}

/**
 * Pure validation of one exact source/subject/test/paper comparison.
 * trustedEvidence MUST come from actual port observations or an authoritative
 * evidence store, independently of the untrusted proof. This is not a signature
 * verifier and must not be used to bless user/AI supplied observation records.
 */
export function validateHtmlProtectionProof(args: {
  proof: unknown;
  expectedBinding: HtmlProtectionProofBinding;
  requiredObligations: readonly HtmlProtectionObligation[];
  trustedEvidence: readonly HtmlProtectionEvidence[];
}): HtmlProtectionProofValidation {
  const binding = HtmlProtectionProofBindingSchema.safeParse(args.expectedBinding);
  const expected = HtmlProtectionObligationSchema.array().min(1).max(5000).safeParse(args.requiredObligations);
  const trusted = HtmlProtectionEvidenceSchema.array().max(5000).safeParse(args.trustedEvidence);
  const parsed = HtmlProtectionProofSchema.safeParse(args.proof);
  if (!binding.success || !expected.success || !trusted.success || !parsed.success) return invalid("Invalid HTML protection contract or expected evidence boundary");
  const proof = parsed.data;
  if (!equal(proof.binding, binding.data)) return invalid("HTML protection proof belongs to another Mission, test, criterion, paper, artifact or subject");
  if (expected.data.some((obligation) => obligation.sourceArtifactId !== binding.data.original.sourceArtifactId)) {
    return invalid("Required obligation belongs to another source artifact");
  }
  const required = indexUniqueById(expected.data, (item) => item.id);
  const claimed = indexUniqueById(proof.requiredObligations, (item) => item.id);
  const receipts = indexUniqueById(proof.receipts, (item) => item.obligationId);
  const evidence = indexUniqueById(proof.evidence, (item) => item.id);
  const observed = indexUniqueById(trusted.data, (item) => item.id);
  if ([required, claimed, receipts, evidence, observed].some((index) => index.duplicateIds.size > 0)) {
    return invalid("Duplicate obligation, receipt or evidence identity");
  }
  if (claimed.byId.size !== required.byId.size || [...required.byId].some(([id, obligation]) => !equal(claimed.byId.get(id), obligation))) {
    return invalid("Proof must include the exact independently derived obligation set");
  }
  if ([...receipts.byId.keys()].some((id) => !required.byId.has(id))) return invalid("Receipt cites an unexpected obligation");
  for (const item of proof.evidence) {
    if (!equal(item, observed.byId.get(item.id)) || !equal(item.binding, binding.data)) {
      return invalid("Observation is not backed by a trusted record for this exact comparison");
    }
    if (new Set(item.obligationIds).size !== item.obligationIds.length || item.obligationIds.some((id) => !required.byId.has(id))) {
      return invalid("Observation has duplicate or unexpected obligation scope");
    }
  }

  const scopedTrusted = trusted.data.filter((item) => equal(item.binding, binding.data)
    && item.obligationIds.some((id) => required.byId.has(id)));
  if (scopedTrusted.some((item) => !evidence.byId.has(item.id))) {
    return invalid("Proof omits a trusted observation for the required scope");
  }

  const usedEvidence = new Set<string>();
  for (const receipt of proof.receipts) {
    if (new Set(receipt.evidenceIds).size !== receipt.evidenceIds.length) return invalid("Receipt repeats an observation identity");
    const obligation = required.byId.get(receipt.obligationId)!;
    for (const id of receipt.evidenceIds) {
      const item = evidence.byId.get(id);
      if (!item || item.kind !== obligation.evidenceKind || !item.obligationIds.includes(obligation.id)) {
        return invalid("Receipt lacks the required scoped observation kind");
      }
      usedEvidence.add(id);
    }
  }
  if ([...evidence.byId.keys()].some((id) => !usedEvidence.has(id))) return invalid("Proof includes an unreferenced observation");

  const verifiedObligationIds: string[] = [], failedObligationIds: string[] = [];
  const missingObligationIds: string[] = [], unresolvedObligationIds: string[] = [];
  const gaps: string[] = [];
  let hasPartial = false, dishonestReceipt = false;
  for (const obligation of expected.data) {
    const receipt = receipts.byId.get(obligation.id);
    if (!receipt) { missingObligationIds.push(obligation.id); gaps.push("Missing obligation receipt: " + obligation.id); continue; }
    const observations = receipt.evidenceIds.map((id) => evidence.byId.get(id)!);
    if (obligation.support === "unresolved") {
      unresolvedObligationIds.push(obligation.id);
      gaps.push("Unsupported obligation remains unresolved: " + obligation.id);
      hasPartial ||= observations.length > 0;
      dishonestReceipt ||= receipt.verificationStatus === "verified" || receipt.verificationStatus === "failed";
      continue;
    }
    const statuses = observations.map((item) => item.verificationStatus);
    // Any observed violation must survive aggregation, even if a producer claims pass.
    const hasFailure = statuses.includes("failed");
    const allVerified = statuses.length > 0 && statuses.every((item) => item === "verified");
    if (hasFailure) {
      failedObligationIds.push(obligation.id);
      dishonestReceipt ||= receipt.verificationStatus !== "failed";
    } else if (receipt.verificationStatus === "verified" && allVerified) {
      verifiedObligationIds.push(obligation.id);
    } else {
      hasPartial ||= statuses.some((item) => item === "verified" || item === "partial");
      gaps.push("Incomplete observation: " + obligation.id);
      dishonestReceipt ||= receipt.verificationStatus === "verified" || receipt.verificationStatus === "failed";
    }
  }
  const complete = !dishonestReceipt && unresolvedObligationIds.length === 0
    && verifiedObligationIds.length + failedObligationIds.length === expected.data.length;
  const verificationStatus: Status = failedObligationIds.length ? "failed"
    : complete ? "verified" : verifiedObligationIds.length || hasPartial ? "partial" : "unverified";
  const valid = !dishonestReceipt && proof.verificationStatus === verificationStatus;
  if (dishonestReceipt) gaps.push("Receipt claims exceed or contradict trusted observations");
  if (proof.verificationStatus !== verificationStatus) gaps.push("Claimed proof status does not match actual coverage");
  return { valid, complete: valid && complete, passed: valid && complete && verificationStatus === "verified",
    verificationStatus: !valid && verificationStatus === "verified" ? "partial" : verificationStatus,
    verifiedObligationIds, failedObligationIds, missingObligationIds, unresolvedObligationIds, gaps };
}
