import { describe, expect, it } from "vitest";
import type { HtmlProtectionProofBinding, TargetRunResult } from "@evolution/contracts";
import { HTML_PROTECTION_AUTHORITY_POLICY } from "@evolution/core";
import { attestServerHtmlProtectionAuthority, verifyServerHtmlProtectionAuthorityAttestation,authenticateServerHtmlProtectionAuthoritySelection,readAuthenticatedServerHtmlProtectionSelection } from "./server-html-protection-authority-attestation";
import {ServerAiPublicSelectionSchema} from "./server-ai-public-selection";
const now = Date.parse("2026-10-14T12:00:01Z"), config = { keyId: "synthetic-only", key: "synthetic-only-signing-key-00000001",
  verificationKeys: { "synthetic-only": "synthetic-only-signing-key-00000001" } };
function fixture() {
  const binding: HtmlProtectionProofBinding = { missionId: "synthetic", testCaseId: "H", criterionId: "PROTECT-ALL", paperSha256: "a".repeat(64),
    original: { sourceArtifactId: "source", sha256: "b".repeat(64), byteLength: 100 },
    executed: { sourceArtifactId: "source", sha256: "c".repeat(64), byteLength: 101 }, subject: { kind: "candidate", candidateId: "C1" } };
  const canonicalRun: TargetRunResult = { testCaseId: "H", artifactHash: binding.executed.sha256, output: "Actual observations", latencyMs: 1, cost: 0, trace: [], verificationStatus: "partial" };
  const collected = { policyVersion: HTML_PROTECTION_AUTHORITY_POLICY, binding,
    requiredObligations: [{ id: "scope", sourceArtifactId: "source", kind: "browser-behavior" as const, target: "whole", description: "full", evidenceKind: "browser" as const, support: "supported" as const }],
    trustedEvidence: [{ schemaVersion: "html-protection-evidence-v1" as const, id: "E1", binding, kind: "browser" as const, producer: "browser-runner" as const,
      obligationIds: ["scope"], verificationStatus: "partial" as const, observedAt: "2026-10-14T12:00:00Z" }], canonicalRun,
    execution: { executionId: "sdk-run", jobId: "workflow-control-synthetic", generation: 1, observedAt: "2026-10-14T12:00:00.100Z", expiresAt: "2026-10-14T12:10:00Z" } };
  const selection=ServerAiPublicSelectionSchema.parse({version:"server-ai-public-selection-v1",source:"vault",settings:{connectionId:"synthetic",label:"Synthetic",baseUrl:"https://provider.example.test/v1",model:"synthetic-model",protocol:"chat-completions",responseFormat:"json-schema"},
    metadata:{id:"server-ai-default-connection-v1",workspaceId:"synthetic-workspace",name:"Synthetic default",purpose:"Synthetic test",scopes:["ai:default-connection"],version:1,keyId:"synthetic-encryption",algorithm:"aes-256-gcm",createdBy:"synthetic-human",createdAt:"2026-10-14T11:00:00Z",updatedAt:"2026-10-14T11:00:00Z"},sealedRecordSha256:"9".repeat(64)});
  const args = { collected, inputSha256: "1".repeat(64), planSha256: "2".repeat(64), observationSha256: "3".repeat(64), scoringRouteFingerprint: "selected-direct-route",selection };
  const verify = { inputSha256: args.inputSha256, planSha256: args.planSha256, observationSha256: args.observationSha256,
    scoringRouteFingerprint: args.scoringRouteFingerprint, expectedBinding: binding, requiredObligations: collected.requiredObligations,
    policyVersion: collected.policyVersion, canonicalRun, expectedExecution: { executionId: "sdk-run", jobId: "workflow-control-synthetic", generation: 1 }, now,selection };
  return { args, verify };
}
describe("purpose-bound whole authority attestation", () => {
  it("restores truthful partial observations without granting a PASS or completeness", () => {
    const f = fixture(), signed = attestServerHtmlProtectionAuthority(f.args, config);
    expect(verifyServerHtmlProtectionAuthorityAttestation({ ...f.verify, attestation: JSON.parse(JSON.stringify(signed)) }, config)?.trustedEvidence[0]?.verificationStatus).toBe("partial");
    expect(signed).not.toHaveProperty("passed");
  });
  it.each(["inputSha256", "planSha256", "observationSha256", "scoringRouteFingerprint"] as const)("refuses changed independent %s", key => {
    const f = fixture(), signed = attestServerHtmlProtectionAuthority(f.args, config);
    expect(verifyServerHtmlProtectionAuthorityAttestation({ ...f.verify, [key]: key === "scoringRouteFingerprint" ? "other" : "4".repeat(64), attestation: signed }, config)).toBeUndefined();
  });
  it.each(["output", "trace", "status", "generation", "job", "run", "future", "expired"] as const)("refuses %s mutation", key => {
    const f = fixture(), signed = attestServerHtmlProtectionAuthority(f.args, config), check = structuredClone(f.verify);
    if (key === "output") check.canonicalRun.output += " changed";
    if (key === "trace") check.canonicalRun.trace.push({ id: "fake", stage: "assertion", summary: "fake", status: "pass" });
    if (key === "status") check.canonicalRun.verificationStatus = "verified";
    if (key === "generation") check.expectedExecution.generation++;
    if (key === "job") check.expectedExecution.jobId = "foreign";
    if (key === "run") check.expectedExecution.executionId = "foreign";
    if (key === "future") check.now = Date.parse("2026-10-14T11:59:59Z");
    if (key === "expired") check.now = Date.parse("2026-10-14T12:10:00Z");
    expect(verifyServerHtmlProtectionAuthorityAttestation({ ...check, attestation: signed }, config)).toBeUndefined();
  });
  it("cannot substitute a generic Ledger signature or old inner attestation", () => {
    const f = fixture(), signed = attestServerHtmlProtectionAuthority(f.args, config);
    expect(verifyServerHtmlProtectionAuthorityAttestation({ ...f.verify, attestation: signed.executionAttestation }, config)).toBeUndefined();
    const changed = { ...signed, purpose: "evolution-evidence-ledger-v1" };
    expect(verifyServerHtmlProtectionAuthorityAttestation({ ...f.verify, attestation: changed }, config)).toBeUndefined();
  });
  it("requires the exact retained verification key and allows an explicit historical rotation key", () => {
    const f = fixture(), signed = attestServerHtmlProtectionAuthority(f.args, config);
    expect(verifyServerHtmlProtectionAuthorityAttestation({ ...f.verify, attestation: signed }, { ...config, verificationKeys: {} })).toBeUndefined();
    const rotated = { keyId: "synthetic-rotation", key: "synthetic-only-signing-key-00000002", verificationKeys: { ...config.verificationKeys,
      "synthetic-rotation": "synthetic-only-signing-key-00000002" } };
    expect(verifyServerHtmlProtectionAuthorityAttestation({ ...f.verify, attestation: signed }, rotated)).toBeDefined();
  });
  it.each(["label","connectionId","baseUrl","model","protocol","responseFormat","metadata","sealedRecord"] as const)("refuses independent full selection %s drift even with an unchanged record revision",key=>{
    const f=fixture(),signed=attestServerHtmlProtectionAuthority(f.args,config),selection=structuredClone(f.verify.selection);
    if(key==="label"||key==="connectionId"||key==="model")selection.settings[key]+="-changed";
    if(key==="baseUrl")selection.settings.baseUrl="https://other.example.test/v1";
    if(key==="protocol")selection.settings.protocol="responses";if(key==="responseFormat")selection.settings.responseFormat="json-object";
    if(key==="metadata")selection.metadata.purpose+="changed";if(key==="sealedRecord")selection.sealedRecordSha256="8".repeat(64);
    expect(verifyServerHtmlProtectionAuthorityAttestation({...f.verify,selection,attestation:signed},config)).toBeUndefined();
    const tampered={...signed,selection};expect(authenticateServerHtmlProtectionAuthoritySelection({...f.verify,attestation:tampered},config)).toBeUndefined();
  });
  it("authenticates selection provenance only, rejects DTO copies, and still requires independent complete-obligation reconstruction",()=>{
    const f=fixture(),signed=attestServerHtmlProtectionAuthority(f.args,config),cap=authenticateServerHtmlProtectionAuthoritySelection({...f.verify,attestation:signed},config)!;
    expect(readAuthenticatedServerHtmlProtectionSelection(cap)).toEqual(f.args.selection);
    expect(cap).not.toHaveProperty("passed");expect(()=>readAuthenticatedServerHtmlProtectionSelection(JSON.parse(JSON.stringify(cap)))).toThrow("provenance-unavailable");
    const changed=structuredClone(f.verify.requiredObligations);changed[0]!.description+="different whole scope";
    expect(verifyServerHtmlProtectionAuthorityAttestation({...f.verify,requiredObligations:changed,attestation:signed},config)).toBeUndefined();
  });
  it("rejects old selection-less envelopes, forged identity and changed canonical context before a stored settings DTO can be consumed",()=>{
    const f=fixture(),signed=attestServerHtmlProtectionAuthority(f.args,config);
    const {selection,selectionIdentitySha256,...old}=signed;void selection;void selectionIdentitySha256;
    expect(authenticateServerHtmlProtectionAuthoritySelection({...f.verify,attestation:{...old,schemaVersion:"html-protection-authority-attestation-v1"}},config)).toBeUndefined();
    expect(authenticateServerHtmlProtectionAuthoritySelection({...f.verify,attestation:{...signed,selectionIdentitySha256:"8".repeat(64)}},config)).toBeUndefined();
    expect(authenticateServerHtmlProtectionAuthoritySelection({...f.verify,canonicalRun:{...f.verify.canonicalRun,output:"foreign"},attestation:signed},config)).toBeUndefined();
  });
});
