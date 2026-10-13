// @vitest-environment node
import { Readable, PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HtmlProtectionSnapshotRequestSchema } from "@evolution/contracts";
import { htmlProtectionSnapshotRegistrySha256 } from "./vercel-sandbox-html-protection-snapshot";
import {
  HTML_PROTECTION_CLOUD_URL as url, HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_CSP as csp,
  HTML_PROTECTION_CLOUD_LIMITS as limits, HTML_PROTECTION_CLOUD_RUNNER_SCRIPT as runner,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
} from "./vercel-sandbox-html-protection-cloud-protocol";
import {
  runVercelSandboxHtmlProtectionCloudObservation as run, readBoundedHtmlProtectionPrivateFile as read,
  type HtmlProtectionPreparedBrowserFactory,
} from "./vercel-sandbox-html-protection-cloud-transport";
const html = Buffer.from('<article id="card">tail😄</article>');
const bundle = Buffer.from("// synthetic owned SDK transport fixture; not a deployable runtime");
const runtimeBinding = { version: "html-protection-private-cloud-v1" as const, sha256: sha(bundle), byteLength: bundle.byteLength };
function request(projection: "boot-subtree-v1" | "copy-material-v1" = "boot-subtree-v1") {
  const artifact = { sourceArtifactId: "source", sha256: sha(html), byteLength: html.byteLength };
  const registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: artifact.sha256,
    projection, targets: [{ targetId: "card", selector: "#card" }] };
  return HtmlProtectionSnapshotRequestSchema.parse({
    schemaVersion: "html-protection-snapshot-request-v1", sourceRole: "original", documentUrl: url,
    binding: { missionId: "mission", testCaseId: "frozen", criterionId: "protect", paperSha256: "a".repeat(64),
      original: artifact, executed: artifact, subject: { kind: "current", versionId: "v1" } },
    policyVersion: "profile-v1", planSha256: "b".repeat(64), registrySha256: htmlProtectionSnapshotRegistrySha256(registry),
    registry, execution: { executionId: "execution", jobId: "job", generation: 1 }, stateId: "boot", batchId: "batch",
  });
}
function sdk(options: { mutate?: (value: Record<string, unknown>) => void; missing?: string;
  wrongBundle?: boolean; streamError?: boolean; hugeResult?: boolean; shared?: boolean; exitCode?: number } = {}) {
  const files = new Map<string, Uint8Array>([[paths.bundle, options.wrongBundle ? Buffer.from("wrong bundle") : bundle]]);
  const stopped = vi.fn(async () => undefined), stdout = vi.fn(async () => '{"availability":"available","body":"forged console"}');
  let assignedName = "";
  const sandbox = {
    get name() { return options.shared ? "another-task" : assignedName; }, cwd: "/vercel/sandbox", persistent: false,
    currentSession: () => ({ networkPolicy: "deny-all" }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (options.missing === path) return null;
      if (path === paths.result && options.hugeResult) return Readable.from([Buffer.alloc(limits.resultBytes + 1)]);
      if (path === paths.result && options.streamError) {
        return new Readable({ read() { this.push(Buffer.from("{")); this.destroy(new Error("synthetic stream failure")); } });
      }
      const bytes = files.get(path); return bytes ? Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]) : null;
    }),
    writeFiles: vi.fn(async (entries: Array<{ path: string; content: Uint8Array }>) => { for (const file of entries) files.set(file.path, options.wrongBundle && file.path === paths.bundle ? Buffer.from("tampered staged bundle") : file.content); }),
    runCommand: vi.fn(async (command: Record<string, unknown>) => {
      void command;
      const input = JSON.parse(Buffer.from(files.get(paths.input)!).toString("utf8"));
      const body = { projection: "boot-subtree-v1", targets: [{ targetId: "card", matchCount: 1, nodes: [
        { index: 0, parent: null, edge: "root", type: 1, name: "ARTICLE", namespace: "http://www.w3.org/1999/xhtml",
          value: null, attributes: [{ name: "id", namespace: null, value: "card" }], assignedIndexes: [], assignedOutsideTarget: 0 },
        { index: 1, parent: 0, edge: "light", type: 3, name: "#text", namespace: null,
          value: "tail😄", attributes: [], assignedIndexes: [], assignedOutsideTarget: 0 },
      ] }], counters: { scannedNodes: 8, collectedNodes: 2, shadowRoots: 0, textUtf8Bytes: 12 }, gaps: [] };
      const observation: Record<string, unknown> = {
        schemaVersion: "html-protection-private-observation-v1", nonce: input.nonce, request: input.request,
        ownedRuntime: input.ownedRuntime, availability: "available",
        custody: { staged: input.material, nodeResponse: input.material, browserResponse: input.material,
          documentUrl: url, status: 200, contentType: "text/html", contentSecurityPolicy: csp, fromServiceWorker: false,
          blockedRequests: 0, navigation: { frameId: "frame", loaderId: "loader", requestId: "request", responseUrl: url } },
        snapshot: {
          schemaVersion: "html-protection-snapshot-result-v1", request: input.request, availability: "available",
          projectionComplete: true, observedAt: "2026-10-13T00:00:00Z", physicalInput: input.material,
          realm: { observerVersion: "chromium-cdp-isolated-stable-dom-v2", frameId: "frame", loaderId: "loader", uniqueContextId: "realm" },
          stability: { protocol: "chromium-cdp-dom-mutation-window-v1", preMirrorSha256: "c".repeat(64), postMirrorSha256: "c".repeat(64), mutationEvents: 0 },
          body, bodySha256: sha(canonical(body)), bodyUtf8Bytes: Buffer.byteLength(canonical(body)), gaps: [],
          limitations: [
            "Selected projection and targets only; not whole protection or cross-script closure.",
            "Closed/UA Shadow and iframe/object/embed contents are not collected; inert template mutation coverage is unavailable and shallow CDP transport is not a hard memory bound.",
            "No semantic or visual preservation verdict; page-returned JSON is not observation authority.",
            "Physical input hash identifies supplied bytes; caller must independently bind the served document.",
          ],
        },
      };
      options.mutate?.(observation);
      const bytes = Buffer.from(canonical(observation)); files.set(paths.result, bytes);
      files.set(paths.manifest, Buffer.from(canonical({
        schemaVersion: "html-protection-private-manifest-v1", nonce: input.nonce, requestSha256: sha(canonical(input.request)),
        ownedRuntimeSha256: sha(bundle), runnerSha256: sha(runner), result: { path: paths.result, sha256: sha(bytes), byteLength: bytes.byteLength },
      })));
      return { exitCode: options.exitCode ?? 0, stdout };
    }),
    stop: stopped,
  };
  const factory = vi.fn(async (spec: { name: string }) => { assignedName = spec.name; return sandbox; });
  const ports = { trustedRuntimeBinding: runtimeBinding, trustedRuntimeBytes: bundle, createPreparedBrowserSandbox: factory } as unknown as HtmlProtectionPreparedBrowserFactory;
  return { ports, factory, sandbox, files, stopped, stdout };
}
afterEach(() => { vi.useRealTimers(); });
describe("private Sandbox SDK observation transport", () => {
  it("rejects missing trusted factory/bundle and undefined copy before creating a paid VM", async () => {
    const fake = sdk();
    for (const ports of [{}, { createPreparedBrowserSandbox: fake.ports.createPreparedBrowserSandbox }, { trustedRuntimeBinding: runtimeBinding }])
      expect((await run({ request: request(), physicalHtml: html }, ports)).availability).toBe("unavailable");
    expect((await run({ request: request("copy-material-v1"), physicalHtml: html }, fake.ports)).availability).toBe("unavailable");
    expect(fake.factory).not.toHaveBeenCalled();
  });
  it("refuses wrong staged input or URL before Sandbox creation", async () => {
    const fake = sdk();
    await run({ request: request(), physicalHtml: Buffer.from("different") }, fake.ports);
    await run({ request: { ...request(), documentUrl: "http://external.invalid/" }, physicalHtml: html }, fake.ports);
    expect(fake.factory).not.toHaveBeenCalled();
  });
  it("reads full private bytes, independently checks their identities and ignores fake stdout", async () => {
    const fake = sdk(), result = await run({ request: request(), physicalHtml: html }, fake.ports);
    expect(result.availability).toBe("available");
    expect(fake.stdout).not.toHaveBeenCalled();
    expect(fake.sandbox.runCommand).toHaveBeenCalledWith(expect.objectContaining({
      cmd: "node", args: ["--max-old-space-size=512", paths.runner], cwd: "/vercel/sandbox",
    }));
    expect(fake.sandbox.runCommand.mock.calls[0]?.[0]).not.toHaveProperty("env");
    expect([...fake.files.keys()].filter(path => path.startsWith("dist/"))).toEqual([paths.html]);
    expect(fake.stopped).toHaveBeenCalledTimes(1);
  });
  it.each([paths.bundle, paths.manifest, paths.result])("refuses a missing private file %s", async missing => {
    const fake = sdk({ missing }); expect((await run({ request: request(), physicalHtml: html }, fake.ports)).availability).toBe("unavailable");
    expect(fake.stopped).toHaveBeenCalledTimes(1);
  });
  it("checks the actual staged composition bundle before launching commands", async () => {
    const fake = sdk({ wrongBundle: true }), result = await run({ request: request(), physicalHtml: html }, fake.ports);
    expect(result).toMatchObject({ availability: "unavailable", reason: "runtime-integrity" });
    expect(fake.sandbox.runCommand).not.toHaveBeenCalled();
  });
  it("rejects an invalid composition bundle before creating or writing to a paid VM", async () => {
    const fake = sdk(); fake.ports.trustedRuntimeBytes = Buffer.from("unbound bundle");
    expect(await run({ request: request(), physicalHtml: html }, fake.ports)).toMatchObject({ availability: "unavailable", reason: "runtime-integrity" });
    expect(fake.factory).not.toHaveBeenCalled();
  });
  it("freezes caller-held Artifact and bundle views before awaiting the factory", async () => {
    const fake = sdk(), sourceView = Buffer.from(html), bundleView = Buffer.from(bundle);
    let finish!: (value: Awaited<ReturnType<NonNullable<HtmlProtectionPreparedBrowserFactory["createPreparedBrowserSandbox"]>>>) => void;
    const ports: HtmlProtectionPreparedBrowserFactory = { ...fake.ports, trustedRuntimeBytes: bundleView, trustedRuntimeBinding: { ...runtimeBinding },
      createPreparedBrowserSandbox: spec => new Promise(resolve => { finish = resolve; void fake.factory(spec); }) };
    const pending = run({ request: request(), physicalHtml: sourceView }, ports);
    sourceView.fill(0); bundleView.fill(0); ports.trustedRuntimeBinding!.sha256 = "0".repeat(64);
    finish(fake.sandbox as unknown as Parameters<typeof finish>[0]);
    expect((await pending).availability).toBe("available");
    expect(Buffer.from(fake.files.get(paths.html)!)).toEqual(html);
    expect(Buffer.from(fake.files.get(paths.bundle)!)).toEqual(bundle);
  });
  it("never stops an unrelated or shared Sandbox returned by a broken factory", async () => {
    const fake = sdk({ shared: true }); expect((await run({ request: request(), physicalHtml: html }, fake.ports)).availability).toBe("unavailable");
    expect(fake.stopped).not.toHaveBeenCalled(); expect(fake.sandbox.writeFiles).not.toHaveBeenCalled();
  });
  it.each([
    (value: Record<string, unknown>) => { value.nonce = "d".repeat(64); },
    (value: Record<string, unknown>) => { const foreignRequest = value.request as ReturnType<typeof request>; foreignRequest.binding.missionId = "another"; },
    (value: Record<string, unknown>) => { const runtime = value.ownedRuntime as { sha256: string }; runtime.sha256 = "d".repeat(64); },
    (value: Record<string, unknown>) => { const snapshot = value.snapshot as { bodySha256: string }; snapshot.bodySha256 = "d".repeat(64); },
    (value: Record<string, unknown>) => { const custody = value.custody as { browserResponse: { sha256: string } }; custody.browserResponse.sha256 = "d".repeat(64); },
    (value: Record<string, unknown>) => { value.wholeProtectionPassed = true; },
  ])("does not accept internally consistent transport bytes with forged content %#", async mutate => {
    const fake = sdk({ mutate }), result = await run({ request: request(), physicalHtml: html }, fake.ports);
    expect(result.availability).toBe("unavailable");
  });
  it.each([{ streamError: true }, { hugeResult: true }, { exitCode: 1 }])("rejects stream/size/command failures %j without stdout fallback", async options => {
    const fake = sdk(options); expect((await run({ request: request(), physicalHtml: html }, fake.ports)).availability).toBe("unavailable");
    expect(fake.stdout).not.toHaveBeenCalled();
  });
  it("bounds and cancels an in-progress private stream", async () => {
    const stream = new PassThrough(), control = new AbortController();
    const pending = read({ readFile: async () => stream }, paths.result, 100, control.signal);
    await Promise.resolve(); stream.write(Buffer.from("partial")); control.abort();
    await expect(pending).rejects.toThrow("private-file-timeout"); expect(stream.destroyed).toBe(true);
  });
  it("rejects oversized chunks before copying or parsing them", async () => {
    await expect(read({ readFile: async () => Readable.from([Buffer.alloc(101)]) }, paths.result, 100, new AbortController().signal)).rejects.toThrow("private-file-limit");
  });
  it("stops only the newly owned VM if a factory resolves after the original deadline", async () => {
    vi.useFakeTimers(); const fake = sdk(); let resolve!: (value: Awaited<ReturnType<NonNullable<HtmlProtectionPreparedBrowserFactory["createPreparedBrowserSandbox"]>>>) => void;
    const ports: HtmlProtectionPreparedBrowserFactory = { trustedRuntimeBinding: runtimeBinding, trustedRuntimeBytes: bundle,
      createPreparedBrowserSandbox: spec => new Promise(done => { resolve = done; void fake.factory(spec); }) };
    const pending = run({ request: request(), physicalHtml: html }, ports);
    await vi.advanceTimersByTimeAsync(limits.deadlineMs);
    expect(await pending).toMatchObject({ availability: "unavailable", reason: "private-file-timeout" });
    resolve(fake.sandbox as unknown as Parameters<typeof resolve>[0]); await Promise.resolve(); await Promise.resolve();
    expect(fake.stopped).toHaveBeenCalledTimes(1); expect(fake.sandbox.runCommand).not.toHaveBeenCalled();
  });
});
