import { boundHtmlProtectionWholeNativeSession } from "./html-protection-whole-native-deadline";
import { createHash } from "node:crypto";
import { createServer, get, type Server } from "node:http";
import type { BrowserType, Browser, BrowserContext, Page } from "@playwright/test";
import { z } from "zod";
import { HTML_PROTECTION_CLOUD_URL as documentUrl, HTML_PROTECTION_CLOUD_CSP as csp, HTML_PROTECTION_CLOUD_LIMITS as limits } from "./vercel-sandbox-html-protection-cloud-protocol";

export class OwnedHtmlProtectionDocumentGap extends Error {
  readonly code: "served-material-mismatch" | "blocked-resource" | "observation-unavailable";
  constructor(code: OwnedHtmlProtectionDocumentGap["code"], readonly inspectorCause?: string) { super(code); this.code = code; }
}
export type HtmlProtectionOwnedDocument = {
  page: Page;
  context: BrowserContext;
  signal: AbortSignal;
  deadline: number;
  custody: {
    staged: { sha256: string; byteLength: number };
    nodeResponse: { sha256: string; byteLength: number };
    browserResponse: { sha256: string; byteLength: number };
    documentUrl: typeof documentUrl; status: 200; contentType: "text/html"; contentSecurityPolicy: typeof csp;
    fromServiceWorker: false; blockedRequests: number;
    navigation: { frameId: string; loaderId: string; requestId: string; responseUrl: typeof documentUrl };
  };
  assertCurrent(): Promise<void>;
  readCustody(): HtmlProtectionOwnedDocument["custody"] & { blockedRequests: number };
};
const Material = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(limits.htmlBytes) }).strict();
const Navigation = z.object({ type: z.literal("Document"), requestId: z.string().min(1), frameId: z.string().min(1), loaderId: z.string().min(1),
  response: z.object({ url: z.literal(documentUrl), status: z.literal(200) }) });
const Frame = z.object({ frameTree: z.object({ frame: z.object({ id: z.string(), loaderId: z.string(), url: z.string(), urlFragment: z.string().optional() }) }) });
const material = (bytes: Uint8Array) => ({ sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength });
const noFragment = (value: string) => { try { const url = new URL(value); url.hash = ""; return url.href; } catch { return null; } };
const nativeFrameUrl = (frame: { url: string; urlFragment?: string }) => { try { const url = new URL(frame.url); if (frame.urlFragment !== undefined) url.hash = frame.urlFragment; return url.href; } catch { return null; } };
async function boundedCleanup(task: () => Promise<unknown>, timeout = 5_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([Promise.resolve().then(task).catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, timeout); })]); }
  finally { if (timer) clearTimeout(timer); }
}
const same = (a: z.infer<typeof Material>, b: z.infer<typeof Material>) => a.sha256 === b.sha256 && a.byteLength === b.byteLength;
function trustedNodeResponse() {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const request = get(documentUrl, { agent: false, headers: { Connection: "close" } }, response => {
      if (response.statusCode !== 200 || response.headers["content-type"] !== "text/html" || response.headers["content-security-policy"] !== csp) {
        response.destroy(); reject(new OwnedHtmlProtectionDocumentGap("served-material-mismatch")); return;
      }
      response.on("data", (raw: Buffer) => {
        if (!Buffer.isBuffer(raw) || raw.byteLength > limits.htmlBytes - size) { response.destroy(); reject(new OwnedHtmlProtectionDocumentGap("served-material-mismatch")); return; }
        chunks.push(Buffer.from(raw)); size += raw.byteLength;
      });
      response.once("error", reject); response.once("end", () => resolve(Buffer.concat(chunks, size)));
    });
    request.setTimeout(5_000, () => request.destroy(new OwnedHtmlProtectionDocumentGap("served-material-mismatch")));
    request.once("error", reject);
  });
}

/** Repo-owned composition callback only; no HTTP/AI field selects a URL, browser or executable function. */
export async function withOwnedHtmlProtectionDocument<T>(args: {
  chromium: BrowserType<Browser>;
  physicalHtml: Uint8Array;
  expectedMaterial: { sha256: string; byteLength: number };
  consume: (owned: HtmlProtectionOwnedDocument) => Promise<T>;
  /** Composition-owned bounded long sequence; never forwarded from a Mission request. */
  runtimeDeadlineMs?: number;
  beforeOwnedNavigation?: (args: { page: Page; context: BrowserContext; signal: AbortSignal; deadline: number }) => Promise<void>;
}) {
  const expected = Material.parse(args.expectedMaterial);
  if (args.physicalHtml.byteLength > limits.htmlBytes) throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
  const html = Buffer.from(args.physicalHtml), staged = material(html);
  if (!same(staged, expected)) throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
  const launch = args.chromium.launch.bind(args.chromium), consume = args.consume;
  const runtimeDeadlineMs = args.runtimeDeadlineMs ?? limits.deadlineMs;
  if (!Number.isSafeInteger(runtimeDeadlineMs) || runtimeDeadlineMs < limits.deadlineMs || runtimeDeadlineMs > 600_000) throw new OwnedHtmlProtectionDocumentGap("observation-unavailable");
  const controller = new AbortController(), deadline = Date.now() + runtimeDeadlineMs;
  let server: Server | undefined, browser: Browser | undefined, closed = false;
  const active = () => { if (closed || controller.signal.aborted || Date.now() >= deadline) throw new OwnedHtmlProtectionDocumentGap("observation-unavailable"); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new OwnedHtmlProtectionDocumentGap("observation-unavailable")); }, runtimeDeadlineMs);
  });
  const operation = (async () => {
    server = createServer((request, response) => {
      if (request.method !== "GET" || request.url !== "/index.html") { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": "text/html", "Content-Length": html.byteLength, "Cache-Control": "no-store", "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" });
      response.end(html);
    });
    server.on("upgrade", (_request, socket) => { socket.destroy(); });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(4173, "127.0.0.1", resolve); }); active();
    const nodeBytes = await trustedNodeResponse(); active();
    if (!same(material(nodeBytes), expected)) throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
    active(); const created = await launch({ headless: true, timeout: Math.max(1, Math.min(20_000, deadline - Date.now())) });
    if (closed || controller.signal.aborted) { await boundedCleanup(() => created.close()); throw new OwnedHtmlProtectionDocumentGap("observation-unavailable"); }
    browser = created; active();
    const context = await browser.newContext({ serviceWorkers: "block", permissions: [], acceptDownloads: false }); active();
    const page = await context.newPage(); active(); const network = boundHtmlProtectionWholeNativeSession(await context.newCDPSession(page), deadline, controller.signal, code => new OwnedHtmlProtectionDocumentGap("observation-unavailable", code)); active();
    const documents: Array<z.infer<typeof Navigation>> = []; let blocked = 0, allowedNavigation = false, observerInvalid = false;
    let latestRoot: { id: string; loaderId: string; url: string } | undefined;
    // Continuous native transitions authenticate the live pin between independent initial/final readbacks; no observed DOM/CSS is cached.
    network.on("Page.frameNavigated", event => {
      const frame = z.object({ frame: z.object({ id: z.string(), loaderId: z.string(), url: z.string(), urlFragment: z.string().optional(), parentId: z.string().optional() }).passthrough() }).safeParse(event);
      if (!frame.success) observerInvalid = true; else if (!frame.data.frame.parentId) { const url = nativeFrameUrl(frame.data.frame); if (url === null) observerInvalid = true; else latestRoot = { ...frame.data.frame, url }; }
    });
    network.on("Page.navigatedWithinDocument", event => {
      const navigation = z.object({ frameId: z.string(), url: z.string() }).safeParse(event);
      if (!navigation.success) observerInvalid = true;
      else if (latestRoot?.id === navigation.data.frameId) latestRoot = { ...latestRoot, url: navigation.data.url };
    });
    for (const event of ["Inspector.detached", "Inspector.targetCrashed"] as const) network.on(event, () => { observerInvalid = true; });
    page.on("crash", () => { observerInvalid = true; }); page.on("close", () => { observerInvalid = true; });
    network.on("Network.responseReceived", event => { const parsed = Navigation.safeParse(event); if (parsed.success && documents.length < 2) documents.push(parsed.data); });
    // Chromium's native CSP audit covers refusal before a network request is created. Page console is never evidence.
    network.on("Audits.issueAdded", event => {
      const issue = z.object({ issue: z.object({ code: z.literal("ContentSecurityPolicyIssue"), details: z.object({
        contentSecurityPolicyIssueDetails: z.object({ isReportOnly: z.literal(false) }),
      }) }) }).safeParse(event);
      if (issue.success) blocked = Math.min(1_000_000, blocked + 1);
    });
    active(); await network.send("Page.enable"); active(); await network.send("Audits.enable"); active(); await network.send("Network.enable"); active(); await network.send("Network.setBypassServiceWorker", { bypass: true }); active(); await network.send("Network.setCacheDisabled", { cacheDisabled: true }); active();
    active(); await context.route("**/*", async route => {
      const request = route.request();
      if (!allowedNavigation && !controller.signal.aborted && request.url() === documentUrl && request.method() === "GET" && request.isNavigationRequest()
        && request.resourceType() === "document" && request.frame() === page.mainFrame()) { allowedNavigation = true; await route.continue(); return; }
      blocked++; await route.abort("blockedbyclient");
    });
    active(); await page.routeWebSocket("**/*", socket => { blocked++; socket.close(); }); active();
    context.on("page", popup => { if (popup !== page) { blocked++; void popup.close().catch(() => {}); } });
    if (args.beforeOwnedNavigation) { await args.beforeOwnedNavigation({ page, context, signal: controller.signal, deadline }); active(); }
    active(); const response = await page.goto(documentUrl, { waitUntil: "domcontentloaded", timeout: Math.max(1, Math.min(20_000, deadline - Date.now())) }); active();
    if (!response || response.status() !== 200 || response.url() !== documentUrl || response.frame() !== page.mainFrame() || !response.request().isNavigationRequest()
      || response.fromServiceWorker() || (await response.headerValue("content-type")) !== "text/html" || (await response.headerValue("content-security-policy")) !== csp) {
      throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
    }
    const browserBytes = await response.body(); active();
    if (!same(material(browserBytes), expected)) throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
    const navigation = documents[0];
    if (documents.length !== 1 || !navigation) throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
    const verifyCurrentFrame = async () => {
      active(); const frame = Frame.parse(await network.send("Page.getFrameTree")).frameTree.frame; active(); const url = nativeFrameUrl(frame);
      if (url === null || (latestRoot && (latestRoot.id !== frame.id || latestRoot.loaderId !== frame.loaderId || latestRoot.url !== url))) throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
      latestRoot = { ...frame, url };
    };
    const assertCurrent = async () => {
      active(); const frame = latestRoot;
      if (observerInvalid || !frame || documents.length !== 1 || page.isClosed() || frame.id !== navigation.frameId || frame.loaderId !== navigation.loaderId || noFragment(frame.url) !== documentUrl) {
        throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
      }
      if (blocked) throw new OwnedHtmlProtectionDocumentGap("blocked-resource");
    };
    await verifyCurrentFrame(); await assertCurrent();
    const readCustody = (): HtmlProtectionOwnedDocument["custody"] => ({ staged: { ...staged }, nodeResponse: material(nodeBytes), browserResponse: material(browserBytes),
      documentUrl, status: 200, contentType: "text/html", contentSecurityPolicy: csp, fromServiceWorker: false, blockedRequests: blocked,
      navigation: { frameId: navigation.frameId, loaderId: navigation.loaderId, requestId: navigation.requestId, responseUrl: documentUrl } });
    const value = await consume({ page, context, signal: controller.signal, deadline, custody: readCustody(), readCustody, assertCurrent });
    await verifyCurrentFrame(); await assertCurrent(); return value;
  })();
  try { return await Promise.race([operation, interrupted]); }
  finally {
    closed = true; controller.abort(); if (timer) clearTimeout(timer);
    if (browser) await boundedCleanup(() => browser!.close());
    if (server) { server.closeAllConnections(); await boundedCleanup(() => new Promise<void>(resolve => server!.close(() => resolve())), 2_000); }
  }
}
