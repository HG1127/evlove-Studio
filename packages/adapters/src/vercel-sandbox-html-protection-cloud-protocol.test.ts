import { describe, expect, it } from "vitest";
import {
  HTML_PROTECTION_CLOUD_URL as url, HTML_PROTECTION_CLOUD_CSP as csp,
  HtmlProtectionCloudInputSchema, HtmlProtectionCloudObservationSchema, HtmlProtectionCloudManifestSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
} from "./vercel-sandbox-html-protection-cloud-protocol";
const digest = "a".repeat(64), material = { sha256: digest, byteLength: 20 };
const artifact = { sourceArtifactId: "source", ...material };
const registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: digest,
  projection: "boot-subtree-v1", targets: [{ targetId: "card", selector: "#card" }] };
const request = { schemaVersion: "html-protection-snapshot-request-v1", sourceRole: "original", documentUrl: url,
  binding: { missionId: "mission", testCaseId: "frozen", criterionId: "protect", paperSha256: digest,
    original: artifact, executed: artifact, subject: { kind: "current", versionId: "v1" } },
  policyVersion: "profile-v1", planSha256: digest, registrySha256: digest, registry,
  execution: { executionId: "execution", jobId: "job", generation: 1 }, stateId: "boot", batchId: "batch" };
const ownedRuntime = { version: "html-protection-private-cloud-v1", sha256: digest, byteLength: 200 };
const input = { schemaVersion: "html-protection-private-input-v1", nonce: digest, request, material, ownedRuntime };
const manifest = { schemaVersion: "html-protection-private-manifest-v1", nonce: digest, requestSha256: digest,
  ownedRuntimeSha256: digest, runnerSha256: digest,
  result: { path: ".evolution/runtime/html-protection-result.json", sha256: digest, byteLength: 100 } };
describe("private owned Sandbox transport envelopes", () => {
  it("binds a closed private input and rejects script/env/runtime code fields", () => {
    expect(HtmlProtectionCloudInputSchema.parse(input)).toEqual(input);
    for (const field of ["script", "env", "command", "runtimeSource", "stdout", "wholeProtectionPassed"])
      expect(HtmlProtectionCloudInputSchema.safeParse({ ...input, [field]: "untrusted" }).success).toBe(false);
  });
  it("requires the fixed standalone document URL and original registry binding", () => {
    expect(HtmlProtectionCloudInputSchema.safeParse({ ...input, request: { ...request, documentUrl: "https://external.invalid/" } }).success).toBe(false);
    expect(HtmlProtectionCloudInputSchema.safeParse({ ...input, request: { ...request, registry: { ...registry, originalSha256: "b".repeat(64) } } }).success).toBe(false);
  });
  it("accepts explicit unavailable capability without inventing observation/custody", () => {
    const observation = { schemaVersion: "html-protection-private-observation-v1", nonce: digest, request, ownedRuntime,
      availability: "unavailable", reason: "observation-unavailable" };
    expect(HtmlProtectionCloudObservationSchema.parse(observation)).toEqual(observation);
    expect(HtmlProtectionCloudObservationSchema.safeParse({ ...observation, snapshot: {} }).success).toBe(false);
  });
  it("cannot pass a manifest pointing at public/foreign data or unbounded result", () => {
    expect(HtmlProtectionCloudManifestSchema.parse(manifest)).toEqual(manifest);
    for (const path of ["dist/index.html", "../result.json", "/etc/passwd", ".evolution/runtime/fake.json"])
      expect(HtmlProtectionCloudManifestSchema.safeParse({ ...manifest, result: { ...manifest.result, path } }).success).toBe(false);
    expect(HtmlProtectionCloudManifestSchema.safeParse({ ...manifest, result: { ...manifest.result, byteLength: 4 * 1024 * 1024 + 1 } }).success).toBe(false);
  });
  it("requires native custody fields rather than page/prose metadata", () => {
    const observation = { schemaVersion: "html-protection-private-observation-v1", nonce: digest, request, ownedRuntime,
      availability: "available", custody: { staged: material, nodeResponse: material, browserResponse: material,
        documentUrl: url, status: 200, contentType: "text/html", contentSecurityPolicy: csp, fromServiceWorker: false, blockedRequests: 0 },
      snapshot: {} };
    expect(HtmlProtectionCloudObservationSchema.safeParse(observation).success).toBe(false);
    expect(HtmlProtectionCloudObservationSchema.safeParse({ ...observation, pageReturnedJson: "complete" }).success).toBe(false);
  });
  it("canonicalizes full UTF-8 bytes without clipping or key-order-dependent hashes", () => {
    const left = { tail: "完整😄", nested: { b: 1, a: true } }, right = { nested: { a: true, b: 1 }, tail: "完整😄" };
    expect(canonical(left)).toBe(canonical(right)); expect(sha(canonical(left))).toBe(sha(canonical(right)));
    expect(() => canonical(undefined)).toThrow();
  });
});
