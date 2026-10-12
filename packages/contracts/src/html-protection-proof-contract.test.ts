import { TargetRunResultSchema } from "./evolve-schemas";
import { describe, expect, it } from "vitest";
import { HtmlProtectionEvidenceSchema, HtmlProtectionObligationSchema, HtmlProtectionProofBindingSchema, HtmlProtectionProofSchema } from "./html-protection-proof-contract";

const binding = {
  missionId: "mission", testCaseId: "H1", criterionId: "PROTECT-ALL", paperSha256: "a".repeat(64),
  original: { sourceArtifactId: "source", sha256: "b".repeat(64), byteLength: 100 },
  executed: { sourceArtifactId: "source", sha256: "c".repeat(64), byteLength: 110 },
  subject: { kind: "candidate", candidateId: "C1" },
};
const obligation = { id: "card-1", sourceArtifactId: "source", kind: "card-content", target: "#slide-1", description: "Retain original card content", evidenceKind: "static", support: "supported" };
const evidence = { schemaVersion: "html-protection-evidence-v1", id: "E1", binding, kind: "static", producer: "core-static", obligationIds: ["card-1"], verificationStatus: "verified", observedAt: "2026-10-12T00:00:00.000Z" };

describe("HTML protection transport boundaries", () => {
  it("accepts additive versioned evidence with exact identities", () => {
    expect(HtmlProtectionProofSchema.safeParse({
      schemaVersion: "html-protection-proof-v1", binding, requiredObligations: [obligation],
      receipts: [{ obligationId: "card-1", verificationStatus: "verified", evidenceIds: ["E1"] }],
      evidence: [evidence], verificationStatus: "verified",
    }).success).toBe(true);
  });
  it.each([
    { schemaVersion: "html-protection-proof-v0" },
    { tags: ["full-protection"], trace: [{ status: "pass" }] },
    { requiredObligations: [] },
  ])("rejects incompatible versions, trace substitutes and empty manifests", (patch) => {
    expect(HtmlProtectionProofSchema.safeParse({ schemaVersion: "html-protection-proof-v1", binding,
      requiredObligations: [obligation], receipts: [], evidence: [], verificationStatus: "unverified", ...patch }).success).toBe(false);
  });
  it.each([
    { original: { ...binding.original, sha256: "unknown" } },
    { original: { ...binding.original, byteLength: 0 } },
    { executed: { ...binding.executed, sourceArtifactId: "another-source" } },
    { subject: { kind: "current", versionId: "v1", candidateId: "C1" } },
    { subject: { kind: "candidate" } },
  ])("rejects ambiguous or missing artifact/subject identity", (patch) => {
    expect(HtmlProtectionProofBindingSchema.safeParse({ ...binding, ...patch }).success).toBe(false);
  });
  it("does not permit unknown runtime obligations to be labelled supported", () => {
    expect(HtmlProtectionObligationSchema.safeParse({ ...obligation, kind: "unknown-runtime", evidenceKind: "browser" }).success).toBe(false);
    expect(HtmlProtectionObligationSchema.safeParse({ ...obligation, kind: "unknown-runtime", evidenceKind: "browser", support: "unresolved" }).success).toBe(true);
  });
  it("requires actual observation kinds for browser and visual obligations", () => {
    expect(HtmlProtectionObligationSchema.safeParse({ ...obligation, kind: "browser-behavior" }).success).toBe(false);
    expect(HtmlProtectionObligationSchema.safeParse({ ...obligation, kind: "visual-layout" }).success).toBe(false);
  });
  it("rejects a static producer masquerading as browser evidence", () => {
    expect(HtmlProtectionEvidenceSchema.safeParse({ ...evidence, kind: "browser" }).success).toBe(false);
  });
});

describe("TargetRunResult compatibility", () => {
  it("keeps old execution results valid without manufacturing a proof", () => {
    const result = TargetRunResultSchema.parse({ testCaseId: "H1", output: "observed", latencyMs: 1, cost: 0, trace: [] });
    expect(result.htmlProtectionProof).toBeUndefined();
  });
  it("preserves the full structured proof through the storage boundary", () => {
    const proof = HtmlProtectionProofSchema.parse({ schemaVersion: "html-protection-proof-v1", binding,
      requiredObligations: [obligation], receipts: [{ obligationId: "card-1", verificationStatus: "verified", evidenceIds: ["E1"] }],
      evidence: [evidence], verificationStatus: "verified" });
    const restored = TargetRunResultSchema.parse(JSON.parse(JSON.stringify({ testCaseId: "H1", output: "observed", latencyMs: 1, cost: 0, trace: [], htmlProtectionProof: proof })));
    expect(restored.htmlProtectionProof).toEqual(proof);
  });
});
