// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import {
  HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateSessionSchema,
  HtmlProtectionSnapshotLimitations, type HtmlProtectionSearchInputObservation,
  type HtmlProtectionSearchStateRequest,
} from "@evolution/contracts";
import { createHtmlProtectionSearchStateSession } from "./html-protection-search-state";

function fixture(options: { role?: "original" | "executed"; selector?: string; deadline?: number } = {}) {
  const original = { sourceArtifactId: "source", sha256: "a".repeat(64), byteLength: 100 };
  const executed = { sourceArtifactId: "source", sha256: "c".repeat(64), byteLength: 110 };
  const registry = { schemaVersion: "html-protection-snapshot-registry-v1", projection: "search-membership-v1",
    originalSha256: original.sha256, targetId: "search", cardSelector: ".card", chapterSelector: ".chapter",
    inputSelector: options.selector ?? "#search", countSelector: "#count" };
  const registration = HtmlProtectionSearchStateRegistrationSchema.parse({
    schemaVersion: "html-protection-search-state-registration-v1", original,
    registry, policyVersion: "profile-v1", planSha256: "b".repeat(64), registrySha256: "d".repeat(64),
    input: { id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml", type: "search", initialValue: "" },
    states: [{ stateKind: "boot", stateId: "boot" }, { stateKind: "query-positive", stateId: "positive", value: "needle" },
      { stateKind: "query-negative", stateId: "negative", value: "absent" }, { stateKind: "clear", stateId: "clear", value: "" }],
  });
  const expected = HtmlProtectionSearchStateSessionSchema.parse({
    sourceRole: options.role ?? "executed",
    binding: { missionId: "mission", testCaseId: "test", criterionId: "PROTECT-ALL", paperSha256: "e".repeat(64),
      original, executed, subject: { kind: "current", versionId: "v1" } },
    policyVersion: registration.policyVersion, planSha256: registration.planSha256, registrySha256: registration.registrySha256,
    execution: { executionId: "execution", jobId: "job", generation: 1 }, batchId: "batch", frameId: "frame", loaderId: "loader",
  });
  let currentValue = "";
  const fill = vi.fn(async (value: string, options: { timeout: number }) => {
    if (options.timeout <= 0) throw new Error("expired dispatch"); currentValue = value;
  });
  const close = vi.fn(async () => undefined);
  const locator = vi.fn(() => ({ fill }));
  const page = { locator, close } as unknown as Page;
  const observation = (): HtmlProtectionSearchInputObservation => ({
    schemaVersion: "html-protection-search-input-observation-v1", availability: "available",
    frameId: "frame", loaderId: "loader", physicalInput: { sha256: expected.binding[expected.sourceRole].sha256,
      byteLength: expected.binding[expected.sourceRole].byteLength }, gaps: [],
    input: { matchCount: 1, backendNodeId: 5, id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml",
      type: "search", value: currentValue, disabled: false, readOnly: false },
  });
  const read = vi.fn(async () => ({ page, observation: observation() }));
  const nativeInput = { read };
  const session = createHtmlProtectionSearchStateSession({ page, expected, originalRegistration: registration,
    nativeInput, caseDeadline: options.deadline ?? Date.now() + 45_000 });
  function request(index = 0): HtmlProtectionSearchStateRequest {
    return { schemaVersion: "html-protection-search-state-request-v1", binding: structuredClone(expected.binding),
      sourceRole: expected.sourceRole, policyVersion: expected.policyVersion, planSha256: expected.planSha256,
      registrySha256: expected.registrySha256, execution: structuredClone(expected.execution), batchId: expected.batchId,
      stateId: registration.states[index].stateId, stateKind: registration.states[index].stateKind };
  }
  function snapshot(index = 0) {
    const state = registration.states[index], stateValue = index === 0 ? "" : "value" in state ? state.value : "";
    const command = request(index);
    return { schemaVersion: "html-protection-snapshot-result-v1",
      request: { schemaVersion: "html-protection-snapshot-request-v1", binding: command.binding, sourceRole: command.sourceRole,
        policyVersion: command.policyVersion, planSha256: command.planSha256, registrySha256: command.registrySha256,
        execution: command.execution, batchId: command.batchId, stateId: command.stateId, registry: structuredClone(registration.registry),
        documentUrl: "about:blank" },
      availability: "available", projectionComplete: true, observedAt: "2026-10-13T00:00:00Z",
      physicalInput: { ...observation().physicalInput },
      realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2", frameId: "frame", loaderId: "loader", uniqueContextId: "isolated" },
      stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: "f".repeat(64), postMirrorSha256: "f".repeat(64), mutationEvents: 0 },
      body: { projection: "search-membership-v1", targetId: "search", cards: [], chapters: [],
        input: { matchCount: 1, tag: "INPUT", value: stateValue }, count: { matchCount: 1, text: "0" },
        counters: { scannedNodes: 1, collectedNodes: 0, shadowRoots: 0, textUtf8Bytes: 0 }, gaps: [] },
      bodySha256: "f".repeat(64), bodyUtf8Bytes: 400, gaps: [], limitations: [...HtmlProtectionSnapshotLimitations] };
  }
  return { expected, registration, page, nativeInput, session, request, snapshot, read, fill, close, locator, observation,
    setValue(value: string) { currentValue = value; } };
}
async function drain() { for (let count = 0; count < 15; count++) await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("closed native search state execution facts", () => {
  it("records boot with zero fill, then one fill per query/clear, without an overall verdict", async () => {
    const f = fixture(), boot = await f.session.execute(f.request());
    expect(boot).toMatchObject({ executionRecorded: true, fillCalls: 0, fillSettled: false, beforeValue: "", afterValue: "", gaps: [] });
    expect(f.fill).not.toHaveBeenCalled();
    for (let index = 1; index < 4; index++) {
      const facts = await f.session.execute(f.request(index));
      expect(facts.executionRecorded).toBe(true); expect(facts.fillCalls).toBe(1); expect(facts.fillSettled).toBe(true);
    }
    expect(f.fill.mock.calls.map(args => args[0])).toEqual(["needle", "absent", ""]);
    expect(f.fill.mock.calls.every(args => args[1].timeout > 0 && args[1].timeout <= 5000)).toBe(true);
    expect(f.locator).toHaveBeenCalledExactlyOnceWith("css=#search");
    expect(boot).not.toHaveProperty("verificationStatus"); expect(boot).not.toHaveProperty("passed");
  });
  it("a registered stateId without native observation is never execution", async () => {
    const f = fixture();
    f.read.mockRejectedValue(new Error("no native capability"));
    const facts = await f.session.execute(f.request());
    expect(facts.executionRecorded).toBe(false); expect(f.fill).not.toHaveBeenCalled();
  });
  it.each(["selector", "value", "url", "script", "evaluate", "env", "timeoutMs"])("rejects client %s before any read/fill", async key => {
    const f = fixture(), facts = await f.session.execute({ ...f.request(), [key]: "anything" });
    expect(facts.gaps).toEqual(["invalid-request"]); expect(f.read).not.toHaveBeenCalled(); expect(f.fill).not.toHaveBeenCalled();
  });
  it("requires matching full binding, execution and registered state pair", async () => {
    const f = fixture(), bad = f.request();
    bad.binding.subject = { kind: "candidate", candidateId: "other" };
    expect((await f.session.execute(bad)).gaps).toEqual(["binding-mismatch"]);
    expect((await f.session.execute({ ...f.request(), stateId: "elsewhere" })).gaps).toEqual(["unregistered-state"]);
    expect((await f.session.execute({ ...f.request(), stateKind: "clear" })).gaps).toEqual(["unregistered-state"]);
    expect((await f.session.execute({ ...f.request(), execution: { ...f.expected.execution, generation: 2 } })).gaps).toEqual(["binding-mismatch"]);
    expect(f.fill).not.toHaveBeenCalled();
  });
  it("enforces finite order and rejects replay, concurrency and a fifth state", async () => {
    const f = fixture();
    expect((await f.session.execute(f.request(1))).gaps).toEqual(["out-of-order-state"]);
    const pending = f.session.execute(f.request());
    expect((await f.session.execute(f.request())).gaps).toEqual(["operation-in-progress"]);
    expect((await pending).executionRecorded).toBe(true);
    expect((await f.session.execute(f.request())).gaps).toEqual(["out-of-order-state"]);
    for (let index = 1; index < 4; index++) await f.session.execute(f.request(index));
    expect((await f.session.execute(f.request(3))).gaps).toEqual(["out-of-order-state"]);
    expect(f.fill).toHaveBeenCalledTimes(3);
  });
  it.each(["text=Search", "xpath=//input", "#search >> nth=0", "css="])("unsupported registry %s cannot fill", async selector => {
    const f = fixture({ selector });
    const facts = await f.session.execute(f.request());
    expect(facts.executionRecorded).toBe(false); expect(f.fill).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });
  it("normalizes only the explicit native css prefix", async () => {
    const f = fixture({ selector: "css=#search" });
    expect((await f.session.execute(f.request())).executionRecorded).toBe(true);
    expect(f.locator).toHaveBeenCalledExactlyOnceWith("css=#search");
  });
  it("captures cloned registration, requests and method references before first await", async () => {
    const f = fixture(), bootRequest = f.request(), queryRequest = f.request(1);
    f.expected.binding.missionId = "mutated"; f.registration.states[1].value = "altered";
    f.nativeInput.read = vi.fn(async () => { throw new Error("replacement"); });
    f.page.locator = vi.fn(() => { throw new Error("replacement"); });
    f.page.close = vi.fn(async () => { throw new Error("replacement"); });
    expect((await f.session.execute(bootRequest)).executionRecorded).toBe(true);
    const pending = f.session.execute(queryRequest);
    queryRequest.binding.missionId = "late";
    expect((await pending).request?.binding.missionId).toBe("mission");
    expect(f.fill).toHaveBeenCalledExactlyOnceWith("needle", expect.any(Object));
    f.session.dispose(); await drain(); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("Original/expected mismatch cannot borrow another registration", async () => {
    const f = fixture(), originalRegistration = { ...f.registration, original: { ...f.registration.original, byteLength: 200 } };
    const session = createHtmlProtectionSearchStateSession({ page: f.page, nativeInput: f.nativeInput,
      expected: f.expected, originalRegistration, caseDeadline: Date.now() + 45_000 });
    expect((await session.execute(f.request())).gaps).toEqual(["binding-mismatch"]); expect(f.read).not.toHaveBeenCalled();
  });
  it("missing locator/native capabilities cannot claim boot or dispatch", async () => {
    const f = fixture(), page = { close: f.close } as unknown as Page;
    const session = createHtmlProtectionSearchStateSession({ page, nativeInput: f.nativeInput, expected: f.expected,
      originalRegistration: f.registration, caseDeadline: Date.now() + 45_000 });
    expect((await session.execute(f.request())).gaps).toEqual(["fill-unavailable"]);
    expect(f.read).not.toHaveBeenCalled();
    const unavailable = createHtmlProtectionSearchStateSession({ page: f.page, nativeInput: {} as typeof f.nativeInput,
      expected: f.expected, originalRegistration: f.registration, caseDeadline: Date.now() + 45_000 });
    expect((await unavailable.execute(f.request())).gaps).toEqual(["native-unavailable"]); expect(f.fill).not.toHaveBeenCalled();
  });
  it("an unsupported native CSS read cannot reach fill despite a constructed locator", async () => {
    const f = fixture({ selector: "#search:unknown-pseudo" });
    f.read.mockRejectedValue(new Error("native selector unsupported"));
    expect((await f.session.execute(f.request())).gaps).toEqual(["native-unavailable"]);
    expect(f.fill).not.toHaveBeenCalled();
  });  it("uses the physical bytes of each role rather than always the Original hash", async () => {
    const f = fixture({ role: "original" });
    expect((await f.session.execute(f.request())).executionRecorded).toBe(true);
    const g = fixture();
    g.read.mockImplementation(async () => ({ page: g.page, observation: { ...g.observation(),
      physicalInput: { sha256: g.expected.binding.original.sha256, byteLength: g.expected.binding.original.byteLength } } }));
    expect((await g.session.execute(g.request())).gaps).toEqual(["physical-input-mismatch"]);
  });
  it.each([
    ["frame", "document-mismatch"], ["loader", "document-mismatch"], ["sha", "physical-input-mismatch"],
    ["size", "physical-input-mismatch"], ["id", "input-identity-mismatch"], ["tag", "input-identity-mismatch"],
    ["namespace", "input-identity-mismatch"], ["type", "input-identity-mismatch"],
    ["disabled", "unsupported-input"], ["readonly", "unsupported-input"], ["value", "input-value-mismatch"],
  ])("rejects native %s drift before any fill", async (field, gap) => {
    const f = fixture(), observation = f.observation();
    if (field === "frame") observation.frameId = "other";
    if (field === "loader") observation.loaderId = "other";
    if (field === "sha") observation.physicalInput.sha256 = "0".repeat(64);
    if (field === "size") observation.physicalInput.byteLength++;
    if (field === "id") observation.input!.id = "other";
    if (field === "tag") observation.input!.tag = "DIV";
    if (field === "namespace") observation.input!.namespace = "http://www.w3.org/2000/svg";
    if (field === "type") observation.input!.type = "password";
    if (field === "disabled") observation.input!.disabled = true;
    if (field === "readonly") observation.input!.readOnly = true;
    if (field === "value") observation.input!.value = "other";
    f.read.mockResolvedValue({ page: f.page, observation });
    expect((await f.session.execute(f.request())).gaps).toEqual([gap]);
    expect(f.fill).not.toHaveBeenCalled();
  });
  it.each([0, 2])("requires exactly one original input, observed %s", async matchCount => {
    const f = fixture(), observation = { ...f.observation(), input: { matchCount, backendNodeId: null, id: null, tag: null,
      namespace: null, type: null, value: null, disabled: null, readOnly: null } };
    f.read.mockResolvedValue({ page: f.page, observation });
    expect((await f.session.execute(f.request())).gaps).toEqual([matchCount === 0 ? "missing-input" : "ambiguous-input"]);
  });
  it("does not close a foreign read Page and cannot continue on it", async () => {
    const f = fixture(), foreignClose = vi.fn(), foreign = { close: foreignClose } as unknown as Page;
    f.read.mockResolvedValue({ page: foreign, observation: f.observation() });
    expect((await f.session.execute(f.request())).gaps).toEqual(["page-mismatch"]);
    await drain(); expect(f.close).toHaveBeenCalledTimes(1); expect(foreignClose).not.toHaveBeenCalled();
  });
  it("API success without the requested input change cannot complete a state", async () => {
    const f = fixture(); await f.session.execute(f.request());
    f.fill.mockImplementation(async () => undefined);
    expect((await f.session.execute(f.request(1)))).toMatchObject({ fillCalls: 1, fillSettled: true,
      executionRecorded: false, gaps: ["input-value-mismatch"] });
  });
  it("replacement input after fill is not the registered same-node execution", async () => {
    const f = fixture(); await f.session.execute(f.request());
    f.read.mockImplementation(async () => {
      const observation = f.observation();
      if (f.fill.mock.calls.length) observation.input!.backendNodeId = 6;
      return { page: f.page, observation };
    });
    expect((await f.session.execute(f.request(1))).gaps).toEqual(["input-identity-mismatch"]);
  });
  it("fill rejection closes and poisons the session without retry", async () => {
    const f = fixture(); await f.session.execute(f.request());
    f.fill.mockRejectedValue(new Error("fill unavailable"));
    expect((await f.session.execute(f.request(1))).gaps).toEqual(["fill-unavailable"]);
    expect((await f.session.execute(f.request(1))).gaps).toEqual(["session-unavailable"]);
    expect(f.fill).toHaveBeenCalledTimes(1); await drain(); expect(f.close).toHaveBeenCalledTimes(1);
  });
});

describe("absolute search action/case deadlines and aborts", () => {
  it("expired case means zero read/fill and case budgets cannot be extended by constructor", async () => {
    vi.useFakeTimers();
    const f = fixture({ deadline: Date.now() + 1_000_000 });
    vi.setSystemTime(Date.now() + 45_000);
    expect((await f.session.execute(f.request())).gaps).toEqual(["deadline-exceeded"]);
    expect(f.read).not.toHaveBeenCalled(); expect(f.fill).not.toHaveBeenCalled();
  });
  it("checks actual fill dispatch when absolute time expires but the timer has not fired", async () => {
    vi.useFakeTimers();
    const f = fixture(); await f.session.execute(f.request());
    const start = Date.now(); let phase = false, reads = 0;
    vi.spyOn(Date, "now").mockImplementation(() => !phase || ++reads === 1 ? start : start + 5000);
    f.read.mockImplementationOnce(async () => ({ page: f.page, get observation() { phase = true; return f.observation(); } }));
    expect((await f.session.execute(f.request(1))).gaps).toEqual(["deadline-exceeded"]);
    expect(f.fill).not.toHaveBeenCalled();
  });
  it.each([5000, 30])("late fill completion at %s ms cannot win before an unscheduled timer", async milliseconds => {
    vi.useFakeTimers();
    const f = fixture({ deadline: Date.now() + (milliseconds === 30 ? 30 : 45_000) }); await f.session.execute(f.request());
    f.fill.mockImplementation(async value => { f.setValue(value); vi.setSystemTime(Date.now() + milliseconds); });
    const facts = await f.session.execute(f.request(1));
    expect(facts).toMatchObject({ fillCalls: 1, fillSettled: false, executionRecorded: false, gaps: ["deadline-exceeded"] });
    expect((await f.session.execute(f.request(1))).gaps).toEqual(["session-unavailable"]);
  });
  it("action timeout, late callback and later requests never retry or claim completed", async () => {
    vi.useFakeTimers();
    const f = fixture(); await f.session.execute(f.request());
    let finish!: () => void;
    f.fill.mockImplementation(value => new Promise<void>(resolve => { finish = () => { f.setValue(value); resolve(); }; }));
    const pending = f.session.execute(f.request(1)); await drain();
    expect(f.fill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).gaps).toEqual(["deadline-exceeded"]);
    finish(); await drain();
    expect((await f.session.execute(f.request(2))).gaps).toEqual(["session-unavailable"]);
    expect(f.fill).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("abort before read and abort during pending fill poison only the owned Page", async () => {
    const early = fixture(), stopped = new AbortController(); stopped.abort();
    expect((await early.session.execute(early.request(), stopped.signal)).gaps).toEqual(["aborted"]);
    expect(early.read).not.toHaveBeenCalled();
    const f = fixture(), controller = new AbortController(); await f.session.execute(f.request());
    let finish!: () => void;
    f.fill.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = f.session.execute(f.request(1), controller.signal); await drain(); controller.abort();
    expect((await pending).gaps).toEqual(["aborted"]);
    finish(); await drain(); expect(f.fill).toHaveBeenCalledTimes(1); expect(f.close).toHaveBeenCalledTimes(1);
    expect((await f.session.execute(f.request(1))).executionRecorded).toBe(false);
  });
});

describe("same-page native snapshot continuation binding facts", () => {
  it("requires real prior execution and links only the latest bound state", async () => {
    const f = fixture();
    expect((await f.session.linkSnapshot({ page: f.page, snapshot: f.snapshot() })).linked).toBe(false);
    await f.session.execute(f.request());
    expect(await f.session.linkSnapshot({ page: f.page, snapshot: f.snapshot() })).toEqual({ linked: true, gaps: [] });
    await f.session.execute(f.request(1));
    expect((await f.session.linkSnapshot({ page: f.page, snapshot: f.snapshot() })).linked).toBe(false);
    expect((await f.session.linkSnapshot({ page: f.page, snapshot: f.snapshot(1) })).linked).toBe(true);
  });
  it("foreign snapshot Page is rejected and never closed", async () => {
    const f = fixture(), close = vi.fn(), foreign = { close } as unknown as Page;
    await f.session.execute(f.request());
    expect(await f.session.linkSnapshot({ page: foreign, snapshot: f.snapshot() })).toEqual({ linked: false, gaps: ["page-mismatch"] });
    expect(close).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
  });
  it.each(["mission", "paper", "subject", "role", "plan", "registry", "batch", "state", "execution", "frame", "loader", "sha", "size", "input", "target", "partial"])(
    "rejects snapshot %s mismatch even with the same body digest", async field => {
      const f = fixture(); await f.session.execute(f.request()); const snapshot = f.snapshot();
      if (field === "mission") snapshot.request.binding.missionId = "other";
      if (field === "paper") snapshot.request.binding.paperSha256 = "0".repeat(64);
      if (field === "subject") snapshot.request.binding.subject = { kind: "candidate", candidateId: "other" };
      if (field === "role") snapshot.request.sourceRole = "original";
      if (field === "plan") snapshot.request.planSha256 = "0".repeat(64);
      if (field === "registry") snapshot.request.registry.inputSelector = "#other";
      if (field === "batch") snapshot.request.batchId = "other";
      if (field === "state") snapshot.request.stateId = "other";
      if (field === "execution") snapshot.request.execution.generation++;
      if (field === "frame") snapshot.realm.frameId = "other";
      if (field === "loader") snapshot.realm.loaderId = "other";
      if (field === "sha") snapshot.physicalInput.sha256 = "0".repeat(64);
      if (field === "size") snapshot.physicalInput.byteLength++;
      if (field === "input") snapshot.body.input.value = "unexpected";
      if (field === "target") snapshot.body.targetId = "other";
      if (field === "partial") snapshot.projectionComplete = false;
      expect((await f.session.linkSnapshot({ page: f.page, snapshot })).linked).toBe(false);
    });
  it("rechecks live native identity and current value after the snapshot envelope", async () => {
    const f = fixture(); await f.session.execute(f.request());
    f.setValue("external-change");
    expect((await f.session.linkSnapshot({ page: f.page, snapshot: f.snapshot() })).gaps).toEqual(["input-value-mismatch"]);
    expect((await f.session.execute(f.request(1))).gaps).toEqual(["session-unavailable"]);
  });
  it("clones the snapshot envelope before awaiting the fixed native read", async () => {
    const f = fixture(); await f.session.execute(f.request());
    const snapshot = f.snapshot(), pending = f.session.linkSnapshot({ page: f.page, snapshot });
    snapshot.request.binding.missionId = "mutated"; snapshot.realm.loaderId = "other";
    expect((await pending).linked).toBe(true);
  });
});
