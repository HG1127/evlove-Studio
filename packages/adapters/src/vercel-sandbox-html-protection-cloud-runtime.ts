import { constants } from "node:fs";
import { open, mkdir, rename } from "node:fs/promises";
import { createServer, get, type Server } from "node:http";
import { join, dirname } from "node:path";
import type { BrowserType, Browser } from "@playwright/test";
import { z } from "zod";
import { collectVercelSandboxHtmlProtectionSnapshot, type HtmlProtectionSnapshotCdpPort } from "./vercel-sandbox-html-protection-snapshot";
import {
  HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_URL as documentUrl,
  HTML_PROTECTION_CLOUD_LIMITS as limits, HTML_PROTECTION_CLOUD_CSP as csp,
  HtmlProtectionCloudInputSchema, HtmlProtectionCloudObservationSchema, HtmlProtectionCloudManifestSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
  type HtmlProtectionCloudInput, type HtmlProtectionCloudObservation,
} from "./vercel-sandbox-html-protection-cloud-protocol";

class MaterialGap extends Error {
  readonly code: "staged-material-mismatch" | "served-material-mismatch" | "blocked-resource" | "runtime-integrity";
  constructor(code: MaterialGap["code"]) { super(code); this.code = code; }
}
/** Fixed file read; no user path or symlink target is accepted. */
async function boundedPhysicalFile(path: string, maximum: number) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.size <= 0 || before.size > maximum) throw new MaterialGap("runtime-integrity");
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await fd.read(bytes, offset, bytes.byteLength - offset, offset);
      if (!result.bytesRead) throw new MaterialGap("runtime-integrity"); offset += result.bytesRead;
    }
    const after = await fd.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new MaterialGap("runtime-integrity");
    return bytes;
  } finally { await fd.close(); }
}
async function atomicPrivateFile(path: string, bytes: Uint8Array) {
  const temporary = path + ".tmp", fd = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  await rename(temporary, path);
}
function trustedNodeResponse() {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    const request = get(documentUrl, response => {
      if (response.statusCode !== 200 || response.headers["content-type"] !== "text/html"
        || response.headers["content-security-policy"] !== csp) { response.destroy(); reject(new MaterialGap("served-material-mismatch")); return; }
      response.on("data", (raw: Buffer) => {
        if (!Buffer.isBuffer(raw) || raw.byteLength > limits.htmlBytes - size) { response.destroy(); reject(new MaterialGap("served-material-mismatch")); return; }
        const chunk = Buffer.from(raw); chunks.push(chunk); size += chunk.byteLength;
      });
      response.once("error", reject);
      response.once("end", () => resolve(Buffer.concat(chunks, size)));
    });
    request.setTimeout(5_000, () => request.destroy(new MaterialGap("served-material-mismatch")));
    request.once("error", reject);
  });
}
const NavigationSchema = z.object({
  type: z.literal("Document"), requestId: z.string().min(1), frameId: z.string().min(1), loaderId: z.string().min(1),
  response: z.object({ url: z.literal(documentUrl), status: z.literal(200) }),
});
const FrameSchema = z.object({ frameTree: z.object({ frame: z.object({
  id: z.string(), loaderId: z.string(), url: z.string(),
}) }) });
function material(bytes: Uint8Array) { return { sha256: sha(bytes), byteLength: bytes.byteLength }; }
function sameMaterial(actual: ReturnType<typeof material>, expected: ReturnType<typeof material>) {
  return actual.sha256 === expected.sha256 && actual.byteLength === expected.byteLength;
}
async function observeOwnedRuntime(chromium: BrowserType<Browser>, input: HtmlProtectionCloudInput, html: Buffer) {
  let server: Server | undefined, browser: Browser | undefined;
  try {
    // Immutable exact bytes are the only public resource. No filesystem router exists.
    server = createServer((request, response) => {
      if (request.method !== "GET" || request.url !== "/index.html") { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": "text/html", "Content-Length": html.byteLength,
        "Cache-Control": "no-store", "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" });
      response.end(html);
    });
    server.on("upgrade", (_request, socket) => { socket.destroy(); });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject); server!.listen(4173, "127.0.0.1", resolve);
    });
    const nodeBytes = await trustedNodeResponse();
    if (!sameMaterial(material(nodeBytes), input.material)) throw new MaterialGap("served-material-mismatch");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", permissions: [], acceptDownloads: false });
    const page = await context.newPage(), network = await context.newCDPSession(page);
    const documentResponses: Array<z.infer<typeof NavigationSchema>> = [];
    let blocked = 0, allowedNavigation = false;
    network.on("Network.responseReceived", event => {
      const parsed = NavigationSchema.safeParse(event);
      if (parsed.success && documentResponses.length < 2) documentResponses.push(parsed.data);
    });
    await network.send("Network.enable");
    await network.send("Network.setBypassServiceWorker", { bypass: true });
    await network.send("Network.setCacheDisabled", { cacheDisabled: true });
    await context.route("**/*", async route => {
      const request = route.request();
      if (!allowedNavigation && request.url() === documentUrl && request.method() === "GET"
        && request.isNavigationRequest() && request.resourceType() === "document" && request.frame() === page.mainFrame()) {
        allowedNavigation = true; await route.continue(); return;
      }
      blocked++; await route.abort("blockedbyclient");
    });
    await page.routeWebSocket("**/*", socket => { blocked++; socket.close(); });
    context.on("page", popup => { if (popup !== page) { blocked++; void popup.close().catch(() => {}); } });
    const response = await page.goto(documentUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!response || response.status() !== 200 || response.url() !== documentUrl || response.frame() !== page.mainFrame()
      || !response.request().isNavigationRequest() || response.fromServiceWorker()
      || (await response.headerValue("content-type")) !== "text/html" || (await response.headerValue("content-security-policy")) !== csp) throw new MaterialGap("served-material-mismatch");
    const browserBytes = await response.body();
    if (!sameMaterial(material(browserBytes), input.material)) throw new MaterialGap("served-material-mismatch");
    const frame = FrameSchema.parse(await network.send("Page.getFrameTree")).frameTree.frame;
    const navigation = documentResponses[0];
    if (documentResponses.length !== 1 || !navigation || navigation.frameId !== frame.id || navigation.loaderId !== frame.loaderId || frame.url !== documentUrl) throw new MaterialGap("served-material-mismatch");
    const snapshot = await collectVercelSandboxHtmlProtectionSnapshot({
      request: input.request, physicalHtml: html,
      createSession: async () => await context.newCDPSession(page) as unknown as HtmlProtectionSnapshotCdpPort,
    });
    if (snapshot.realm && (snapshot.realm.frameId !== navigation.frameId || snapshot.realm.loaderId !== navigation.loaderId)) throw new MaterialGap("served-material-mismatch");
    if (blocked) throw new MaterialGap("blocked-resource");
    return HtmlProtectionCloudObservationSchema.parse({
      schemaVersion: "html-protection-private-observation-v1", nonce: input.nonce,
      request: input.request, ownedRuntime: input.ownedRuntime, availability: "available",
      custody: { staged: material(html), nodeResponse: material(nodeBytes), browserResponse: material(browserBytes),
        documentUrl, status: 200, contentType: "text/html", contentSecurityPolicy: csp,
        fromServiceWorker: false, blockedRequests: 0,
        navigation: { frameId: navigation.frameId, loaderId: navigation.loaderId, requestId: navigation.requestId, responseUrl: documentUrl } },
      snapshot,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  }
}
/**
 * Build this owned entry together with the existing snapshot primitive into a fixed ESM
 * bundle in the trusted deployment pipeline. Never run user HTML here on the host.
 * chromium/workingDirectory are supplied only by the fixed Sandbox loader, not requests.
 * No console/page output is observed, and this function makes no whole-protection verdict.
 */
async function executePrivateRuntime(args: { chromium: BrowserType<Browser>; workingDirectory: string }) {
  const privateRoot = join(args.workingDirectory, dirname(paths.input));
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const input = HtmlProtectionCloudInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await boundedPhysicalFile(join(args.workingDirectory, paths.input), limits.inputBytes))));
  const runtime = await boundedPhysicalFile(join(args.workingDirectory, paths.bundle), limits.runtimeBytes);
  const runner = await boundedPhysicalFile(join(args.workingDirectory, paths.runner), limits.inputBytes);
  let observation: HtmlProtectionCloudObservation;
  try {
    if (!sameMaterial(material(runtime), input.ownedRuntime)) throw new MaterialGap("runtime-integrity");
    const html = await boundedPhysicalFile(join(args.workingDirectory, paths.html), limits.htmlBytes);
    if (!sameMaterial(material(html), input.material)) throw new MaterialGap("staged-material-mismatch");
    observation = await observeOwnedRuntime(args.chromium, input, html);
  } catch (error) {
    observation = HtmlProtectionCloudObservationSchema.parse({
      schemaVersion: "html-protection-private-observation-v1", nonce: input.nonce, request: input.request, ownedRuntime: input.ownedRuntime,
      availability: "unavailable", reason: error instanceof MaterialGap ? error.code : "observation-unavailable",
    });
  }
  const bytes = Buffer.from(canonical(observation), "utf8");
  if (bytes.byteLength > limits.resultBytes) throw new Error("Private result limit exceeded");
  await atomicPrivateFile(join(args.workingDirectory, paths.result), bytes);
  const manifest = HtmlProtectionCloudManifestSchema.parse({
    schemaVersion: "html-protection-private-manifest-v1", nonce: input.nonce, requestSha256: sha(canonical(input.request)),
    ownedRuntimeSha256: sha(runtime), runnerSha256: sha(runner),
    result: { path: paths.result, sha256: sha(bytes), byteLength: bytes.byteLength },
  });
  await atomicPrivateFile(join(args.workingDirectory, paths.manifest), Buffer.from(canonical(manifest), "utf8"));
}

export async function runPrivateHtmlProtectionCloudRuntime(args: { chromium: BrowserType<Browser>; workingDirectory: string }) {
  try { await executePrivateRuntime(args); } catch { throw new Error("Private observation runtime unavailable"); }
}
