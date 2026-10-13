import { describe, expect, it } from "vitest";
import {
  HtmlProtectionSearchInputObservationSchema, HtmlProtectionSearchStateRegistrationSchema,
  HtmlProtectionSearchStateRequestSchema, HtmlProtectionSearchStateSessionSchema,
} from "./html-protection-search-state-contract";

const sha = "a".repeat(64);
const original = { sourceArtifactId: "source", sha256: sha, byteLength: 100 };
const registry = { schemaVersion: "html-protection-snapshot-registry-v1", projection: "search-membership-v1",
  originalSha256: sha, targetId: "search", cardSelector: ".card", chapterSelector: ".chapter",
  inputSelector: "#search", countSelector: "#count" };
function registration() {
  return { schemaVersion: "html-protection-search-state-registration-v1", original,
    registry, policyVersion: "profile-v1", planSha256: sha, registrySha256: sha,
    input: { id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml", type: "search", initialValue: "" },
    states: [{ stateKind: "boot", stateId: "boot" }, { stateKind: "query-positive", stateId: "positive", value: "needle" },
      { stateKind: "query-negative", stateId: "negative", value: "not-found" }, { stateKind: "clear", stateId: "clear", value: "" }] };
}
function request() {
  return { schemaVersion: "html-protection-search-state-request-v1", sourceRole: "executed",
    binding: { missionId: "mission", testCaseId: "test", criterionId: "PROTECT-ALL", paperSha256: sha,
      original, executed: original, subject: { kind: "current", versionId: "v1" } },
    policyVersion: "profile-v1", planSha256: sha, registrySha256: sha,
    execution: { executionId: "execution", jobId: "job", generation: 1 }, batchId: "batch", stateId: "boot", stateKind: "boot" };
}
function observation() {
  return { schemaVersion: "html-protection-search-input-observation-v1", availability: "available",
    frameId: "frame", loaderId: "loader", physicalInput: { sha256: sha, byteLength: 100 }, gaps: [],
    input: { matchCount: 1, backendNodeId: 5, id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml",
      type: "search", value: "", disabled: false, readOnly: false } };
}
describe("closed native search state contracts", () => {
  it("parses four finite Original states, an intent request and native facts without a verdict", () => {
    expect(HtmlProtectionSearchStateRegistrationSchema.parse(registration()).states).toHaveLength(4);
    expect(HtmlProtectionSearchStateRequestSchema.parse(request()).stateKind).toBe("boot");
    expect(HtmlProtectionSearchInputObservationSchema.parse(observation()).availability).toBe("available");
  });
  it.each(["selector", "value", "url", "documentUrl", "script", "evaluate", "action", "env", "timeoutMs", "caseDeadline", "expected", "wholeProtectionPassed"])(
    "rejects client %s in the closed request", key => {
      expect(HtmlProtectionSearchStateRequestSchema.safeParse({ ...request(), [key]: "anything" }).success).toBe(false);
    });
  it("clones nested boundary objects", () => {
    const input = request(), parsed = HtmlProtectionSearchStateRequestSchema.parse(input);
    input.binding.original.byteLength = 999;
    expect(parsed.binding.original.byteLength).toBe(100);
  });
  it("rejects unknown state kinds and unexpected execution fields", () => {
    expect(HtmlProtectionSearchStateRequestSchema.safeParse({ ...request(), stateKind: "click" }).success).toBe(false);
    expect(HtmlProtectionSearchStateRequestSchema.safeParse({ ...request(), execution: { ...request().execution, retry: true } }).success).toBe(false);
  });
  it("rejects reordered, missing and duplicate registered state identities", () => {
    const entry = registration();
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...entry, states: [entry.states[1], entry.states[0], ...entry.states.slice(2)] }).success).toBe(false);
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...entry, states: entry.states.slice(0, 3) }).success).toBe(false);
    entry.states[1].stateId = "boot";
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse(entry).success).toBe(false);
  });
  it("rejects equal/blank queries and a non-empty clear", () => {
    const entry = registration();
    entry.states[2].value = "needle";
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse(entry).success).toBe(false);
    entry.states[2].value = "  ";
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse(entry).success).toBe(false);
    entry.states[2].value = "not-found"; entry.states[3].value = "residual";
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse(entry).success).toBe(false);
  });
  it("rejects Candidate-derived registry identity, unsupported original INPUT and arbitrary registration fields", () => {
    const entry = registration();
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...entry, registry: { ...registry, originalSha256: "b".repeat(64) } }).success).toBe(false);
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...entry, input: { ...entry.input, type: "password" } }).success).toBe(false);
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...entry, candidateId: "candidate" }).success).toBe(false);
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...entry, input: { ...entry.input, callback: "fn" } }).success).toBe(false);
  });
  it("rejects a non-search registry and a registry-owned script/URL", () => {
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...registration(), registry: { ...registry, projection: "boot-subtree-v1" } }).success).toBe(false);
    expect(HtmlProtectionSearchStateRegistrationSchema.safeParse({ ...registration(), registry: { ...registry, script: "fn", url: "https://example.com" } }).success).toBe(false);
  });
  it("requires complete native material and does not select one ambiguous input", () => {
    const entry = observation();
    expect(HtmlProtectionSearchInputObservationSchema.safeParse({ ...entry, frameId: undefined }).success).toBe(false);
    expect(HtmlProtectionSearchInputObservationSchema.safeParse({ ...entry, input: { ...entry.input, matchCount: 2 } }).success).toBe(false);
    expect(HtmlProtectionSearchInputObservationSchema.safeParse({ ...entry, input: { matchCount: 2, backendNodeId: null, id: null, tag: null,
      namespace: null, type: null, value: null, disabled: null, readOnly: null } }).success).toBe(true);
  });
  it("unavailable native reads cannot supply facts or a preservation label", () => {
    expect(HtmlProtectionSearchInputObservationSchema.safeParse({ ...observation(), availability: "unavailable" }).success).toBe(false);
    expect(HtmlProtectionSearchInputObservationSchema.safeParse({ ...observation(), verified: true }).success).toBe(false);
  });
  it("constructor expectations have no state command or URL", () => {
    const base = request();
    const session = { binding: base.binding, sourceRole: base.sourceRole, execution: base.execution, policyVersion: base.policyVersion,
      planSha256: base.planSha256, registrySha256: base.registrySha256, batchId: base.batchId, frameId: "frame", loaderId: "loader" };
    expect(HtmlProtectionSearchStateSessionSchema.safeParse(session).success).toBe(true);
    expect(HtmlProtectionSearchStateSessionSchema.safeParse({ ...session, stateId: "boot", documentUrl: "about:blank" }).success).toBe(false);
  });
});
