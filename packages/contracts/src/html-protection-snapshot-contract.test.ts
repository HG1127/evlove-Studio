import { describe, expect, it } from "vitest";
import {
  HTML_PROTECTION_SNAPSHOT_LIMITS, HtmlProtectionSnapshotBodySchema,
  HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotResultSchema,
  HtmlProtectionSnapshotLimitations,
} from "./html-protection-snapshot-contract";

const sha = "a".repeat(64);
const artifact = { sourceArtifactId: "source", sha256: sha, byteLength: 10 };
const binding = { missionId: "mission", testCaseId: "frozen-test", criterionId: "PROTECT-ALL",
  paperSha256: sha, original: artifact, executed: artifact, subject: { kind: "current", versionId: "v1" } };
const registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: sha,
  projection: "boot-subtree-v1", targets: [{ targetId: "card", selector: "#card" }] };
const request = { schemaVersion: "html-protection-snapshot-request-v1", binding, sourceRole: "executed",
  documentUrl: "about:blank", policyVersion: "profile-v1", planSha256: sha, registrySha256: sha, registry,
  execution: { executionId: "exec", jobId: "job", generation: 1 }, stateId: "boot", batchId: "batch" };
const node = { index: 0, parent: null, edge: "root", type: 1, name: "ARTICLE", namespace: "http://www.w3.org/1999/xhtml",
  value: null, attributes: [{ name: "id", namespace: null, value: "card" }], assignedIndexes: [], assignedOutsideTarget: 0 };
const body = { projection: "boot-subtree-v1", targets: [{ targetId: "card", matchCount: 1, nodes: [node] }],
  counters: { scannedNodes: 8, collectedNodes: 1, shadowRoots: 0, textUtf8Bytes: 4 }, gaps: [] };
const result = { schemaVersion: "html-protection-snapshot-result-v1", request, availability: "available",
  projectionComplete: true, observedAt: "2026-10-13T00:00:00Z", physicalInput: { sha256: sha, byteLength: 10 },
  realm: { observerVersion: "chromium-cdp-isolated-dom-v1", frameId: "frame", loaderId: "loader", uniqueContextId: "isolated" },
  body, bodySha256: sha, bodyUtf8Bytes: 600, gaps: [], limitations: [...HtmlProtectionSnapshotLimitations] };

describe("closed HTML protection snapshot transport", () => {
  it("accepts a bound selected projection without any whole verdict", () => {
    expect(HtmlProtectionSnapshotRequestSchema.parse(request)).toEqual(request);
    expect(HtmlProtectionSnapshotResultSchema.parse(result).projectionComplete).toBe(true);
  });
  it.each(["evaluate", "callback", "script", "regex", "expected", "wholeProtectionPassed"])("rejects supplied %s", field => {
    expect(HtmlProtectionSnapshotRequestSchema.safeParse({ ...request, [field]: "anything" }).success).toBe(false);
    expect(HtmlProtectionSnapshotRequestSchema.safeParse({ ...request, registry: { ...registry, [field]: "anything" } }).success).toBe(false);
  });
  it("requires Original registry identity", () => {
    expect(HtmlProtectionSnapshotRequestSchema.safeParse({ ...request, registry: { ...registry, originalSha256: "b".repeat(64) } }).success).toBe(false);
  });
  it("rejects duplicate registration and overflow without trimming", () => {
    expect(HtmlProtectionSnapshotRequestSchema.safeParse({ ...request, registry: { ...registry, targets: [registry.targets[0], registry.targets[0]] } }).success).toBe(false);
    const targets = Array.from({ length: HTML_PROTECTION_SNAPSHOT_LIMITS.targets + 1 }, (_, index) => ({ targetId: "t" + index, selector: "#t" + index }));
    expect(HtmlProtectionSnapshotRequestSchema.safeParse({ ...request, registry: { ...registry, targets } }).success).toBe(false);
  });
  it("admits a closed search registry, not a caller-defined predicate", () => {
    const search = { schemaVersion: registry.schemaVersion, originalSha256: sha, projection: "search-membership-v1",
      targetId: "search", cardSelector: ".card", chapterSelector: ".chapter", inputSelector: "#search", countSelector: "#count" };
    expect(HtmlProtectionSnapshotRequestSchema.safeParse({ ...request, registry: search }).success).toBe(true);
    expect(HtmlProtectionSnapshotRequestSchema.safeParse({ ...request, registry: { ...search, filter: "return true" } }).success).toBe(false);
  });
  it("allows an explicitly unavailable copy projection", () => {
    const copy = { ...request, registry: { ...registry, projection: "copy-material-v1" } };
    expect(HtmlProtectionSnapshotResultSchema.safeParse({ ...result, request: copy, availability: "unavailable",
      projectionComplete: false, realm: undefined, body: undefined, bodySha256: undefined, bodyUtf8Bytes: undefined,
      gaps: [{ code: "copy-material-undefined" }] }).success).toBe(true);
  });
  it.each(["closed-shadow-root", "iframe", "object", "embed", "limit-exceeded"])("cannot hide the %s boundary behind complete", code => {
    expect(HtmlProtectionSnapshotResultSchema.safeParse({ ...result, gaps: [{ code }] }).success).toBe(false);
  });
  it("cannot advertise a body when observation is unavailable", () => {
    expect(HtmlProtectionSnapshotResultSchema.safeParse({ ...result, availability: "unavailable", projectionComplete: false }).success).toBe(false);
  });
  it("requires Node digest, byte length and independently identified realm", () => {
    for (const key of ["body", "bodySha256", "bodyUtf8Bytes", "realm"]) {
      expect(HtmlProtectionSnapshotResultSchema.safeParse({ ...result, [key]: undefined }).success).toBe(false);
    }
  });
  it("rejects over-budget receipts and non-ordered/foreign slot references", () => {
    expect(HtmlProtectionSnapshotResultSchema.safeParse({ ...result, bodyUtf8Bytes: HTML_PROTECTION_SNAPSHOT_LIMITS.bodyUtf8Bytes + 1 }).success).toBe(false);
    for (const change of [{ index: 1 }, { parent: 0 }, { assignedIndexes: [10] }, { assignedIndexes: [0, 0] }]) {
      expect(HtmlProtectionSnapshotBodySchema.safeParse({ ...body, targets: [{ ...body.targets[0], nodes: [{ ...node, ...change }] }] }).success).toBe(false);
    }
  });
  it("ambiguous targets retain counts without choosing a subtree", () => {
    expect(HtmlProtectionSnapshotBodySchema.safeParse({ ...body, targets: [{ targetId: "card", matchCount: 2, nodes: [] }] }).success).toBe(true);
    expect(HtmlProtectionSnapshotBodySchema.safeParse({ ...body, targets: [{ ...body.targets[0], matchCount: 2 }] }).success).toBe(false);
  });
  it("rejects producer hashes/whole claims inside native material", () => {
    expect(HtmlProtectionSnapshotBodySchema.safeParse({ ...body, digest: sha }).success).toBe(false);
    expect(HtmlProtectionSnapshotResultSchema.safeParse({ ...result, verificationStatus: "verified", wholeProtectionPassed: true }).success).toBe(false);
  });
});
