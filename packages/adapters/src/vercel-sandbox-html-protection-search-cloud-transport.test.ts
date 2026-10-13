// @vitest-environment node
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HtmlProtectionSnapshotLimitations, HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateRequestSchema, HtmlProtectionSnapshotRequestSchema } from "@evolution/contracts";
import { HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_URL as url, HTML_PROTECTION_CLOUD_CSP as csp,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";
import { HtmlProtectionSearchCloudInputSchema, HtmlProtectionSearchCloudObservationSchema, htmlProtectionSearchCloudInputSha256,
  type HtmlProtectionSearchCloudInput, type HtmlProtectionSearchCloudStep } from "./vercel-sandbox-html-protection-search-cloud-protocol";
import { runVercelSandboxHtmlProtectionSearchObservation as run, HTML_PROTECTION_SEARCH_CLOUD_RUNNER_SCRIPT as runner,
  type HtmlProtectionSearchObservationArgs } from "./vercel-sandbox-html-protection-search-cloud-transport";
import type { HtmlProtectionPreparedBrowserFactory } from "./vercel-sandbox-html-protection-cloud-transport";
const html = Buffer.from('<input id="search"><output id="count">0</output>');
const bundle = Buffer.from("// Synthetic SDK fixture, no user file or production VM.");
const runtimeBinding = { version: "html-protection-private-cloud-v1" as const, sha256: sha(bundle), byteLength: bundle.byteLength };
function args(): HtmlProtectionSearchObservationArgs {
  const artifact = { sourceArtifactId: "source", sha256: sha(html), byteLength: html.byteLength };
  const registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: artifact.sha256,
    projection: "search-membership-v1", targetId: "search", inputSelector: "#search", countSelector: "#count", cardSelector: ".card", chapterSelector: ".chapter" };
  const registration = HtmlProtectionSearchStateRegistrationSchema.parse({ schemaVersion: "html-protection-search-state-registration-v1", original: artifact,
    registry, registrySha256: sha(canonical(registry)), policyVersion: "fixed-v1", planSha256: "a".repeat(64),
    input: { id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml", type: "text", initialValue: "" },
    states: [{ stateKind: "boot", stateId: "boot" }, { stateKind: "query-positive", stateId: "positive", value: "needle" },
      { stateKind: "query-negative", stateId: "negative", value: "absent" }, { stateKind: "clear", stateId: "clear", value: "" }] });
  const common = { binding: { missionId: "mission", testCaseId: "same-paper", criterionId: "protect", paperSha256: "b".repeat(64), original: artifact,
    executed: artifact, subject: { kind: "current", versionId: "v1" } }, sourceRole: "original", policyVersion: registration.policyVersion,
    planSha256: registration.planSha256, registrySha256: registration.registrySha256, execution: { executionId: "execution", jobId: "job", generation: 1 }, batchId: "search" };
  return { registration, physicalHtml: html,
    stateRequests: registration.states.map(state => HtmlProtectionSearchStateRequestSchema.parse({ ...common,
      schemaVersion: "html-protection-search-state-request-v1", stateId: state.stateId, stateKind: state.stateKind })),
    snapshotRequests: registration.states.map(state => HtmlProtectionSnapshotRequestSchema.parse({ ...common,
      schemaVersion: "html-protection-snapshot-request-v1", stateId: state.stateId, registry, documentUrl: url })) };
}
function observed(input: HtmlProtectionSearchCloudInput) {
  const value = (index: number) => index === 0 ? input.registration.input.initialValue : index === 1 ? input.registration.states[1].value : index === 2 ? input.registration.states[2].value : "";
  const steps: HtmlProtectionSearchCloudStep[] = input.stateRequests.map((stateRequest, index) => {
    const body = { projection: "search-membership-v1" as const, targetId: "search", cards: [], chapters: [],
      input: { matchCount: 1, tag: "INPUT", value: value(index) }, count: { matchCount: 1, text: "0" },
      counters: { scannedNodes: 5, collectedNodes: 2, shadowRoots: 0, textUtf8Bytes: Buffer.byteLength(value(index)) + 1 }, gaps: [] };
    return { status: "observed", stateRequest, actionFacts: { request: stateRequest, fillCalls: index === 0 ? 0 : 1, fillSettled: index !== 0,
      beforeValue: index <= 1 ? input.registration.input.initialValue : value(index - 1), afterValue: value(index), executionRecorded: true, gaps: [] },
      snapshot: { schemaVersion: "html-protection-snapshot-result-v1", request: input.snapshotRequests[index]!, availability: "available", projectionComplete: true,
        observedAt: "2026-10-13T01:00:00Z", physicalInput: input.material, realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2",
          frameId: "frame", loaderId: "loader", uniqueContextId: "realm-" + index },
        stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: "a".repeat(64), postMirrorSha256: "a".repeat(64), mutationEvents: 0 },
        body, bodySha256: sha(canonical(body)), bodyUtf8Bytes: Buffer.byteLength(canonical(body)), gaps: [], limitations: [...HtmlProtectionSnapshotLimitations] },
      linkFacts: { linked: true, gaps: [] } };
  });
  return HtmlProtectionSearchCloudObservationSchema.parse({ schemaVersion: "html-protection-private-search-observation-v1", nonce: input.nonce,
    request: input.request, input, batchRequestSha256: htmlProtectionSearchCloudInputSha256(input), ownedRuntime: input.ownedRuntime, availability: "available",
    custody: { staged: input.material, nodeResponse: input.material, browserResponse: input.material, documentUrl: url, status: 200, contentType: "text/html",
      contentSecurityPolicy: csp, fromServiceWorker: false, blockedRequests: 0, navigation: { frameId: "frame", loaderId: "loader", requestId: "request", responseUrl: url } }, steps });
}
function sdk(options: { interrupt?: boolean; corruptCounters?: boolean; wrongHash?: boolean; foreign?: boolean; exit?: number } = {}) {
  const files = new Map<string, Uint8Array>(), stopped = vi.fn(async () => {}), stdout = vi.fn(async () => "forged page console"); let name = "";
  const sandbox = { get name() { return options.foreign ? "another-task" : name; }, cwd: "/vercel/sandbox", persistent: false,
    currentSession: () => ({ networkPolicy: "deny-all" }), stop: stopped,
    writeFiles: vi.fn(async (entries: Array<{ path: string; content: Uint8Array }>) => { for (const entry of entries) files.set(entry.path, Buffer.from(entry.content)); }),
    readFile: vi.fn(async ({ path }: { path: string }) => files.has(path) ? Readable.from([files.get(path)!]) : null),
    runCommand: vi.fn(async () => {
      const input = HtmlProtectionSearchCloudInputSchema.parse(JSON.parse(Buffer.from(files.get(paths.input)!).toString("utf8")));
      const observation = observed(input);
      if (observation.availability !== "available") throw Error("Synthetic fixture expects complete sequence");
      let output: unknown = observation;
      if (options.interrupt) output = { ...observation, availability: "unavailable", phase: "after-startup", reason: "state-execution-unavailable", steps: observation.steps.map((step, index) =>
        index === 0 ? step : index === 1 ? { status: "action-failed", stateRequest: input.stateRequests[index], actionFacts: { fillCalls: 1, fillSettled: false, executionRecorded: false, gaps: ["fill-unavailable"] } }
        : { status: "not-executed", stateRequest: input.stateRequests[index], reason: "prior-step-unavailable" }) };
      if (options.corruptCounters) {
        const step = observation.steps[0]; if (step.status !== "observed" || !step.snapshot.body) throw Error("missing fixture body");
        step.snapshot.body.counters.collectedNodes = 0; step.snapshot.bodySha256 = sha(canonical(step.snapshot.body)); step.snapshot.bodyUtf8Bytes = Buffer.byteLength(canonical(step.snapshot.body));
      }
      const bytes = Buffer.from(canonical(output)); files.set(paths.result, bytes);
      files.set(paths.manifest, Buffer.from(canonical({ schemaVersion: "html-protection-private-search-manifest-v1", nonce: input.nonce,
        batchRequestSha256: options.wrongHash ? sha(canonical(input.request)) : htmlProtectionSearchCloudInputSha256(input), ownedRuntimeSha256: sha(bundle), runnerSha256: sha(runner),
        result: { path: paths.result, sha256: sha(bytes), byteLength: bytes.byteLength } })));
      return { exitCode: options.exit ?? 0, stdout };
    }),
  };
  const factory = vi.fn(async (spec: { name: string }) => { name = spec.name; return sandbox; });
  return { files, factory, sandbox, stopped, stdout,
    ports: { trustedRuntimeBinding: runtimeBinding, trustedRuntimeBytes: bundle, createPreparedBrowserSandbox: factory } as unknown as HtmlProtectionPreparedBrowserFactory };
}
describe("closed consecutive private Sandbox transport", () => {
  it("requires fixed trusted runtime/factory and matching physical bytes before paid creation", async () => {
    const f = sdk(); expect(await run(args())).toMatchObject({ availability: "unavailable", reason: "missing-trusted-runtime" });
    expect(await run({ ...args(), physicalHtml: Buffer.from("different") }, f.ports)).toMatchObject({ availability: "unavailable", reason: "request-binding-mismatch" });
    expect(f.factory).not.toHaveBeenCalled();
  });
  it("reads full private input/result/manifest, ignores console and verifies whole input digest", async () => {
    const f = sdk(), result = await run(args(), f.ports); expect(result.availability).toBe("available");
    if (result.availability !== "available") throw Error("missing private result");
    expect(result.observation.availability).toBe("available"); expect(result.resultSha256).toBe(sha(f.files.get(paths.result)!));
    expect(result.resultByteLength).toBe(f.files.get(paths.result)!.byteLength); expect(f.stdout).not.toHaveBeenCalled();
    expect(f.sandbox.runCommand).toHaveBeenCalledWith(expect.objectContaining({ cmd: "node", args: ["--max-old-space-size=512", paths.runner], cwd: "/vercel/sandbox" }));
    expect(Buffer.from(f.files.get(paths.runner)!).toString()).toBe(runner); expect(f.stopped).toHaveBeenCalledTimes(1);
  });
  it("keeps actual interrupted observations separate from successful private transport", async () => {
    const f = sdk({ interrupt: true }), actual = await run(args(), f.ports); expect(actual.availability).toBe("available");
    if (actual.availability !== "available") throw Error("missing prefix");
    expect(actual.observation).toMatchObject({ availability: "unavailable", phase: "after-startup" });
    if (actual.observation.availability === "available" || actual.observation.phase !== "after-startup") throw Error("missing prefix");
    expect(actual.observation.steps.map(step => step.status)).toEqual(["observed", "action-failed", "not-executed", "not-executed"]);
  });
  it("rejects native counters even when body and result digests were recomputed", async () => {
    const f = sdk({ corruptCounters: true }); expect(await run(args(), f.ports)).toMatchObject({ availability: "unavailable", reason: "private-file-integrity" });
  });
  it("rejects a boot-only digest rather than treating it as the four-state input", async () => {
    const f = sdk({ wrongHash: true }); expect(await run(args(), f.ports)).toMatchObject({ availability: "unavailable", reason: "request-binding-mismatch" });
  });
  it("never stops or writes a foreign/shared resource returned by a factory", async () => {
    const f = sdk({ foreign: true }); expect(await run(args(), f.ports)).toMatchObject({ availability: "unavailable", reason: "sandbox-policy-unavailable" });
    expect(f.sandbox.writeFiles).not.toHaveBeenCalled(); expect(f.stopped).not.toHaveBeenCalled();
  });
  it("records command failure without claiming the private prefix was observed", async () => {
    const f = sdk({ exit: 1 }); expect(await run(args(), f.ports)).toMatchObject({ availability: "unavailable", reason: "runtime-exit" });
  });
});
afterEach(() => vi.useRealTimers());
it("rejects an owned VM resolving after the absolute deadline even before timers dispatch", async () => {
  vi.useFakeTimers(); const f = sdk(), create = f.ports.createPreparedBrowserSandbox!;
  f.ports.createPreparedBrowserSandbox = async spec => { const vm = await create(spec); vi.setSystemTime(Date.now() + 91_000); return vm; };
  expect(await run(args(), f.ports)).toMatchObject({ availability: "unavailable", reason: "private-file-timeout" });
  expect(f.sandbox.writeFiles).not.toHaveBeenCalled(); expect(f.stopped).toHaveBeenCalledTimes(1);
});
it("rejects late private results rather than letting delayed timers grant availability", async () => {
  vi.useFakeTimers(); const f = sdk(), command = f.sandbox.runCommand.getMockImplementation()!;
  f.sandbox.runCommand.mockImplementationOnce(async () => { const result = await command(); vi.setSystemTime(Date.now() + 91_000); return result; });
  expect(await run(args(), f.ports)).toMatchObject({ availability: "unavailable", reason: "private-file-timeout" });
  expect(f.stopped).toHaveBeenCalledTimes(1);
});