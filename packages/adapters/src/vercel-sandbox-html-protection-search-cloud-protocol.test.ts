// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateRequestSchema,
  HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotResultSchema, HtmlProtectionSnapshotLimitations,
} from "@evolution/contracts";
import {
  HTML_PROTECTION_CLOUD_CSP, HTML_PROTECTION_CLOUD_PATHS, HTML_PROTECTION_CLOUD_URL,
  HTML_PROTECTION_CLOUD_RUNTIME_VERSION, htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
} from "./vercel-sandbox-html-protection-cloud-protocol";
import {
  HtmlProtectionSearchCloudInputSchema, HtmlProtectionSearchCloudStepSchema,
  HtmlProtectionSearchCloudObservationSchema, HtmlProtectionSearchCloudManifestSchema, htmlProtectionSearchCloudInputSha256,
  type HtmlProtectionSearchCloudInput, type HtmlProtectionSearchCloudStep,
} from "./vercel-sandbox-html-protection-search-cloud-protocol";

function input(): HtmlProtectionSearchCloudInput {
  const original = { sourceArtifactId: "source", sha256: "a".repeat(64), byteLength: 100 };
  const executed = { sourceArtifactId: "source", sha256: "c".repeat(64), byteLength: 110 };
  const registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: original.sha256,
    projection: "search-membership-v1", targetId: "search", inputSelector: "#search", countSelector: "#count",
    cardSelector: ".card", chapterSelector: ".chapter" };
  const registration = HtmlProtectionSearchStateRegistrationSchema.parse({
    schemaVersion: "html-protection-search-state-registration-v1", original, registry,
    policyVersion: "collection-v1", planSha256: "b".repeat(64), registrySha256: sha(canonical(registry)),
    input: { id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml", type: "search", initialValue: "" },
    states: [{ stateKind: "boot", stateId: "boot" }, { stateKind: "query-positive", stateId: "positive", value: "needle" },
      { stateKind: "query-negative", stateId: "negative", value: "absent" }, { stateKind: "clear", stateId: "clear", value: "" }],
  });
  const common = {
    binding: { missionId: "mission", testCaseId: "test", criterionId: "PROTECT-ALL", paperSha256: "d".repeat(64),
      original, executed, subject: { kind: "candidate", candidateId: "candidate" } },
    sourceRole: "executed", policyVersion: registration.policyVersion, planSha256: registration.planSha256,
    registrySha256: registration.registrySha256, execution: { executionId: "execution", jobId: "job", generation: 1 }, batchId: "search",
  };
  const snapshots = registration.states.map(state => HtmlProtectionSnapshotRequestSchema.parse({
    ...common, schemaVersion: "html-protection-snapshot-request-v1", stateId: state.stateId, registry, documentUrl: HTML_PROTECTION_CLOUD_URL,
  }));
  const states = registration.states.map(state => HtmlProtectionSearchStateRequestSchema.parse({
    ...common, schemaVersion: "html-protection-search-state-request-v1", stateId: state.stateId, stateKind: state.stateKind,
  }));
  return HtmlProtectionSearchCloudInputSchema.parse({
    schemaVersion: "html-protection-private-search-input-v1", nonce: "e".repeat(64),
    request: snapshots[0], material: { sha256: executed.sha256, byteLength: executed.byteLength },
    ownedRuntime: { version: HTML_PROTECTION_CLOUD_RUNTIME_VERSION, sha256: "f".repeat(64), byteLength: 100 },
    registration, stateRequests: states, snapshotRequests: snapshots,
  });
}
function stateValue(batch: HtmlProtectionSearchCloudInput, index: number) {
  return index === 0 ? batch.registration.input.initialValue : index === 1 ? batch.registration.states[1].value
    : index === 2 ? batch.registration.states[2].value : "";
}
function snapshot(batch: HtmlProtectionSearchCloudInput, index: number) {
  const body = { projection: "search-membership-v1", targetId: "search", cards: [], chapters: [],
    input: { matchCount: 1, tag: "INPUT", value: stateValue(batch, index) }, count: { matchCount: 1, text: "0" },
    counters: { scannedNodes: 1, collectedNodes: 0, shadowRoots: 0, textUtf8Bytes: 0 }, gaps: [] };
  return HtmlProtectionSnapshotResultSchema.parse({
    schemaVersion: "html-protection-snapshot-result-v1", request: batch.snapshotRequests[index],
    availability: "available", projectionComplete: true, observedAt: "2026-10-13T01:00:00Z",
    physicalInput: batch.material,
    realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2", frameId: "frame", loaderId: "loader", uniqueContextId: "isolated-" + index },
    stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: "a".repeat(64), postMirrorSha256: "a".repeat(64), mutationEvents: 0 },
    body, bodySha256: sha(canonical(body)), bodyUtf8Bytes: Buffer.byteLength(canonical(body)), gaps: [], limitations: [...HtmlProtectionSnapshotLimitations],
  });
}
function observation(batch = input()) {
  function step(index: number) {
    return HtmlProtectionSearchCloudStepSchema.parse({ status: "observed", stateRequest: batch.stateRequests[index],
      actionFacts: { request: batch.stateRequests[index], fillCalls: index === 0 ? 0 : 1, fillSettled: index !== 0,
        executionRecorded: true, beforeValue: index <= 1 ? batch.registration.input.initialValue : stateValue(batch, index - 1), afterValue: stateValue(batch, index), gaps: [] },
      snapshot: snapshot(batch, index), linkFacts: { linked: true, gaps: [] } });
  }
  return {
    schemaVersion: "html-protection-private-search-observation-v1" as const, nonce: batch.nonce, request: batch.request,
    batchRequestSha256: htmlProtectionSearchCloudInputSha256(batch), ownedRuntime: batch.ownedRuntime, input: batch,
    availability: "available" as const,
    custody: { staged: batch.material, nodeResponse: batch.material, browserResponse: batch.material,
      documentUrl: HTML_PROTECTION_CLOUD_URL, status: 200, contentType: "text/html", contentSecurityPolicy: HTML_PROTECTION_CLOUD_CSP,
      fromServiceWorker: false, blockedRequests: 0, navigation: { frameId: "frame", loaderId: "loader", requestId: "response",
        responseUrl: HTML_PROTECTION_CLOUD_URL } },
    steps: [step(0), step(1), step(2), step(3)] as [HtmlProtectionSearchCloudStep, HtmlProtectionSearchCloudStep, HtmlProtectionSearchCloudStep, HtmlProtectionSearchCloudStep],
  };
}
function observed(step: HtmlProtectionSearchCloudStep) {
  if (step.status !== "observed") throw Error("synthetic fixture expects observed step");
  return step;
}
function interrupted(index = 1) {
  const complete = observation(), states = complete.steps.map((step, position): HtmlProtectionSearchCloudStep => {
    if (position < index) return step;
    if (position === index) return { status: "action-failed", stateRequest: step.stateRequest,
      actionFacts: { fillCalls: position === 0 ? 0 : 1, fillSettled: false, executionRecorded: false, gaps: ["fill-unavailable"] } };
    return { status: "not-executed", stateRequest: step.stateRequest, reason: "prior-step-unavailable" };
  });
  return { ...complete, availability: "unavailable" as const, phase: "after-startup" as const,
    reason: "state-execution-unavailable" as const, steps: states };
}

describe("closed private consecutive search batch input", () => {
  it("binds all four native states with a boot anchor but no general action/proof interface", () => {
    const batch = HtmlProtectionSearchCloudInputSchema.parse(input());
    expect(batch.stateRequests.map(request => request.stateKind)).toEqual(["boot", "query-positive", "query-negative", "clear"]);
    expect(batch.request).toEqual(batch.snapshotRequests[0]);
    expect(batch).not.toHaveProperty("proof"); expect(batch).not.toHaveProperty("wholeProtectionPassed");
  });
  it.each(["callback", "script", "env", "url", "evaluate", "action", "wholeProtectionPassed"])("rejects supplied %s at every input boundary", key => {
    const batch = input();
    expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...batch, [key]: "anything" }).success).toBe(false);
    expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...batch, registration: { ...batch.registration, [key]: "anything" } }).success).toBe(false);
    expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...batch, stateRequests: [{ ...batch.stateRequests[0], [key]: "anything" }, ...batch.stateRequests.slice(1)] }).success).toBe(false);
  });
  it.each(["state-crop", "snapshot-crop", "extra", "reorder", "duplicate", "fake-state", "anchor"])("rejects %s expected sequence", kind => {
    const batch = input();
    if (kind === "state-crop") expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...batch, stateRequests: batch.stateRequests.slice(0, 3) }).success).toBe(false);
    if (kind === "snapshot-crop") expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...batch, snapshotRequests: batch.snapshotRequests.slice(0, 3) }).success).toBe(false);
    if (kind === "extra") expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...batch, stateRequests: [...batch.stateRequests, batch.stateRequests[3]] }).success).toBe(false);
    if (kind === "reorder") { [batch.stateRequests[1], batch.stateRequests[2]] = [batch.stateRequests[2], batch.stateRequests[1]]; expect(HtmlProtectionSearchCloudInputSchema.safeParse(batch).success).toBe(false); }
    if (kind === "duplicate") { batch.snapshotRequests[2] = batch.snapshotRequests[1]; expect(HtmlProtectionSearchCloudInputSchema.safeParse(batch).success).toBe(false); }
    if (kind === "fake-state") { batch.stateRequests[1].stateId = "fake"; expect(HtmlProtectionSearchCloudInputSchema.safeParse(batch).success).toBe(false); }
    if (kind === "anchor") { batch.request = batch.snapshotRequests[1]; expect(HtmlProtectionSearchCloudInputSchema.safeParse(batch).success).toBe(false); }
  });
  it.each(["role", "generation", "paper", "criterion", "mission", "subject", "plan", "registry", "batch", "execution", "url", "material", "original"])(
    "rejects foreign %s even when boot remains valid", kind => {
      const batch = input(), request = batch.snapshotRequests[2];
      if (kind === "role") request.sourceRole = "original";
      if (kind === "generation") request.execution.generation++;
      if (kind === "paper") request.binding.paperSha256 = "0".repeat(64);
      if (kind === "criterion") request.binding.criterionId = "other";
      if (kind === "mission") request.binding.missionId = "other";
      if (kind === "subject") request.binding.subject = { kind: "current", versionId: "other" };
      if (kind === "plan") request.planSha256 = "0".repeat(64);
      if (kind === "registry") request.registrySha256 = "0".repeat(64);
      if (kind === "batch") request.batchId = "other";
      if (kind === "execution") request.execution.jobId = "other";
      if (kind === "url") request.documentUrl = "https://example.com";
      if (kind === "material") batch.material.sha256 = batch.registration.original.sha256;
      if (kind === "original") batch.registration.original.byteLength++;
      expect(HtmlProtectionSearchCloudInputSchema.safeParse(batch).success).toBe(false);
    });
  it("rejects wrong state intent with the correct registered ID and frozen literal violations", () => {
    const wrongIntent = input(); wrongIntent.stateRequests[1].stateKind = "query-negative";
    expect(HtmlProtectionSearchCloudInputSchema.safeParse(wrongIntent).success).toBe(false);
    const sameQueries = input(); sameQueries.registration.states[2].value = sameQueries.registration.states[1].value;
    expect(HtmlProtectionSearchCloudInputSchema.safeParse(sameQueries).success).toBe(false);
    const wrongClear = input();
    expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...wrongClear, registration: { ...wrongClear.registration,
      states: [...wrongClear.registration.states.slice(0, 3), { ...wrongClear.registration.states[3], value: "residual" }] } }).success).toBe(false);
    const bootLiteral = input();
    expect(HtmlProtectionSearchCloudInputSchema.safeParse({ ...bootLiteral, registration: { ...bootLiteral.registration,
      states: [{ ...bootLiteral.registration.states[0], value: "unexpected" }, ...bootLiteral.registration.states.slice(1)] } }).success).toBe(false);
  });
  it("rejects registry contents that do not have the independently bound registry digest", () => {
    const batch = input();
    batch.registration.registry.cardSelector = ".replacement";
    for (const request of batch.snapshotRequests) request.registry = structuredClone(batch.registration.registry);
    batch.request = structuredClone(batch.snapshotRequests[0]);
    expect(HtmlProtectionSearchCloudInputSchema.safeParse(batch).success).toBe(false);
  });
  it("full input digest changes for finite queries, nonce and runtime even when the boot anchor is unchanged", () => {
    const batch = input(), baseline = htmlProtectionSearchCloudInputSha256(batch), anchor = canonical(batch.request);
    const query = structuredClone(batch); query.registration.states[1].value = "another-query";
    const freshNonce = structuredClone(batch); freshNonce.nonce = "0".repeat(64);
    const bundle = structuredClone(batch); bundle.ownedRuntime.sha256 = "0".repeat(64);
    const initial = structuredClone(batch); initial.registration.input.initialValue = "preconfigured";
    for (const changed of [query, freshNonce, bundle, initial]) {
      expect(canonical(changed.request)).toBe(anchor); expect(htmlProtectionSearchCloudInputSha256(changed)).not.toBe(baseline);
    }
  });
  it("rejects a complete oversized input instead of cropping identities or scope", () => {
    const batch = input(), long = "x".repeat(512), binding = structuredClone(batch.request.binding);
    binding.missionId = long; binding.testCaseId = long; binding.criterionId = long; binding.subject = { kind: "candidate", candidateId: long };
    binding.original.sourceArtifactId = long; binding.executed.sourceArtifactId = long;
    batch.registration.original.sourceArtifactId = long; batch.registration.input.id = long; batch.registration.input.initialValue = "x".repeat(4096);
    batch.registration.states[1].value = "a".repeat(4096); batch.registration.states[2].value = "b".repeat(4096);
    for (let index = 0; index < 4; index++) batch.registration.states[index].stateId = String(index) + "x".repeat(511);
    const registry = batch.registration.registry;
    for (const key of ["cardSelector", "chapterSelector", "inputSelector", "countSelector"] as const) registry[key] = "." + "x".repeat(499);
    batch.registration.policyVersion = long; batch.registration.registrySha256 = sha(canonical(registry));
    for (let index = 0; index < 4; index++) {
      for (const request of [batch.snapshotRequests[index], batch.stateRequests[index]]) {
        request.binding = structuredClone(binding); request.policyVersion = long; request.batchId = long;
        request.execution = { executionId: long, jobId: long, generation: 1 }; request.stateId = batch.registration.states[index].stateId;
        request.registrySha256 = batch.registration.registrySha256;
      }
      batch.snapshotRequests[index].registry = structuredClone(registry);
    }
    batch.request = structuredClone(batch.snapshotRequests[0]);
    expect(Buffer.byteLength(canonical(batch))).toBeGreaterThan(64 * 1024);
    expect(HtmlProtectionSearchCloudInputSchema.safeParse(batch).success).toBe(false);
  });
});

describe("private consecutive search observation with retained actual prefix", () => {
  it("parses four complete local states, distinct isolated contexts and common document custody", () => {
    const result = HtmlProtectionSearchCloudObservationSchema.parse(observation());
    expect(result.availability).toBe("available");
    for (const key of ["proof", "evidence", "signature", "accepted", "passed", "wholeProtectionPassed"]) expect(result).not.toHaveProperty(key);
  });
  it("permits startup-unavailable without inventing a native prefix", () => {
    const complete = observation();
    const base = { schemaVersion: complete.schemaVersion, nonce: complete.nonce, request: complete.request, input: complete.input,
      ownedRuntime: complete.ownedRuntime, batchRequestSha256: complete.batchRequestSha256,
      availability: "unavailable", phase: "before-startup", reason: "missing-trusted-runtime" };
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse(base).success).toBe(true);
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...base, steps: complete.steps }).success).toBe(false);
  });
  it("retains real failure/partial prefix and explicit non-executed remaining states", () => {
    const result = HtmlProtectionSearchCloudObservationSchema.parse(interrupted());
    expect(result.availability).toBe("unavailable");
    if (result.availability !== "unavailable" || result.phase !== "after-startup") throw Error("fixture");
    expect(result.steps.map(step => step.status)).toEqual(["observed", "action-failed", "not-executed", "not-executed"]);
    expect(result.steps[2]).not.toHaveProperty("snapshot");
  });
  it("retains a partial native snapshot and cannot continue or upgrade it", () => {
    const result = interrupted(), step = observed(observation().steps[1]);
    step.snapshot.projectionComplete = false;
    step.snapshot.gaps = [{ code: "missing-target", targetId: "search" }];
    if (step.snapshot.body?.projection !== "search-membership-v1") throw Error("fixture");
    step.snapshot.body.input = { matchCount: 0, tag: null, value: null };
    step.snapshot.body.gaps = [{ code: "missing-target", targetId: "search" }];
    step.snapshot.bodySha256 = sha(canonical(step.snapshot.body)); step.snapshot.bodyUtf8Bytes = Buffer.byteLength(canonical(step.snapshot.body));
    step.linkFacts = { linked: false, gaps: ["snapshot-mismatch"] };
    result.steps[1] = step;
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(true);
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...result, availability: "available", phase: undefined, reason: undefined }).success).toBe(false);
  });
  it("retains native unavailable after a real complete action without fake body material", () => {
    const result = interrupted(), step = observed(observation().steps[1]), previous = step.snapshot;
    step.snapshot = HtmlProtectionSnapshotResultSchema.parse({ schemaVersion: previous.schemaVersion, request: previous.request,
      availability: "unavailable", projectionComplete: false, observedAt: previous.observedAt, physicalInput: previous.physicalInput,
      gaps: [{ code: "capability-unavailable" }], limitations: previous.limitations });
    step.linkFacts = { linked: false, gaps: ["native-unavailable"] }; result.steps[1] = step;
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(true);
  });
  it.each(["crop", "extra", "duplicate", "restore", "initial-placeholder", "fake-native"])("rejects %s evidence sequence", kind => {
    const result = interrupted();
    if (kind === "crop") expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...result, steps: result.steps.slice(0, 3) }).success).toBe(false);
    if (kind === "extra") expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...result, steps: [...result.steps, result.steps[3]] }).success).toBe(false);
    if (kind === "duplicate") { result.steps[1] = result.steps[0]; expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(false); }
    if (kind === "restore") { result.steps[3] = observation().steps[3]; expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(false); }
    if (kind === "initial-placeholder") { result.steps[0] = { status: "not-executed", stateRequest: result.input.stateRequests[0], reason: "prior-step-unavailable" }; expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(false); }
    if (kind === "fake-native") expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...result, steps: [result.steps[0], result.steps[1],
      { ...result.steps[2], snapshot: snapshot(result.input, 2) }, result.steps[3]] }).success).toBe(false);
  });
  it.each(["nonce", "batch-hash", "runtime", "request", "custody", "frame", "loader", "physical", "role", "generation", "state", "body-hash", "body-bytes", "cropped-body"])(
    "rejects foreign %s material, not just equal body digests", kind => {
      const result = observation(), step = observed(result.steps[2]);
      if (kind === "nonce") result.nonce = "0".repeat(64);
      if (kind === "batch-hash") result.batchRequestSha256 = sha(canonical(result.request));
      if (kind === "runtime") result.ownedRuntime = { ...result.ownedRuntime, sha256: "0".repeat(64) };
      if (kind === "request") result.request = result.input.snapshotRequests[1];
      if (kind === "custody") result.custody.nodeResponse = { ...result.custody.nodeResponse, byteLength: 999 };
      if (kind === "frame") step.snapshot.realm!.frameId = "other";
      if (kind === "loader") step.snapshot.realm!.loaderId = "other";
      if (kind === "physical") step.snapshot.physicalInput = { ...step.snapshot.physicalInput, sha256: "0".repeat(64) };
      if (kind === "role") step.stateRequest = { ...step.stateRequest, sourceRole: "original" };
      if (kind === "generation") step.snapshot.request.execution.generation++;
      if (kind === "state") step.snapshot.request.stateId = "fake";
      if (kind === "body-hash") step.snapshot.bodySha256 = "0".repeat(64);
      if (kind === "body-bytes") step.snapshot.bodyUtf8Bytes = (step.snapshot.bodyUtf8Bytes ?? 0) + 1;
      if (kind === "cropped-body") {
        if (step.snapshot.body?.projection !== "search-membership-v1") throw Error("fixture");
        step.snapshot.body.count.text = "";
      }
      expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(false);
    });
  it.each(["boot-fill", "query-zero", "unsettled", "gap", "wrong-before", "wrong-after", "unlinked", "fake-input", "helper-request"])(
    "rejects %s as a complete local state", kind => {
      const result = observation(), step = observed(result.steps[kind === "boot-fill" ? 0 : 1]);
      if (kind === "boot-fill") step.actionFacts.fillCalls = 1;
      if (kind === "query-zero") step.actionFacts.fillCalls = 0;
      if (kind === "unsettled") step.actionFacts.fillSettled = false;
      if (kind === "gap") step.actionFacts.gaps = ["native-unavailable"];
      if (kind === "wrong-before") step.actionFacts.beforeValue = "other";
      if (kind === "wrong-after") step.actionFacts.afterValue = "other";
      if (kind === "unlinked") step.linkFacts = { linked: false, gaps: ["snapshot-mismatch"] };
      if (kind === "helper-request") step.actionFacts.request = result.input.stateRequests[2];
      if (kind === "fake-input") {
        if (step.snapshot.body?.projection !== "search-membership-v1") throw Error("fixture");
        step.snapshot.body.input.value = "other";
      }
      expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(false);
    });
  it.each(["case-timeout", "deadline-exceeded", "document-mismatch", "physical-input-mismatch",
    "aborted", "session-unavailable", "served-material-mismatch", "runtime-integrity"])(
    "retains all four truthful complete states when terminal guard reports %s", reason => {
      const complete = observation(), before = structuredClone(complete.steps);
      const result = HtmlProtectionSearchCloudObservationSchema.parse({ ...complete, availability: "unavailable",
        phase: "after-startup", reason });
      expect(result.availability).toBe("unavailable");
      if (result.availability !== "unavailable" || result.phase !== "after-startup") throw Error("fixture");
      expect(result.steps).toEqual(before); expect(result.custody.blockedRequests).toBe(0);
    });
  it.each(["state-execution-unavailable", "snapshot-unavailable", "missing-trusted-runtime"])(
    "does not invent a terminal exception for %s with a complete prefix", reason => {
      expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...observation(), availability: "unavailable",
        phase: "after-startup", reason }).success).toBe(false);
    });
  it("terminal failure cannot excuse cropped/foreign snapshots, a resumed prefix or available upgrade", () => {
    const foreign = observation(); observed(foreign.steps[2]).snapshot.realm!.loaderId = "other";
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...foreign, availability: "unavailable",
      phase: "after-startup", reason: "document-mismatch" }).success).toBe(false);
    const resumed = interrupted(); resumed.steps[3] = observation().steps[3];
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...resumed, reason: "case-timeout" }).success).toBe(false);
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...observation(), availability: "available",
      reason: "case-timeout", phase: "after-startup" }).success).toBe(false);
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...observation(), availability: "unavailable",
      phase: "after-startup", reason: "case-timeout", steps: observation().steps.slice(0, 3) }).success).toBe(false);
  });
  it("retains actual blocked resource counts only as unavailable, including a completed prefix", () => {
    const complete = observation(); complete.custody.blockedRequests = 1;
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse(complete).success).toBe(false);
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse({ ...complete, availability: "unavailable",
      phase: "after-startup", reason: "blocked-resource" }).success).toBe(true);
  });
  it("rejects undefined optional local fields as non-JSON without throwing outside Zod", () => {
    const result = interrupted(), step = result.steps[1];
    if (step.status !== "action-failed") throw Error("fixture");
    step.actionFacts.beforeValue = undefined;
    expect(() => HtmlProtectionSearchCloudObservationSchema.safeParse(result)).not.toThrow();
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(false);
  });
  it("rejects four complete but oversized native bodies instead of truncating targets", () => {
    const result = observation();
    for (const record of result.steps) {
      const step = observed(record); if (step.snapshot.body?.projection !== "search-membership-v1") throw Error("fixture");
      step.snapshot.body.count.text = "x".repeat(1_048_000);
      step.snapshot.body.counters.textUtf8Bytes = 1_048_000;
      step.snapshot.bodySha256 = sha(canonical(step.snapshot.body)); step.snapshot.bodyUtf8Bytes = Buffer.byteLength(canonical(step.snapshot.body));
    }
    expect(Buffer.byteLength(canonical(result))).toBeGreaterThan(4 * 1024 * 1024);
    expect(HtmlProtectionSearchCloudObservationSchema.safeParse(result).success).toBe(false);
  });
});

describe("complete private batch manifest identities", () => {
  function manifest() { const batch = input(); return { schemaVersion: "html-protection-private-search-manifest-v1",
    nonce: batch.nonce, batchRequestSha256: htmlProtectionSearchCloudInputSha256(batch), ownedRuntimeSha256: batch.ownedRuntime.sha256,
    runnerSha256: "a".repeat(64), result: { path: HTML_PROTECTION_CLOUD_PATHS.result, sha256: "b".repeat(64), byteLength: 1000 } }; }
  it("requires full batch/runtime/runner/result hashes and actual positive result bytes", () => {
    expect(HtmlProtectionSearchCloudManifestSchema.safeParse(manifest()).success).toBe(true);
    expect(HtmlProtectionSearchCloudManifestSchema.safeParse({ ...manifest(), batchRequestSha256: undefined }).success).toBe(false);
    expect(HtmlProtectionSearchCloudManifestSchema.safeParse({ ...manifest(), result: { ...manifest().result, byteLength: 0 } }).success).toBe(false);
  });
  it.each(["callback", "script", "signature", "proof", "accepted", "wholeProtectionPassed"])("rejects manifest %s", key => {
    expect(HtmlProtectionSearchCloudManifestSchema.safeParse({ ...manifest(), [key]: true }).success).toBe(false);
  });
  it("rejects foreign output paths and byte budget bypass", () => {
    expect(HtmlProtectionSearchCloudManifestSchema.safeParse({ ...manifest(), result: { ...manifest().result, path: "/tmp/public.json" } }).success).toBe(false);
    expect(HtmlProtectionSearchCloudManifestSchema.safeParse({ ...manifest(), result: { ...manifest().result, byteLength: 4 * 1024 * 1024 + 1 } }).success).toBe(false);
  });
});
