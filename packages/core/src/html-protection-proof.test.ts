import { describe, expect, it } from "vitest";
import type { HtmlProtectionEvidence, HtmlProtectionObligation, HtmlProtectionProof, HtmlProtectionProofBinding } from "@evolution/contracts";
import { validateHtmlProtectionProof } from "./html-protection-proof";

const binding: HtmlProtectionProofBinding = {
  missionId: "mission", testCaseId: "H1", criterionId: "PROTECT-ALL", paperSha256: "a".repeat(64),
  original: { sourceArtifactId: "source", sha256: "b".repeat(64), byteLength: 100 },
  executed: { sourceArtifactId: "source", sha256: "c".repeat(64), byteLength: 110 },
  subject: { kind: "candidate", candidateId: "C1" },
};
const obligation = (id = "card-1"): HtmlProtectionObligation => ({ id, sourceArtifactId: "source",
  kind: "card-content", target: "#" + id, description: "Retain original card", evidenceKind: "static", support: "supported" });
function fixture(required: HtmlProtectionObligation[] = [obligation()]) {
  const evidence: HtmlProtectionEvidence[] = required.map((item, index) => ({ schemaVersion: "html-protection-evidence-v1",
    id: "E" + index, binding, kind: item.evidenceKind,
    producer: ({ static: "core-static", browser: "browser-runner", semantic: "semantic-runtime", visual: "visual-judge", manual: "human" } as const)[item.evidenceKind],
    obligationIds: [item.id], verificationStatus: "verified", observedAt: "2026-10-12T00:00:00.000Z" }));
  const proof: HtmlProtectionProof = { schemaVersion: "html-protection-proof-v1", binding,
    requiredObligations: structuredClone(required), evidence: structuredClone(evidence),
    receipts: required.map((item, index) => ({ obligationId: item.id, verificationStatus: "verified", evidenceIds: ["E" + index] })),
    verificationStatus: "verified" };
  return { proof, expectedBinding: binding, requiredObligations: required, trustedEvidence: evidence };
}

describe("exact HTML protection evidence validation", () => {
  it("accepts complete actual-card coverage with independently supplied observations", () => {
    const args = fixture(Array.from({ length: 111 }, (_, index) => obligation("slide-" + (index + 1))));
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: true, complete: true, passed: true, verificationStatus: "verified" });
    expect(validateHtmlProtectionProof(args).verifiedObligationIds).toHaveLength(111);
  });
  it("allows manifest ordering changes while retaining exact obligation identities", () => {
    const args = fixture([obligation("one"), obligation("two")]);
    args.proof.requiredObligations.reverse();
    expect(validateHtmlProtectionProof(args).passed).toBe(true);
  });
  it.each([
    { missionId: "other" }, { testCaseId: "H2" }, { criterionId: "SYS-INTEGRITY" }, { paperSha256: "d".repeat(64) },
    { original: { ...binding.original, sha256: "d".repeat(64) } },
    { executed: { ...binding.executed, sha256: "d".repeat(64) } },
    { executed: { ...binding.executed, byteLength: 109 } },
    { subject: { kind: "candidate" as const, candidateId: "C2" } },
    { subject: { kind: "current" as const, versionId: "v1" } },
  ])("rejects evidence from another exact comparison", (patch) => {
    const args = fixture(); args.proof.binding = { ...binding, ...patch };
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: false, complete: false, passed: false, verificationStatus: "unverified" });
  });
  it("accepts the independently bound current arm without Candidate substitution", () => {
    const args = fixture(); const current: HtmlProtectionProofBinding = { ...binding, subject: { kind: "current", versionId: "current-v1" } };
    args.expectedBinding = current; args.proof.binding = current;
    args.proof.evidence[0]!.binding = current; args.trustedEvidence[0]!.binding = current;
    expect(validateHtmlProtectionProof(args).passed).toBe(true);
  });
  it.each(["required", "claimed", "receipt", "evidence", "trusted", "receipt-ref", "scope"] as const)("rejects duplicate %s identities", (kind) => {
    const args = fixture();
    if (kind === "required") args.requiredObligations.push(obligation());
    if (kind === "claimed") args.proof.requiredObligations.push(obligation());
    if (kind === "receipt") args.proof.receipts.push(structuredClone(args.proof.receipts[0]!));
    if (kind === "evidence") args.proof.evidence.push(structuredClone(args.proof.evidence[0]!));
    if (kind === "trusted") args.trustedEvidence.push(structuredClone(args.trustedEvidence[0]!));
    if (kind === "receipt-ref") args.proof.receipts[0]!.evidenceIds.push("E0");
    if (kind === "scope") { args.proof.evidence[0]!.obligationIds.push("card-1"); args.trustedEvidence[0]!.obligationIds.push("card-1"); }
    expect(validateHtmlProtectionProof(args).passed).toBe(false);
    expect(validateHtmlProtectionProof(args).valid).toBe(false);
  });
  it.each(["omit", "alter", "extra"] as const)("rejects a %s required manifest", (kind) => {
    const args = fixture([obligation("one"), obligation("two")]);
    if (kind === "omit") args.proof.requiredObligations.pop();
    if (kind === "alter") args.proof.requiredObligations[0]!.target = "#replacement";
    if (kind === "extra") args.proof.requiredObligations.push(obligation("three"));
    expect(validateHtmlProtectionProof(args).valid).toBe(false);
  });
  it("cannot prove its own observations or cite a tag/trace instead", () => {
    const args = fixture(); args.trustedEvidence = [];
    expect(validateHtmlProtectionProof(args).passed).toBe(false);
    args.proof = { tags: ["full-protection"], trace: [{ status: "pass" }] } as unknown as HtmlProtectionProof;
    expect(validateHtmlProtectionProof(args).valid).toBe(false);
  });
  it("keeps omitted middle-card receipts partial despite original ID existence", () => {
    const args = fixture([obligation("first"), obligation("middle"), obligation("last")]);
    args.proof.receipts.splice(1, 1); args.proof.evidence.splice(1, 1); args.trustedEvidence.splice(1, 1);
    args.proof.verificationStatus = "partial";
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: true, complete: false, passed: false, verificationStatus: "partial", missingObligationIds: ["middle"] });
  });
  it("cannot use static equality or semantic scores as runtime evidence", () => {
    const runtime: HtmlProtectionObligation = { ...obligation(), kind: "browser-behavior", evidenceKind: "browser" };
    const args = fixture([runtime]);
    args.proof.evidence[0]!.kind = "static"; args.proof.evidence[0]!.producer = "core-static";
    args.trustedEvidence = structuredClone(args.proof.evidence);
    expect(validateHtmlProtectionProof(args).valid).toBe(false);
  });
  it("keeps unknown runtime obligations unresolved even with a claimed browser pass", () => {
    const unknown: HtmlProtectionObligation = { ...obligation("script-unknown"), kind: "unknown-runtime", evidenceKind: "browser", support: "unresolved" };
    const args = fixture([obligation(), unknown]);
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: false, complete: false, passed: false, verificationStatus: "partial", unresolvedObligationIds: ["script-unknown"] });
  });
  it("preserves an honestly unverified unknown runtime obligation", () => {
    const unknown: HtmlProtectionObligation = { ...obligation("script-unknown"), kind: "unknown-runtime", evidenceKind: "browser", support: "unresolved" };
    const args = fixture([obligation(), unknown]);
    args.proof.evidence.pop(); args.trustedEvidence.pop();
    args.proof.receipts[1] = { obligationId: unknown.id, verificationStatus: "unverified", evidenceIds: [] };
    args.proof.verificationStatus = "partial";
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: true, complete: false, passed: false, verificationStatus: "partial" });
  });
  it("does not promote partial browser observations to a complete receipt", () => {
    const args = fixture(); args.proof.evidence[0]!.verificationStatus = "partial";
    args.trustedEvidence = structuredClone(args.proof.evidence);
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: false, complete: false, verificationStatus: "partial" });
  });
  it("reports a fully observed protection violation as failed, not missing capability", () => {
    const args = fixture(); args.proof.evidence[0]!.verificationStatus = "failed";
    args.proof.receipts[0]!.verificationStatus = "failed"; args.proof.verificationStatus = "failed";
    args.trustedEvidence = structuredClone(args.proof.evidence);
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: true, complete: true, passed: false, verificationStatus: "failed", failedObligationIds: ["card-1"] });
  });
  it("does not allow an observed violation to be relabelled as success", () => {
    const args = fixture(); args.proof.evidence[0]!.verificationStatus = "failed";
    args.trustedEvidence = structuredClone(args.proof.evidence);
    expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: false, passed: false, verificationStatus: "failed" });
  });
  it("does not permit an omitted trusted failure to be hidden behind a passing observation", () => {
    const args = fixture();
    args.trustedEvidence.push({ ...args.trustedEvidence[0]!, id: "known-failure", verificationStatus: "failed" });
    expect(validateHtmlProtectionProof(args).passed).toBe(false);
  });
  it("requires observations to name the exact obligation, not just the same file", () => {
    const args = fixture([obligation("one"), obligation("two")]);
    args.proof.receipts[1]!.evidenceIds = ["E0"];
    expect(validateHtmlProtectionProof(args).valid).toBe(false);
  });
});

it("never exposes verified status for an invalid aggregate claim", () => {
  const args = fixture(); args.proof.verificationStatus = "partial";
  expect(validateHtmlProtectionProof(args)).toMatchObject({ valid: false, complete: false, passed: false, verificationStatus: "partial" });
});
