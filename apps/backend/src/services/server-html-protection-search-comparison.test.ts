// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  AcceptanceCriterionSchema, CandidateSchema, SourceArtifactSchema, TestCaseSchema,
  HtmlProtectionSnapshotLimitations, HtmlProtectionSnapshotRequestSchema,
  type EvolveProject, type HtmlProtectionSnapshotBody,
} from "@evolution/contracts";
import {
  HtmlProtectionSearchCloudInputSchema, HtmlProtectionSearchCloudObservationSchema,
  HTML_PROTECTION_CLOUD_URL, HTML_PROTECTION_CLOUD_CSP, HTML_PROTECTION_CLOUD_RUNTIME_VERSION,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionSearchCloudInputSha256,
  type HtmlProtectionSearchObservationArgs, type HtmlProtectionSearchObservationResult,
} from "@evolution/adapters/sandbox";
import { prepareServerHtmlProtectionCollectionPlan } from "./server-html-protection-collection-plan";
import { collectServerHtmlProtectionSearchPair } from "./server-html-protection-search-observation";
import { compareCollectedServerHtmlProtectionSearchPair } from "./server-html-protection-search-comparison";
type Plan = Awaited<ReturnType<typeof prepareServerHtmlProtectionCollectionPlan>>;
type Search = Extract<HtmlProtectionSnapshotBody, { projection: "search-membership-v1" }>;
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const at = "2026-10-13T00:00:00Z";
const original = '<!doctype html><html><head><style>.slide-card{display:block}</style></head><body><input id="search"><output id="searchCount"></output><section class="chapter" id="chapter"><article class="slide-card" id="card" data-search="alpha"><p>Original method</p></article></section><script>const counter = document.getElementById("searchCount"); const cards = document.querySelectorAll(".slide-card"); let visible = 0; counter.textContent = `${visible}/${cards.length}`;</script></body></html>';
const changed = original.replace("</section>", '<article class="slide-card" id="extra" data-search="alpha">More details</article></section>');
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Blob>() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id) }) }));
function fixture(content = original) {
  const source = SourceArtifactSchema.parse({ id: "S1", name: "source.html", extension: "html", mimeType: "text/html", role: "target",
    artifactKind: "document", inputMode: "upload", storageRef: "source-blob", size: Buffer.byteLength(content), textContent: "stale excerpt", createdAt: at });
  const protect = AcceptanceCriterionSchema.parse({ id: "PROTECT-ALL", title: "Protect", requirement: "Keep original behavior", protectedConstraint: true, hardGate: true, artifactIds: ["S1"] });
  const testCase = TestCaseSchema.parse({ id: "H1", title: "Protect", input: "Complete Original", expected: ["Keep"], hidden: true, criterionIds: [protect.id] });
  const candidate = CandidateSchema.parse({ id: "C1", name: "Changed", change: "Actual additions", artifactSnapshots: [{
    id: "snap", sourceArtifactId: "S1", name: "changed.html", mimeType: "text/html", content: changed, contentHash: sha(changed), createdAt: at,
    frozenArtifact: { sourceArtifactId: "S1", snapshotHash: sha(changed), blobId: "frozen-blob", name: "changed.html", mimeType: "text/html",
      sha256: sha(changed), size: Buffer.byteLength(changed), verifiedAt: at, checks: [], limitations: [] },
  }] });
  const project = { id: "M1", version: "V1", goal: "Not authority", protectedItems: ["Original"], sourceArtifacts: [source],
    acceptanceRubric: [protect], evalSuite: [], hiddenEvalSuite: [testCase], candidates: [candidate] } as unknown as EvolveProject;
  return { project, candidate, testCase, criterionId: protect.id, execution: { executionId: "E1", jobId: "J1", generation: 1 } };
}
const member = (id: string, hidden: boolean, chapter = false) => ({
  id, tag: chapter ? "SECTION" : "ARTICLE", namespace: "http://www.w3.org/1999/xhtml",
  classAttribute: chapter ? "chapter" : "slide-card", hidden, display: hidden ? "none" : "block",
  ancestorDisplayNone: false, chapterId: chapter ? null : "chapter",
});
function observation(args: HtmlProtectionSearchObservationArgs, options: { missing?: boolean; hidden?: boolean; wrongCount?: boolean } = {}): HtmlProtectionSearchObservationResult {
  const role = args.snapshotRequests[0]!.sourceRole;
  const batch = HtmlProtectionSearchCloudInputSchema.parse({
    schemaVersion: "html-protection-private-search-input-v1", nonce: (role === "original" ? "a" : "b").repeat(64),
    request: args.snapshotRequests[0], registration: args.registration, stateRequests: args.stateRequests, snapshotRequests: args.snapshotRequests,
    material: { sha256: sha(Buffer.from(args.physicalHtml)), byteLength: args.physicalHtml.byteLength },
    ownedRuntime: { version: HTML_PROTECTION_CLOUD_RUNTIME_VERSION, sha256: "f".repeat(64), byteLength: 100 },
  });
  const value = (index: number) => index === 0 ? batch.registration.input.initialValue : index === 1 ? batch.registration.states[1].value
    : index === 2 ? batch.registration.states[2].value : "";
  const steps = batch.stateRequests.map((state, index) => {
    const hidden = options.hidden || state.stateKind === "query-negative";
    const cards = [member(role === "executed" && options.missing ? "replacement" : "card", Boolean(hidden)),
      ...(role === "executed" ? [member("extra", Boolean(hidden))] : [])];
    const chapters = [member("chapter", Boolean(hidden), true)], text = options.wrongCount ? "77/77" : String(hidden ? 0 : cards.length) + "/" + cards.length;
    const body: Search = { projection: "search-membership-v1", targetId: batch.registration.registry.targetId, cards, chapters,
      input: { matchCount: 1, tag: "INPUT", value: value(index) }, count: { matchCount: 1, text },
      counters: { scannedNodes: 100, collectedNodes: cards.length + chapters.length + 2, shadowRoots: 0,
        textUtf8Bytes: [...cards, ...chapters].reduce((sum, row) => sum + Buffer.byteLength(row.id + row.classAttribute + (row.chapterId ?? "")), 0)
          + Buffer.byteLength(value(index) + text) }, gaps: [] };
    return { status: "observed" as const, stateRequest: state,
      actionFacts: { request: state, fillCalls: index === 0 ? 0 as const : 1 as const, fillSettled: index !== 0, executionRecorded: true,
        beforeValue: index <= 1 ? batch.registration.input.initialValue : value(index - 1), afterValue: value(index), gaps: [] },
      snapshot: { schemaVersion: "html-protection-snapshot-result-v1", request: batch.snapshotRequests[index], availability: "available", projectionComplete: true,
        observedAt: at, physicalInput: batch.material,
        realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2", frameId: role, loaderId: role, uniqueContextId: role + "-" + index },
        stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: "c".repeat(64), postMirrorSha256: "c".repeat(64), mutationEvents: 0 },
        body, bodySha256: sha(canonical(body)), bodyUtf8Bytes: Buffer.byteLength(canonical(body)), gaps: [], limitations: [...HtmlProtectionSnapshotLimitations] },
      linkFacts: { linked: true, gaps: [] },
    };
  });
  const native = HtmlProtectionSearchCloudObservationSchema.parse({
    schemaVersion: "html-protection-private-search-observation-v1", nonce: batch.nonce, request: batch.request, input: batch,
    ownedRuntime: batch.ownedRuntime, batchRequestSha256: htmlProtectionSearchCloudInputSha256(batch), availability: "available",
    custody: { staged: batch.material, nodeResponse: batch.material, browserResponse: batch.material, documentUrl: HTML_PROTECTION_CLOUD_URL,
      status: 200, contentType: "text/html", contentSecurityPolicy: HTML_PROTECTION_CLOUD_CSP, fromServiceWorker: false, blockedRequests: 0,
      navigation: { frameId: role, loaderId: role, requestId: role, responseUrl: HTML_PROTECTION_CLOUD_URL } }, steps,
  });
  return wrap(native);
}
function wrap(value: unknown): HtmlProtectionSearchObservationResult {
  const native = HtmlProtectionSearchCloudObservationSchema.parse(value), bytes = canonical(native);
  return { availability: "available", observation: native, resultSha256: sha(bytes), resultByteLength: Buffer.byteLength(bytes) };
}
function request(plan: Plan, role: "original" | "executed"): HtmlProtectionSearchObservationArgs {
  const registration = plan.searchRegistration!;
  const stateRequests = plan.searchRequests.filter(item => item.sourceRole === role);
  const snapshotRequests = stateRequests.map(({ schemaVersion: _version, stateKind: _kind, ...anchor }) => {
    void _version; void _kind;
    return HtmlProtectionSnapshotRequestSchema.parse({ ...anchor, schemaVersion: "html-protection-snapshot-request-v1", documentUrl: HTML_PROTECTION_CLOUD_URL, registry: registration.registry });
  });
  return { registration, stateRequests, snapshotRequests, physicalHtml: plan.physicalInputs[role] };
}
function available(result: HtmlProtectionSearchObservationResult) {
  if (result.availability !== "available") throw Error("Fixture requires a transport result"); return result;
}
beforeEach(() => { blobs.clear(); blobs.set("source-blob", new Blob([original])); blobs.set("frozen-blob", new Blob([changed])); });

describe("actual preparation to private selected-search comparison", () => {
  it("uses full independent Original expectations and all executed additions in each of four state counters", async () => {
    const result = await collectServerHtmlProtectionSearchPair(fixture(), async args => observation(args));
    if (result.availability !== "collected") throw Error("Expected collected");
    expect(result.comparison.comparisons).toHaveLength(4);
    expect(result.comparison.countFormat.availability).toBe("available");
    for (const row of result.comparison.comparisons) {
      expect(row.availability).toBe("compared"); expect(row.sequenceScope).toBe("complete-selected-sequence");
      expect(row.strictComparison?.additionalItems).toContainEqual(expect.objectContaining({ role: "executed", kind: "card", value: expect.objectContaining({ id: "extra" }) }));
      expect(row.strictComparison?.gaps).toContainEqual(expect.objectContaining({ code: "additional-card" }));
      expect(row.originalReference?.referenceFacts.filter(item => item.field === "count.own-native-membership-text").every(item => item.status === "match")).toBe(true);
      expect(row.originalReference?.gaps).toContainEqual(expect.objectContaining({ code: "chapter-empty-state-template-unavailable" }));
    }
    for (const key of ["proof", "pass", "verified", "wholeProtectionPassed", "attestation"]) expect(result.comparison).not.toHaveProperty(key);
  });
  it("detects equal wrong raw count text independently of paired equality", async () => {
    const result = await collectServerHtmlProtectionSearchPair(fixture(), async args => observation(args, { wrongCount: true }));
    if (result.availability !== "collected") throw Error("Expected collected");
    expect(result.comparison.comparisons[0]?.originalReference?.referenceFacts.filter(item => item.field === "count.own-native-membership-text").map(item => item.status)).toEqual(["changed", "changed"]);
  });
  it("detects missing Original IDs despite complete native DTOs and plausible total counts", async () => {
    const result = await collectServerHtmlProtectionSearchPair(fixture(), async args => observation(args, { missing: true }));
    if (result.availability !== "collected") throw Error("Expected collected");
    expect(result.comparison.comparisons[0]?.originalReference?.referenceFacts.find(item => item.role === "executed" && item.field === "cards.original-native-visible-membership")?.status).toBe("missing");
  });
  it("keeps mutually equal wrong Original visibility distinct from independently proposed membership", async () => {
    const result = await collectServerHtmlProtectionSearchPair(fixture(), async args => observation(args, { hidden: true }));
    if (result.availability !== "collected") throw Error("Expected collected");
    expect(result.comparison.comparisons[0]?.originalReference?.referenceFacts.filter(item => item.field === "cards.original-native-visible-membership").map(item => item.status)).toEqual(["changed", "changed"]);
  });
  it("keeps strict comparisons when Original count format is unknown instead of inventing a template", async () => {
    const source = original.replace('counter.textContent = `${visible}/${cards.length}`', 'counter.textContent = formatUnknown(visible, cards)');
    blobs.set("source-blob", new Blob([source]));
    const result = await collectServerHtmlProtectionSearchPair(fixture(source), async args => observation(args));
    if (result.availability !== "collected") throw Error("Expected collected");
    expect(result.comparison.countFormat.availability).toBe("unavailable");
    for (const row of result.comparison.comparisons) {
      expect(row.strictComparison).toBeDefined(); expect(row.originalReference).toBeDefined();
      expect(row.originalReference?.referenceFacts.filter(item => item.field === "count.own-native-membership-text").every(item => item.status === "unavailable")).toBe(true);
      expect(row.gaps).toContainEqual({ code: "original-count-format-unavailable" });
    }
  });
  it("captures source, registry, requests and earlier output across both async observer boundaries", async () => {
    let first: HtmlProtectionSearchObservationResult | undefined;
    const result = await collectServerHtmlProtectionSearchPair(fixture(), async args => {
      const produced = observation(args);
      if (args.snapshotRequests[0]!.sourceRole === "original") first = produced;
      else if (first?.availability === "available") first.resultSha256 = "0".repeat(64);
      args.registration.states[1].value = "changed after construction";
      args.stateRequests[0]!.execution.generation = 77;
      args.physicalHtml.fill(0);
      return produced;
    });
    if (result.availability !== "collected") throw Error("Expected collected");
    expect(result.comparison.gaps).toEqual([]);
    expect(result.comparison.comparisons.every(row => row.availability === "compared")).toBe(true);
  });
  it.each(["digest", "size", "crop"] as const)("refuses %s of the complete private result", async mutation => {
    const plan = await prepareServerHtmlProtectionCollectionPlan(fixture()), before = observation(request(plan, "original")), after = available(observation(request(plan, "executed")));
    if (mutation === "digest") after.resultSha256 = "0".repeat(64);
    if (mutation === "size") after.resultByteLength++;
    if (mutation === "crop") Object.assign(after.observation, { steps: [] });
    const result = compareCollectedServerHtmlProtectionSearchPair({ plan, original: before, executed: after });
    expect(result.gaps).toContainEqual({ code: mutation === "crop" ? "invalid-controller-result" : "controller-result-identity-mismatch", role: "executed" });
    expect(result.comparisons.every(row => row.availability === "unavailable")).toBe(true);
  });
  it("refuses a self-consistent result from another independently registered execution", async () => {
    const plan = await prepareServerHtmlProtectionCollectionPlan(fixture()), foreign = structuredClone(plan);
    foreign.searchRequests.forEach(item => { item.execution.executionId = "foreign-owner"; });
    const result = compareCollectedServerHtmlProtectionSearchPair({ plan, original: observation(request(plan, "original")), executed: observation(request(foreign, "executed")) });
    expect(result.gaps).toContainEqual({ code: "independent-plan-binding-mismatch", role: "executed" });
    expect(result.comparisons.every(row => row.availability === "unavailable")).toBe(true);
  });
  it("retains only historical paired facts after a terminal owner/custody failure", async () => {
    const plan = await prepareServerHtmlProtectionCollectionPlan(fixture()), before = observation(request(plan, "original")), after = available(observation(request(plan, "executed")));
    const historical = wrap({ ...after.observation, availability: "unavailable", phase: "after-startup", reason: "aborted" });
    const result = compareCollectedServerHtmlProtectionSearchPair({ plan, original: before, executed: historical });
    expect(result.gaps).toContainEqual({ code: "controller-sequence-unavailable", role: "executed" });
    expect(result.comparisons.every(row => row.sequenceScope === "historical-prefix-only")).toBe(true);
  });
  it("refuses unlinked native states while retaining only the genuinely linked historical prefix", async () => {
    const plan = await prepareServerHtmlProtectionCollectionPlan(fixture()), before = observation(request(plan, "original")), after = available(observation(request(plan, "executed")));
    const batch = after.observation;
    if (batch.availability !== "available") throw Error("Complete fixture required");
    const steps = batch.steps.map((item, index) => index === 0 ? item : index === 1 && item.status === "observed"
      ? { ...item, linkFacts: { linked: false, gaps: ["deadline-exceeded"] } }
      : { status: "not-executed", stateRequest: item.stateRequest, reason: "prior-step-unavailable" });
    const partial = wrap({ ...batch, availability: "unavailable", phase: "after-startup", reason: "snapshot-unavailable", steps });
    const result = compareCollectedServerHtmlProtectionSearchPair({ plan, original: before, executed: partial });
    expect(result.comparisons[0]).toMatchObject({ availability: "compared", sequenceScope: "historical-prefix-only" });
    expect(result.comparisons[1]).toMatchObject({ availability: "unavailable", sequenceScope: "no-comparable-native-state" });
    expect(result.comparisons[1]?.strictComparison).toBeUndefined();
    expect(result.comparisons[1]?.originalReference).toBeUndefined();
    expect(result.comparisons[1]?.gaps).toContainEqual({ code: "state-link-unavailable", role: "executed" });
    expect(result.comparisons[1]?.gaps).toContainEqual({ code: "link-deadline-exceeded", role: "executed" });
  });
  it("retains both action and link failure reasons even when one arm has no native snapshot", async () => {
    const plan = await prepareServerHtmlProtectionCollectionPlan(fixture());
    const before = available(observation(request(plan, "original"))), after = available(observation(request(plan, "executed")));
    if (before.observation.availability !== "available" || after.observation.availability !== "available") throw Error("Complete fixture required");
    const originalSteps = before.observation.steps.map((item, index) => index === 0 ? item : index === 1
      ? { status: "action-failed", stateRequest: item.stateRequest, actionFacts: { fillCalls: 1, fillSettled: false, executionRecorded: false, gaps: ["fill-unavailable"] } }
      : { status: "not-executed", stateRequest: item.stateRequest, reason: "prior-step-unavailable" });
    const executedSteps = after.observation.steps.map((item, index) => index === 0 ? item : index === 1 && item.status === "observed"
      ? { ...item, linkFacts: { linked: false, gaps: ["deadline-exceeded"] } }
      : { status: "not-executed", stateRequest: item.stateRequest, reason: "prior-step-unavailable" });
    const result = compareCollectedServerHtmlProtectionSearchPair({ plan,
      original: wrap({ ...before.observation, availability: "unavailable", phase: "after-startup", reason: "state-execution-unavailable", steps: originalSteps }),
      executed: wrap({ ...after.observation, availability: "unavailable", phase: "after-startup", reason: "snapshot-unavailable", steps: executedSteps }),
    });
    expect(result.comparisons[1]?.gaps).toContainEqual({ code: "action-fill-unavailable", role: "original" });
    expect(result.comparisons[1]?.gaps).toContainEqual({ code: "link-deadline-exceeded", role: "executed" });
    expect(result.comparisons[1]?.originalReference).toBeUndefined();
    expect(result.comparisons[1]?.strictComparison).toBeUndefined();
  });
  it("compares an observed historical boot prefix and leaves later unexecuted states unavailable", async () => {
    const plan = await prepareServerHtmlProtectionCollectionPlan(fixture()), before = observation(request(plan, "original")), after = available(observation(request(plan, "executed")));
    const batch = after.observation;
    if (batch.availability !== "available") throw Error("Complete fixture required");
    const steps = batch.steps.map((item, index) => index === 0 ? item : index === 1
      ? { status: "action-failed", stateRequest: item.stateRequest, actionFacts: { fillCalls: 1, fillSettled: false, executionRecorded: false, gaps: ["fill-unavailable"] } }
      : { status: "not-executed", stateRequest: item.stateRequest, reason: "prior-step-unavailable" });
    const partial = wrap({ ...batch, availability: "unavailable", phase: "after-startup", reason: "state-execution-unavailable", steps });
    const result = compareCollectedServerHtmlProtectionSearchPair({ plan, original: before, executed: partial });
    expect(result.comparisons[0]).toMatchObject({ availability: "compared", sequenceScope: "historical-prefix-only" });
    expect(result.comparisons.slice(1).every(row => row.availability === "unavailable" && !row.strictComparison && !row.originalReference)).toBe(true);
  });
});
