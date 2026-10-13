// @vitest-environment node
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { HtmlProtectionSearchInputObservationSchema } from "@evolution/contracts";
import { createHtmlProtectionSearchNativeInput } from "./html-protection-search-native-input";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const physicalInput = { sha256: "a".repeat(64), byteLength: 123 };
const fields = { connected: true, id: "search", tag: "INPUT", namespace: htmlNamespace, type: "search",
  value: "original", disabled: false, readOnly: false };
function expected(frameId = "frame", loaderId = "loader", physical = physicalInput) {
  const artifact = { sourceArtifactId: "source", ...physical };
  return { binding: { missionId: "mission", testCaseId: "test", criterionId: "PROTECT-ALL", paperSha256: "b".repeat(64),
    original: artifact, executed: artifact, subject: { kind: "current", versionId: "v1" } }, sourceRole: "executed",
  policyVersion: "finite", planSha256: "c".repeat(64), registrySha256: "d".repeat(64),
  execution: { executionId: "execution", jobId: "job", generation: 1 }, batchId: "batch", frameId, loaderId };
}
type FakeOptions = {
  count?: number; material?: unknown; realm?: "default" | "wrong-frame" | "missing" | "missing-unique" | "replaced";
  loaderChanged?: boolean; event?: string; backendChanged?: boolean; disconnected?: boolean;
  unsupportedCss?: boolean; protocolUnavailable?: boolean; counters?: unknown; secondValue?: string;
};
function fake(options: FakeOptions = {}) {
  const callbacks = new Map<string, (event: unknown) => void>();
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  let frames = 0, describes = 0, factReads = 0;
  const detach = vi.fn(async () => undefined);
  const session = {
    on(event: string, callback: (event: unknown) => void) { callbacks.set(event, callback); },
    off(event: string) { callbacks.delete(event); },
    async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      calls.push({ method, params });
      if (options.protocolUnavailable) throw Error("Synthetic native transport unavailable");
      if (["Runtime.enable", "DOM.enable", "DOM.getDocument", "Runtime.releaseObjectGroup"].includes(method)) return {};
      if (method === "Page.getFrameTree") { frames++; return { frameTree: { frame: { id: "frame",
        loaderId: options.loaderChanged && frames > 1 ? "changed" : "loader", url: "about:blank" } } }; }
      if (method === "Page.createIsolatedWorld") {
        if (options.realm !== "missing") callbacks.get("Runtime.executionContextCreated")?.({ context: {
          id: 41, name: params?.worldName, ...(options.realm === "missing-unique" ? {} : { uniqueId: "isolated-unique" }),
          auxData: { frameId: options.realm === "wrong-frame" ? "foreign" : "frame", isDefault: options.realm === "default", type: "isolated" },
        } });
        return { executionContextId: 41 };
      }
      if (method === "Runtime.callFunctionOn") {
        const mode = (params?.arguments as Array<{ value: { mode: string } }>)[0]!.value.mode;
        if (mode === "count") return { result: { type: "object", value: options.unsupportedCss ? { capabilityGap: "unsupported-selector" }
          : options.counters ?? { matchCount: options.count ?? 1, scannedNodes: 5, shadowRoots: 0, readUtf8Bytes: 21 } } };
        if (mode === "select") return { result: { type: "object", subtype: "node", objectId: "owned-native-input" } };
        if (mode === "facts") {
          factReads++;
          if (options.event) callbacks.get(options.event)?.({});
          if (options.realm === "replaced") callbacks.get("Runtime.executionContextDestroyed")?.({ executionContextId: 41 });
          return { result: { type: "object", value: options.material ?? { ...fields, connected: !options.disconnected,
            ...(options.secondValue && factReads > 1 ? { value: options.secondValue } : {}) } } };
        }
      }
      if (method === "DOM.requestNode") return { nodeId: 9 };
      if (method === "DOM.describeNode") { describes++; return { node: { nodeId: 9, backendNodeId: options.backendChanged && describes > 1 ? 51 : 50,
        nodeType: 1, nodeName: "INPUT", attributes: ["id", "search"] } }; }
      throw Error("Unexpected synthetic protocol method");
    },
    detach,
  };
  const createSession = vi.fn(async () => session);
  const close = vi.fn(async () => undefined), evaluate = vi.fn();
  const page = { context: () => ({ newCDPSession: createSession }), close, evaluate } as unknown as Page;
  const config = { page, expected: expected(), servedDocument: { frameId: "frame", loaderId: "loader", url: "about:blank", physicalInput: { ...physicalInput } },
    registeredCssSelector: "#search", caseDeadline: Date.now() + 45_000 };
  return { page, session, config, calls, createSession, close, evaluate, detach };
}
const observation = (result: { observation: unknown }) => HtmlProtectionSearchInputObservationSchema.parse(result.observation);
afterEach(() => { vi.useRealTimers(); });

describe("fixed isolated native input controller with synthetic CDP", () => {
  it("reads exact native fields/remote backend identity in an event-proven world and returns only its owned Page", async () => {
    const f = fake(), port = createHtmlProtectionSearchNativeInput(f.config), result = await port.read(f.page, "#search");
    const actual = observation(result);
    expect(result.page).toBe(f.page); expect(actual.availability).toBe("available");
    expect(actual.input).toEqual({ matchCount: 1, backendNodeId: 50, id: "search", tag: "INPUT", namespace: htmlNamespace,
      type: "search", value: "original", disabled: false, readOnly: false });
    expect(actual.input).not.toHaveProperty("connected");
    expect(actual.frameId).toBe("frame"); expect(actual.loaderId).toBe("loader"); expect(actual.physicalInput).toEqual(physicalInput);
    expect(f.calls.filter(call => call.method === "Runtime.callFunctionOn" && !call.params?.objectId)
      .every(call => call.params?.uniqueContextId === "isolated-unique")).toBe(true);
    expect(f.calls.filter(call => call.method === "Runtime.callFunctionOn" && call.params?.objectId)
      .every(call => !Object.hasOwn(call.params!, "executionContextId"))).toBe(true);
    expect(f.calls.find(call => call.method === "Page.createIsolatedWorld")?.params?.grantUniveralAccess).toBe(false);
    expect(f.calls.find(call => call.method === "DOM.describeNode")?.params).toEqual({ objectId: "owned-native-input", depth: 0, pierce: false });
    expect(f.createSession).toHaveBeenCalledExactlyOnceWith(f.page); expect(f.evaluate).not.toHaveBeenCalled();
    await Promise.resolve(); expect(f.detach).toHaveBeenCalledTimes(1); expect(f.close).not.toHaveBeenCalled();
  });
  it.each([0, 2])("retains native matchCount %i without choosing a matching node", async count => {
    const f = fake({ count }), actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search"));
    expect(actual.availability).toBe("available"); expect(actual.input?.matchCount).toBe(count);
    expect(Object.entries(actual.input!).every(([key, value]) => key === "matchCount" || value === null)).toBe(true);
    expect(f.calls.some(call => ["DOM.requestNode", "DOM.describeNode"].includes(call.method))).toBe(false);
    expect(f.calls.some(call => call.method === "Runtime.callFunctionOn"
      && (call.params?.arguments as Array<{ value: { mode: string } }>)[0]!.value.mode === "select")).toBe(false);
  });
  it.each(["default", "wrong-frame", "missing", "missing-unique", "replaced"] as const)("refuses %s realm instead of a main-world fallback", async realm => {
    const f = fake({ realm }), actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search"));
    expect(actual.availability).toBe("unavailable"); expect(actual).not.toHaveProperty("input");
    expect(f.evaluate).not.toHaveBeenCalled(); expect(f.calls.some(call => call.method === "Runtime.evaluate")).toBe(false);
  });
  it.each(["DOM.attributeModified", "DOM.childNodeRemoved", "DOM.shadowRootPushed", "DOM.documentUpdated"])("latches %s and rejects restored endpoints", async event => {
    const f = fake({ event }), actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search"));
    expect(actual.availability).toBe("unavailable"); expect(actual.gaps).toContain("document-mismatch");
  });
  it.each([{ loaderChanged: true }, { backendChanged: true }, { disconnected: true }, { secondValue: "changed" }])("refuses document/node drift: %j", async config => {
    const f = fake(config), actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search"));
    expect(actual.availability).toBe("unavailable"); expect(actual).not.toHaveProperty("input");
  });
  it("never opens a session for wrong Page, changed selector, untrusted byte metadata, expired deadline or initial abort", async () => {
    const f = fake(), port = createHtmlProtectionSearchNativeInput(f.config);
    expect(observation(await port.read({} as Page, "#search")).gaps).toEqual(["page-mismatch"]);
    expect(observation(await port.read(f.page, "#another")).gaps).toEqual(["unsupported-selector"]);
    const wrongBytes = createHtmlProtectionSearchNativeInput({ ...f.config, servedDocument: { ...f.config.servedDocument, physicalInput: { ...physicalInput, sha256: "f".repeat(64) } } });
    expect(observation(await wrongBytes.read(f.page, "#search")).gaps).toEqual(["physical-input-mismatch"]);
    const expired = createHtmlProtectionSearchNativeInput({ ...f.config, caseDeadline: Date.now() - 1 });
    expect(observation(await expired.read(f.page, "#search")).gaps).toEqual(["deadline-exceeded"]);
    const controller = new AbortController(); controller.abort();
    expect(observation(await createHtmlProtectionSearchNativeInput({ ...f.config, signal: controller.signal }).read(f.page, "#search")).gaps).toEqual(["aborted"]);
    expect(f.createSession).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
  });
  it.each(["text=Search", "css=#search >> nth=0", "", "x".repeat(501)])("rejects unsupported/unbounded selector %s", async selector => {
    const f = fake();
    if (selector.length < 1 || selector.length > 500) expect(() => createHtmlProtectionSearchNativeInput({ ...f.config, registeredCssSelector: selector })).toThrow();
    else expect(observation(await createHtmlProtectionSearchNativeInput({ ...f.config, registeredCssSelector: selector }).read(f.page, selector)).gaps).toEqual(["unsupported-selector"]);
    expect(f.createSession).not.toHaveBeenCalled();
  });
  it.each([
    { ...fields, value: "x".repeat(4097) }, { ...fields, pass: true }, { ...fields, value: 12 }, { matchCount: 1 },
  ])("does not accept page/producer-shaped malformed native material %#", async material => {
    const f = fake({ material }), actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search"));
    expect(actual.availability).toBe("unavailable"); expect(actual).not.toHaveProperty("input");
  });
  it.each([
    { matchCount: 1, scannedNodes: 20_001, shadowRoots: 0, readUtf8Bytes: 0 },
    { matchCount: 1, scannedNodes: 1, shadowRoots: 257, readUtf8Bytes: 0 },
    { matchCount: 1, scannedNodes: 1, shadowRoots: 0, readUtf8Bytes: 1_048_577 },
  ])("rejects native walk/body-budget overflow %#", async counters => {
    const f = fake({ counters }), actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search"));
    expect(actual.availability).toBe("unavailable");
    expect(f.calls.some(call => call.method === "DOM.requestNode")).toBe(false);
  });
  it("returns capability unavailable for unsupported CSS/protocol rather than a product PASS/FAIL", async () => {
    for (const options of [{ unsupportedCss: true }, { protocolUnavailable: true }]) {
      const f = fake(options), actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search"));
      expect(actual.availability).toBe("unavailable"); expect(actual).not.toHaveProperty("pass");
    }
  });
  it("owns cloned anchors even when caller metadata is mutated while session creation is pending", async () => {
    const f = fake();
    f.createSession.mockImplementation(async () => { f.config.servedDocument.physicalInput.sha256 = "f".repeat(64); return f.session; });
    const actual = observation(await createHtmlProtectionSearchNativeInput(f.config).read(f.page, "css=#search"));
    expect(actual.availability).toBe("available"); expect(actual.physicalInput.sha256).toBe(physicalInput.sha256);
  });
  it("rejects late session creation after deadline and detaches only that constructor-owned session", async () => {
    vi.useFakeTimers();
    const f = fake(); let release!: (value: typeof f.session) => void;
    f.createSession.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = createHtmlProtectionSearchNativeInput(f.config).read(f.page, "#search");
    await vi.advanceTimersByTimeAsync(5_001);
    expect(observation(await pending).gaps).toEqual(["deadline-exceeded"]);
    release(f.session); await vi.advanceTimersByTimeAsync(0);
    expect(f.detach).toHaveBeenCalledTimes(1); expect(f.calls).toEqual([]); expect(f.close).not.toHaveBeenCalled();
  });
  it("rejects late native facts after abort, leaves them unpublished and never reads a foreign Page", async () => {
    const f = fake(), controller = new AbortController();
    const original = f.session.send.bind(f.session); let release!: (value: unknown) => void;
    f.session.send = async (method, params) => {
      if (method === "Runtime.callFunctionOn" && params?.objectId) return await new Promise(resolve => { release = resolve; controller.abort(); });
      return await original(method, params);
    };
    const actual = observation(await createHtmlProtectionSearchNativeInput({ ...f.config, signal: controller.signal }).read(f.page, "#search"));
    expect(actual.gaps).toEqual(["aborted"]); release({ result: { type: "object", value: fields } });
    await Promise.resolve(); expect(actual).not.toHaveProperty("input");
    expect(f.createSession).toHaveBeenCalledExactlyOnceWith(f.page);
  });
  it("disposes only owned CDP sessions without closing Pages or offering arbitrary code/env/actions", async () => {
    const f = fake(), port = createHtmlProtectionSearchNativeInput(f.config); port.dispose();
    expect(observation(await port.read(f.page, "#search")).gaps).toEqual(["session-unavailable"]);
    expect(f.createSession).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
    for (const extra of [{ evaluate: "user code" }, { env: {} }, { url: "https://unexpected.invalid" }, { action: "fill" }]) {
      expect(() => createHtmlProtectionSearchNativeInput({ ...f.config, ...extra })).toThrow();
    }
  });
});

let browser: Browser, server: Server;
let source = Buffer.from("<!doctype html><html><body>synthetic</body></html>"), origin = "";
const contexts: BrowserContext[] = [];
const readers: ReturnType<typeof createHtmlProtectionSearchNativeInput>[] = [];
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/index.html") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": source.byteLength }); response.end(source);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Synthetic server unavailable");
  origin = "http://127.0.0.1:" + address.port;
  browser = await chromium.launch({ headless: true });
});
afterEach(async () => {
  for (const port of readers.splice(0)) port.dispose();
  for (const context of contexts.splice(0)) await context.close();
});
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
async function real(html: string, selector = "#search") {
  source = Buffer.from("<!doctype html><html><head><meta charset=utf-8></head><body>" + html + "</body></html>", "utf8");
  const physical = { sha256: hash(source), byteLength: source.byteLength };
  const context = await browser.newContext({ serviceWorkers: "block", permissions: [] }); contexts.push(context);
  const page = await context.newPage(), url = origin + "/index.html";
  const response = await page.goto(url);
  if (!response || hash(await response.body()) !== physical.sha256) throw Error("Synthetic response bytes mismatch");
  const seed = await context.newCDPSession(page);
  const frame = ((await seed.send("Page.getFrameTree")).frameTree.frame);
  await seed.detach();
  const reader = createHtmlProtectionSearchNativeInput({ page, expected: expected(frame.id, frame.loaderId, physical),
    servedDocument: { frameId: frame.id, loaderId: frame.loaderId, url, physicalInput: physical },
    registeredCssSelector: selector, caseDeadline: Date.now() + 45_000 });
  readers.push(reader);
  return { page, reader, read: async () => observation(await reader.read(page, selector)) };
}

describe("authored synthetic Chromium native search input", () => {
  it("reads real Unicode, type, disabled/readOnly and a stable native backend identity", async () => {
    const f = await real('<input type=search id=search value="完整原值😄">'), first = await f.read(), second = await f.read();
    expect(first.availability).toBe("available");
    expect(first.input).toMatchObject({ matchCount: 1, id: "search", tag: "INPUT", namespace: htmlNamespace,
      type: "search", value: "完整原值😄", disabled: false, readOnly: false });
    expect(first.input?.backendNodeId).toBeGreaterThan(0);
    expect(second.input?.backendNodeId).toBe(first.input?.backendNodeId);
  });
  it("reads underlying native facts despite main-world getter/prototype/console JSON spoofing", async () => {
    const f = await real('<input id=search type=search disabled readonly value="real">'
      + '<script>console.log(JSON.stringify({availability:"available",value:"forged"}));'
      + 'for(const [p,k,v] of [[Node.prototype,"nodeName","FAKE"],[Node.prototype,"nodeType",7],'
      + '[Element.prototype,"namespaceURI","fake"],[HTMLInputElement.prototype,"value","forged"],'
      + '[HTMLInputElement.prototype,"type","file"],[HTMLInputElement.prototype,"disabled",false],'
      + '[HTMLInputElement.prototype,"readOnly",false]])Object.defineProperty(p,k,{get(){return v},configurable:true});'
      + 'Element.prototype.getAttribute=()=> "forged";Document.prototype.querySelectorAll=()=>[];</script>');
    const actual = await f.read();
    expect(actual.availability).toBe("available");
    expect(actual.input).toMatchObject({ tag: "INPUT", id: "search", namespace: htmlNamespace, value: "real", type: "search", disabled: true, readOnly: true });
  });
  it("finds an open-Shadow input using fixed native CSS without selecting an extra duplicate", async () => {
    const f = await real('<div id=host></div><script>host.attachShadow({mode:"open"}).innerHTML=\'<input id="search" value="shadow">\';</script>');
    const actual = await f.read();
    expect(actual.availability).toBe("available"); expect(actual.input?.value).toBe("shadow"); expect(actual.input?.backendNodeId).toBeGreaterThan(0);
  });
  it.each([
    ['absent', "<p>No input</p>", 0],
    ['duplicate', '<input id=search><input id=search>', 2],
    ['open shadow duplicate', '<input id=search><div id=host></div><script>host.attachShadow({mode:"open"}).innerHTML=\'<input id="search">\';</script>', 2],
  ] as const)("retains %s count with every selected field null", async (_name, html, count) => {
    const actual = await (await real(html)).read();
    expect(actual.availability).toBe("available"); expect(actual.input?.matchCount).toBe(count);
    expect(Object.entries(actual.input!).every(([key, value]) => key === "matchCount" || value === null)).toBe(true);
  });
  it("reports actual non-input selected identity rather than pretending it is a supported INPUT", async () => {
    const actual = await (await real('<div id=search>Not an input</div>')).read();
    expect(actual.availability).toBe("available"); expect(actual.input).toMatchObject({ tag: "DIV", type: null, value: null, disabled: null, readOnly: null });
  });
  it("rejects native malformed CSS without a main-world/eval fallback", async () => {
    const actual = await (await real('<input id=search>', "#search[")).read();
    expect(actual.availability).toBe("unavailable"); expect(actual.gaps).toContain("unsupported-selector");
  });
  it("does not serialize an oversized dynamic native input value across CDP as selected facts", async () => {
    const actual = await (await real('<input id=search><script>search.value="x".repeat(4097)</script>')).read();
    expect(actual.availability).toBe("unavailable"); expect(actual).not.toHaveProperty("input");
  });
  it("rejects a known DOM node budget overflow before selecting or returning a body", async () => {
    const actual = await (await real('<input id=search><script>const f=document.createDocumentFragment();'
      + 'for(let i=0;i<20001;i++)f.append(document.createElement("i"));document.body.append(f)</script>')).read();
    expect(actual.availability).toBe("unavailable"); expect(actual).not.toHaveProperty("input");
  });
  it("refuses document replacement after the independently bound served receipt", async () => {
    const f = await real('<input id=search value="original">');
    await f.page.goto(origin + "/index.html?new-document");
    const actual = await f.read();
    expect(actual.availability).toBe("unavailable"); expect(actual.gaps).toContain("document-mismatch");
  });
});
