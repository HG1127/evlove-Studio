import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HtmlProtectionEvidence, HtmlProtectionProofBinding } from "@evolution/contracts";
import {
  attestServerHtmlProtectionExecution,
  verifyServerHtmlProtectionExecutionAttestation,
  type ServerHtmlProtectionAttestation,
  type ServerHtmlProtectionCollectedExecution,
  type ServerHtmlProtectionSigningConfig,
} from "./server-html-protection-attestation";

const NOW = Date.parse("2026-10-12T12:00:01.000Z");
// Synthetic isolated material; these values are never read from environment or production.
const config: ServerHtmlProtectionSigningConfig = {
  keyId: "synthetic-key-1", key: "synthetic-only-signing-material-0001",
  verificationKeys: { "synthetic-key-1": "synthetic-only-signing-material-0001" },
};
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fixture(): ServerHtmlProtectionCollectedExecution {
  const binding: HtmlProtectionProofBinding = {
    missionId: "mission-synthetic", testCaseId: "hidden-protect", criterionId: "PROTECT-ALL",
    paperSha256: "c".repeat(64),
    original: { sourceArtifactId: "source-html", sha256: "a".repeat(64), byteLength: 1200 },
    executed: { sourceArtifactId: "source-html", sha256: "b".repeat(64), byteLength: 1300 },
    subject: { kind: "candidate", candidateId: "candidate-synthetic-1" },
  };
  const evidence = (id: string, kind: HtmlProtectionEvidence["kind"], producer: HtmlProtectionEvidence["producer"],
    verificationStatus: HtmlProtectionEvidence["verificationStatus"], obligationId: string): HtmlProtectionEvidence => ({
    schemaVersion: "html-protection-evidence-v1", id, binding, kind, producer, obligationIds: [obligationId],
    verificationStatus, observedAt: "2026-10-12T12:00:00.000Z",
  });
  return {
    policyVersion: "html-protection-policy-synthetic-v1", binding,
    requiredObligations: [
      { id: "format", sourceArtifactId: "source-html", kind: "html-format", target: "document",
        description: "Literal HTML document identity", evidenceKind: "static", support: "supported" },
      { id: "search", sourceArtifactId: "source-html", kind: "browser-behavior", target: "#search",
        description: "Actual hidden-to-visible search", evidenceKind: "browser", support: "supported" },
      { id: "method", sourceArtifactId: "source-html", kind: "core-method", target: "SOP",
        description: "Full protected method comparison", evidenceKind: "semantic", support: "supported" },
    ],
    trustedEvidence: [
      evidence("format-observed", "static", "core-static", "verified", "format"),
      evidence("search-failed", "browser", "browser-runner", "failed", "search"),
      evidence("method-partial", "semantic", "semantic-runtime", "partial", "method"),
    ],
    canonicalRun: {
      testCaseId: binding.testCaseId, artifactHash: binding.executed.sha256,
      output: "Actual assertion search failed. Full method scope not yet complete.",
      latencyMs: 8, cost: 0, verificationStatus: "partial",
      trace: [{ id: "search-assertion", stage: "browser-step", status: "fail", summary: "Actual visibility mismatch" }],
    },
    execution: { executionId: "execution-synthetic-1", jobId: "job-synthetic-1", generation: 1,
      observedAt: "2026-10-12T12:00:00.100Z", expiresAt: "2026-10-12T12:10:00.000Z" },
  };
}
function verify(attestation: unknown, collected = fixture(), overrides: Partial<Parameters<typeof verifyServerHtmlProtectionExecutionAttestation>[0]> = {},
  signing: ServerHtmlProtectionSigningConfig | undefined = config) {
  return verifyServerHtmlProtectionExecutionAttestation({
    attestation, expectedBinding: collected.binding, requiredObligations: collected.requiredObligations,
    policyVersion: collected.policyVersion, canonicalRun: collected.canonicalRun,
    expectedExecution: { executionId: collected.execution.executionId, jobId: collected.execution.jobId,
      generation: collected.execution.generation }, now: NOW, ...overrides,
  }, signing);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function signedMaterial(attestation: ServerHtmlProtectionAttestation) {
  const { signature, ...material } = attestation;
  void signature;
  return material;
}

describe("internal HTML protection execution attestation", () => {
  it("restores independently expected context without asserting completeness or product PASS", () => {
    const collected = fixture();
    const runBefore = copy(collected.canonicalRun);
    const attestation = attestServerHtmlProtectionExecution(collected, config);
    const result = verify(attestation, collected)!;
    expect(result.expectedBinding).toEqual(collected.binding);
    expect(result.requiredObligations).toEqual(collected.requiredObligations);
    expect(result.trustedEvidence).toHaveLength(3);
    expect(result.trustedEvidence.find(item => item.id === "search-failed")?.verificationStatus).toBe("failed");
    expect(result.trustedEvidence.find(item => item.id === "method-partial")?.verificationStatus).toBe("partial");
    expect(result.canonicalRun).toEqual(runBefore);
    expect(collected.canonicalRun).toEqual(runBefore);
    expect(result).not.toHaveProperty("passed");
    expect(result).not.toHaveProperty("complete");
  });
  it("accepts a truthful unverified collection with no observations without upgrading its Run", () => {
    const collected = fixture();
    collected.trustedEvidence = [];
    collected.canonicalRun.verificationStatus = "unverified";
    expect(verify(attestServerHtmlProtectionExecution(collected, config), collected)?.canonicalRun.verificationStatus).toBe("unverified");
  });
  it("binds all canonical Run fields including failure detail", () => {
    const collected = fixture();
    const attestation = attestServerHtmlProtectionExecution(collected, config);
    collected.canonicalRun.trace[0]!.summary = "invented pass";
    expect(verify(attestation, collected)).toBeUndefined();
  });
  it("is insensitive to object insertion order and independent obligation ordering", () => {
    const collected = fixture();
    const attestation = attestServerHtmlProtectionExecution(collected, config);
    const reversed = copy(collected);
    reversed.requiredObligations.reverse();
    reversed.canonicalRun = { trace: reversed.canonicalRun.trace, output: reversed.canonicalRun.output,
      verificationStatus: reversed.canonicalRun.verificationStatus, artifactHash: reversed.canonicalRun.artifactHash,
      cost: reversed.canonicalRun.cost, latencyMs: reversed.canonicalRun.latencyMs, testCaseId: reversed.canonicalRun.testCaseId };
    expect(verify(attestation, reversed)).toBeDefined();
  });
  it("copies validated collected material so later input mutation cannot alter a signature envelope", () => {
    const collected = fixture();
    const attestation = attestServerHtmlProtectionExecution(collected, config);
    collected.trustedEvidence[1]!.verificationStatus = "verified";
    expect(attestation.trustedEvidence.find(item => item.id === "search-failed")?.verificationStatus).toBe("failed");
    expect(verify(attestation, fixture())).toBeDefined();
  });
  it("verifies historical keys after injected key rotation", () => {
    const attestation = attestServerHtmlProtectionExecution(fixture(), config);
    const rotated = { keyId: "synthetic-key-2", key: "synthetic-only-signing-material-0002",
      verificationKeys: { ...config.verificationKeys, "synthetic-key-2": "synthetic-only-signing-material-0002" } };
    expect(verify(attestation, fixture(), {}, rotated)).toBeDefined();
  });
  it.each([
    ["absent", undefined],
    ["short", { ...config, key: "short" }],
    ["active-key-unknown", { ...config, verificationKeys: {} }],
    ["active-key-conflict", { ...config, verificationKeys: { [config.keyId]: "synthetic-only-signing-material-wrong" } }],
  ])("refuses issuance when signing configuration is %s", (_label, signing) => {
    expect(() => attestServerHtmlProtectionExecution(fixture(), signing)).toThrow("signing is unavailable");
  });
  it("does not echo injected key values in configuration errors", () => {
    const confidential = "not-for-error-output";
    expect(() => attestServerHtmlProtectionExecution(fixture(), { ...config, key: confidential })).toThrow("signing is unavailable");
    try { attestServerHtmlProtectionExecution(fixture(), { ...config, key: confidential }); }
    catch (error) { expect(String(error)).not.toContain(confidential); }
  });
  it("refuses verification without configured verification keys", () => {
    const attestation = attestServerHtmlProtectionExecution(fixture(), config);
    expect(verifyServerHtmlProtectionExecutionAttestation({
      attestation, expectedBinding: fixture().binding, requiredObligations: fixture().requiredObligations,
      policyVersion: fixture().policyVersion, canonicalRun: fixture().canonicalRun,
      expectedExecution: { executionId: "execution-synthetic-1", jobId: "job-synthetic-1", generation: 1 }, now: NOW,
    })).toBeUndefined();
  });

  it.each([
    ["Mission", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.missionId = "another-mission"; }],
    ["Candidate", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.subject = { kind: "candidate", candidateId: "candidate-other" }; }],
    ["current arm", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.subject = { kind: "current", versionId: "current-v1" }; }],
    ["test", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.testCaseId = "other-test"; }],
    ["criterion", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.criterionId = "OTHER"; }],
    ["paper", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.paperSha256 = "d".repeat(64); }],
    ["original bytes", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.original.sha256 = "d".repeat(64); }],
    ["executed bytes", (c: ServerHtmlProtectionCollectedExecution) => { c.binding.executed.byteLength++; }],
    ["policy", (c: ServerHtmlProtectionCollectedExecution) => { c.policyVersion = "changed-policy"; }],
    ["missing obligation", (c: ServerHtmlProtectionCollectedExecution) => { c.requiredObligations.pop(); }],
    ["changed obligation", (c: ServerHtmlProtectionCollectedExecution) => { c.requiredObligations[0]!.description = "weaker"; }],
    ["duplicate obligation", (c: ServerHtmlProtectionCollectedExecution) => { c.requiredObligations.push(c.requiredObligations[0]!); }],
    ["output", (c: ServerHtmlProtectionCollectedExecution) => { c.canonicalRun.output = "invented success"; }],
    ["Run status", (c: ServerHtmlProtectionCollectedExecution) => { c.canonicalRun.verificationStatus = "verified"; }],
    ["cost", (c: ServerHtmlProtectionCollectedExecution) => { c.canonicalRun.cost = 20; }],
    ["generation", (c: ServerHtmlProtectionCollectedExecution) => { c.execution.generation++; }],
    ["job", (c: ServerHtmlProtectionCollectedExecution) => { c.execution.jobId = "new-job"; }],
    ["execution", (c: ServerHtmlProtectionCollectedExecution) => { c.execution.executionId = "new-execution"; }],
  ])("rejects a valid attestation against changed independent %s", (_label, mutate) => {
    const attestation = attestServerHtmlProtectionExecution(fixture(), config);
    const expected = copy(fixture());
    mutate(expected);
    expect(verify(attestation, expected)).toBeUndefined();
  });

  it.each([
    ["missing failed observation", (a: ServerHtmlProtectionAttestation) => { a.trustedEvidence = a.trustedEvidence.filter(item => item.verificationStatus !== "failed"); }],
    ["failure hidden", (a: ServerHtmlProtectionAttestation) => { a.trustedEvidence.find(item => item.id === "search-failed")!.verificationStatus = "verified"; }],
    ["unknown signature key", (a: ServerHtmlProtectionAttestation) => { a.signatureKeyId = "unknown-key"; }],
    ["wrong signature", (a: ServerHtmlProtectionAttestation) => { a.signature = "e".repeat(64); }],
    ["missing signature", (a: ServerHtmlProtectionAttestation) => { delete (a as Partial<ServerHtmlProtectionAttestation>).signature; }],
    ["extra field", (a: ServerHtmlProtectionAttestation) => { Object.assign(a, { complete: true }); }],
    ["binding edit", (a: ServerHtmlProtectionAttestation) => { a.binding.missionId = "different"; }],
    ["expiry extension", (a: ServerHtmlProtectionAttestation) => { a.execution.expiresAt = "2027-10-12T12:10:00.000Z"; }],
  ])("rejects envelope tampering: %s", (_label, mutate) => {
    const attestation = copy(attestServerHtmlProtectionExecution(fixture(), config));
    mutate(attestation);
    expect(verify(attestation)).toBeUndefined();
  });
  it.each(["constructor", "__proto__", "toString"])("rejects inherited verification-key identity %s", keyId => {
    const attestation = copy(attestServerHtmlProtectionExecution(fixture(), config));
    attestation.signatureKeyId = keyId;
    expect(verify(attestation)).toBeUndefined();
  });
  it("binds signature key ID even when another key ID resolves to the same key", () => {
    const attestation = copy(attestServerHtmlProtectionExecution(fixture(), config));
    attestation.signatureKeyId = "alias";
    expect(verify(attestation, fixture(), {}, { ...config,
      verificationKeys: { ...config.verificationKeys, alias: config.key } })).toBeUndefined();
  });
  it("rejects a wrong purpose in a well formed envelope", () => {
    const attestation = attestServerHtmlProtectionExecution(fixture(), config);
    expect(verify({ ...attestation, purpose: "evolution-evidence-ledger-v1" })).toBeUndefined();
  });
  it("rejects an otherwise valid HMAC made under a different purpose", () => {
    const attestation = attestServerHtmlProtectionExecution(fixture(), config);
    const signature = createHmac("sha256", config.key).update("other-purpose\0").update(canonical(signedMaterial(attestation))).digest("hex");
    expect(verify({ ...attestation, signature })).toBeUndefined();
  });
  it("rejects a valid generic Ledger-style content-hash signature", () => {
    const attestation = attestServerHtmlProtectionExecution(fixture(), config);
    const contentHash = createHash("sha256").update(canonical(signedMaterial(attestation))).digest("hex");
    const ledgerSignature = createHmac("sha256", config.key).update(contentHash).digest("hex");
    expect(verify({ ...attestation, signature: ledgerSignature })).toBeUndefined();
  });
  it.each([
    ["expiry boundary", Date.parse("2026-10-12T12:10:00.000Z")],
    ["expired", Date.parse("2026-10-12T12:10:00.001Z")],
    ["future observation", Date.parse("2026-10-12T12:00:00.099Z")],
    ["NaN clock", Number.NaN],
    ["infinite clock", Number.POSITIVE_INFINITY],
  ])("rejects %s", (_label, now) => {
    expect(verify(attestServerHtmlProtectionExecution(fixture(), config), fixture(), { now })).toBeUndefined();
  });
  it.each([
    ["foreign observation", (c: ServerHtmlProtectionCollectedExecution) => { c.trustedEvidence[0]!.binding = { ...c.binding, missionId: "foreign" }; }],
    ["duplicate observation", (c: ServerHtmlProtectionCollectedExecution) => { c.trustedEvidence.push(c.trustedEvidence[0]!); }],
    ["unknown obligation", (c: ServerHtmlProtectionCollectedExecution) => { c.trustedEvidence[0]!.obligationIds = ["absent"]; }],
    ["repeated scope", (c: ServerHtmlProtectionCollectedExecution) => { c.trustedEvidence[0]!.obligationIds.push("format"); }],
    ["wrong kind", (c: ServerHtmlProtectionCollectedExecution) => { c.trustedEvidence[0]!.obligationIds = ["search"]; }],
    ["future producer observation", (c: ServerHtmlProtectionCollectedExecution) => { c.trustedEvidence[0]!.observedAt = "2026-10-12T12:00:01.000Z"; }],
    ["invalid expiry", (c: ServerHtmlProtectionCollectedExecution) => { c.execution.expiresAt = c.execution.observedAt; }],
    ["Run wrong test", (c: ServerHtmlProtectionCollectedExecution) => { c.canonicalRun.testCaseId = "foreign"; }],
    ["Run wrong bytes", (c: ServerHtmlProtectionCollectedExecution) => { c.canonicalRun.artifactHash = "d".repeat(64); }],
  ])("refuses to sign conflicting collected material: %s", (_label, mutate) => {
    const collected = copy(fixture());
    mutate(collected);
    expect(() => attestServerHtmlProtectionExecution(collected, config)).toThrow("conflicting identity, scope or time");
  });
  it("rejects unknown boundary fields rather than signing stripped client additions", () => {
    const collected = { ...fixture(), callerClaimsComplete: true };
    expect(() => attestServerHtmlProtectionExecution(collected, config)).toThrow("Invalid HTML protection collected execution boundary");
    const withExtraRun = copy(fixture());
    Object.assign(withExtraRun.canonicalRun, { trusted: true });
    expect(() => attestServerHtmlProtectionExecution(withExtraRun, config)).toThrow("Invalid HTML protection collected execution boundary");
  });
  it("attests a fully observed product failure without changing the verified Run or claiming PASS", () => {
    const collected = fixture();
    collected.trustedEvidence.find(item => item.id === "method-partial")!.verificationStatus = "verified";
    collected.canonicalRun.verificationStatus = "verified";
    const result = verify(attestServerHtmlProtectionExecution(collected, config), collected)!;
    expect(result.canonicalRun.verificationStatus).toBe("verified");
    expect(result.trustedEvidence.find(item => item.id === "search-failed")?.verificationStatus).toBe("failed");
    expect(result).not.toHaveProperty("passed");
  });
  it("binds the transported proof but never promotes its own claims to trusted observations", () => {
    const collected = fixture();
    collected.canonicalRun.htmlProtectionProof = { schemaVersion: "html-protection-proof-v1", binding: copy(collected.binding),
      requiredObligations: copy(collected.requiredObligations), receipts: [], evidence: [], verificationStatus: "unverified" };
    const attestation = attestServerHtmlProtectionExecution(collected, config);
    expect(verify(attestation, collected)?.trustedEvidence).toHaveLength(3);
    collected.canonicalRun.htmlProtectionProof.verificationStatus = "verified";
    expect(verify(attestation, collected)).toBeUndefined();
  });
  it("refuses to sign a transported proof bound to another subject", () => {
    const collected = fixture();
    collected.canonicalRun.htmlProtectionProof = { schemaVersion: "html-protection-proof-v1", binding: {
      ...copy(collected.binding), subject: { kind: "candidate", candidateId: "foreign-candidate" } },
      requiredObligations: copy(collected.requiredObligations), receipts: [], evidence: [], verificationStatus: "unverified" };
    expect(() => attestServerHtmlProtectionExecution(collected, config)).toThrow("conflicting identity, scope or time");
  });
  it.each(["constructor", "__proto__", "toString"])("refuses inherited active signing-key identity %s", keyId => {
    expect(() => attestServerHtmlProtectionExecution(fixture(), { ...config, keyId, verificationKeys: {} }))
      .toThrow("signing is unavailable");
  });
  it("does not accept proof-supplied observations as a substitute for missing independent expectations", () => {
    const attestation = attestServerHtmlProtectionExecution(fixture(), config);
    expect(verify(attestation, fixture(), { expectedBinding: undefined })).toBeUndefined();
    expect(verify(attestation, fixture(), { requiredObligations: undefined })).toBeUndefined();
    expect(verify(attestation, fixture(), { expectedExecution: undefined })).toBeUndefined();
    expect(verify(attestation, fixture(), { canonicalRun: undefined })).toBeUndefined();
    expect(verify(attestation, fixture(), { policyVersion: undefined })).toBeUndefined();
  });
});
