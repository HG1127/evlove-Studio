import { describe, expect, it } from "vitest";
import type { HtmlProtectionEvidence, HtmlProtectionObligation, HtmlProtectionProofBinding } from "@evolution/contracts";
import { assembleHtmlProtectionProof } from "./html-protection-proof-assembly";
const binding: HtmlProtectionProofBinding = { missionId: "mission", testCaseId: "H", criterionId: "whole", paperSha256: "a".repeat(64),
  original: { sourceArtifactId: "source", sha256: "b".repeat(64), byteLength: 100 }, executed: { sourceArtifactId: "source", sha256: "c".repeat(64), byteLength: 101 }, subject: { kind: "candidate", candidateId: "C" } };
const obligation: HtmlProtectionObligation = { id: "unknown", sourceArtifactId: "source", kind: "unknown-runtime", target: "document", description: "Full unknown scope", evidenceKind: "browser", support: "unresolved" };
const evidence = (status: HtmlProtectionEvidence["verificationStatus"]): HtmlProtectionEvidence => ({ schemaVersion: "html-protection-evidence-v1", id: "E", binding,
  kind: "browser", producer: "browser-runner", obligationIds: [obligation.id], verificationStatus: status, observedAt: "2026-10-14T12:00:00Z" });
describe("ordinary full proof assembly", () => {
  it.each(["unverified", "partial", "verified"] as const)("retains honest %s unknown-scope observations as incomplete", status => {
    const result = assembleHtmlProtectionProof({ binding, requiredObligations: [obligation], trustedEvidence: [evidence(status)] });
    expect(result.validation).toMatchObject({ valid: true, complete: false, passed: false, verificationStatus: "partial" });
    expect(result.validation.unresolvedObligationIds).toEqual([obligation.id]);
  });
  it("retains actual failed unknown scope and cannot promote it to complete", () => {
    const result = assembleHtmlProtectionProof({ binding, requiredObligations: [obligation], trustedEvidence: [evidence("failed")] });
    expect(result.validation).toMatchObject({ valid: true, complete: false, passed: false, verificationStatus: "failed", failedObligationIds: [obligation.id] });
  });
  it("retains missing receipts without truncating unknown scope", () => {
    expect(assembleHtmlProtectionProof({ binding, requiredObligations: [obligation], trustedEvidence: [] }).proof.receipts).toEqual([{ obligationId: obligation.id, verificationStatus: "unverified", evidenceIds: [] }]);
  });
  it("rejects foreign observations and duplicate identities", () => {
    expect(() => assembleHtmlProtectionProof({ binding, requiredObligations: [obligation], trustedEvidence: [{ ...evidence("verified"), obligationIds: ["foreign"] }] })).toThrow();
    expect(() => assembleHtmlProtectionProof({ binding, requiredObligations: [obligation], trustedEvidence: [evidence("verified"), evidence("verified")] })).toThrow();
  });
});
