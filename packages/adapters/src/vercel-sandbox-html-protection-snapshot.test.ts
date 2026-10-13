// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import {
  HtmlProtectionSnapshotRequestSchema, HTML_PROTECTION_SNAPSHOT_LIMITS,
  type HtmlProtectionSnapshotRequest, type HtmlProtectionSnapshotBody,
} from "@evolution/contracts";
import {
  collectVercelSandboxHtmlProtectionSnapshot, htmlProtectionSnapshotRegistrySha256,
  type HtmlProtectionSnapshotCdpPort,
} from "./vercel-sandbox-html-protection-snapshot";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const bytes = new TextEncoder().encode("<article id='card'>完整尾部😄</article>");
function request(projection: "boot-subtree-v1" | "search-membership-v1" | "copy-material-v1" = "boot-subtree-v1", physical = bytes): HtmlProtectionSnapshotRequest {
  const sha256 = hash(physical), artifact = { sourceArtifactId: "source", sha256, byteLength: physical.byteLength };
  const registry = projection === "search-membership-v1"
    ? { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: sha256, projection,
      targetId: "search", cardSelector: ".card", chapterSelector: ".chapter", inputSelector: "#search", countSelector: "#count" }
    : { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: sha256, projection,
      targets: [{ targetId: "card", selector: "#card" }] };
  return HtmlProtectionSnapshotRequestSchema.parse({
    schemaVersion: "html-protection-snapshot-request-v1", sourceRole: "executed", documentUrl: "about:blank",
    binding: { missionId: "mission", testCaseId: "frozen-test", criterionId: "PROTECT-ALL", paperSha256: "a".repeat(64),
      original: artifact, executed: artifact, subject: { kind: "current", versionId: "v1" } },
    policyVersion: "profile-v1", planSha256: "b".repeat(64), registrySha256: htmlProtectionSnapshotRegistrySha256(registry), registry,
    execution: { executionId: "execution", jobId: "job", generation: 1 }, stateId: "boot", batchId: "batch",
  });
}
const emptyMirror = { nodeId: 1, backendNodeId: 1, nodeType: 9, nodeName: "#document", nodeValue: "", children: [] };
function mirrorIds(value: unknown) {
  let next = 0;
  const prepare = (input: unknown): unknown => {
    const node = input as Record<string, unknown>, id = ++next;
    const children = ((node.children ?? []) as unknown[]).map(prepare);
    return { ...node, nodeId: node.nodeId ?? id, backendNodeId: node.backendNodeId ?? id,
      ...([1, 9, 11].includes(node.nodeType as number) ? { childNodeCount: node.childNodeCount ?? children.length } : {}),
      children, ...(node.shadowRoots ? { shadowRoots: (node.shadowRoots as unknown[]).map(prepare) } : {}),
      ...(node.templateContent ? { templateContent: prepare(node.templateContent) } : {}) };
  };
  return prepare(value);
}
function body(): HtmlProtectionSnapshotBody {
  return { projection: "boot-subtree-v1", targets: [{ targetId: "card", matchCount: 1, nodes: [
    { index: 0, parent: null, edge: "root", type: 1, name: "ARTICLE", namespace: "http://www.w3.org/1999/xhtml",
      value: null, attributes: [], assignedIndexes: [], assignedOutsideTarget: 0 },
    { index: 1, parent: 0, edge: "light", type: 3, name: "#text", namespace: null,
      value: "完整尾部😄", attributes: [], assignedIndexes: [], assignedOutsideTarget: 0 },
  ] }], counters: { scannedNodes: 8, collectedNodes: 2, shadowRoots: 0, textUtf8Bytes: 0 }, gaps: [] };
}
function fakePort(options: {
  material?: unknown; mirror?: unknown; defaultRealm?: boolean; wrongFrame?: boolean;
  navigation?: boolean; noRealmEvent?: boolean; unavailable?: boolean;
  mutationEvents?: readonly string[]; postMirror?: unknown; noDomEvents?: boolean;
} = {}) {
  const callbacks = new Map<string, (event: unknown) => void>();
  let frameReads = 0, detached = 0, observations = 0;
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const port: HtmlProtectionSnapshotCdpPort = {
    on(event, cb) { callbacks.set(event, cb); },
    async send(method, params) {
      calls.push({ method, params });
      if (options.unavailable) throw new Error("CDP unavailable");
      if (method === "Runtime.enable" || method === "DOM.requestChildNodes") return {};
      if (method === "DOM.enable") { if (options.noDomEvents) throw new Error("DOM monitoring unavailable"); return {}; }
      if (method === "Page.getFrameTree") {
        frameReads++;
        return { frameTree: { frame: { id: "frame", loaderId: options.navigation && frameReads > 1 ? "new-loader" : "loader", url: "about:blank" } } };
      }
      if (method === "DOM.getDocument") return { root: mirrorIds(options.mirror ?? emptyMirror) };
      if (method === "DOM.describeNode") return { node: mirrorIds(options.postMirror ?? options.mirror ?? emptyMirror) };
      if (method === "Page.createIsolatedWorld") {
        if (!options.noRealmEvent) callbacks.get("Runtime.executionContextCreated")?.({ context: { id: 41, uniqueId: "independent-realm", name: params?.worldName,
          auxData: { frameId: options.wrongFrame ? "foreign" : "frame", type: "isolated", isDefault: options.defaultRealm ?? false } } });
        return { executionContextId: 41 };
      }
      if (method === "Runtime.callFunctionOn") {
        if (++observations === 2) for (const event of options.mutationEvents ?? []) callbacks.get(event)?.({});
        return { result: { type: "object", value: options.material ?? body() } };
      }
      throw new Error("Unexpected method");
    },
    async detach() { detached++; },
  };
  return { port, calls, detached: () => detached };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") { const encoded = JSON.stringify(value); if (encoded === undefined) throw Error("Non-JSON fixture"); return encoded; }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
}
afterEach(() => { vi.useRealTimers(); });

describe("native snapshot controller with synthetic CDP", () => {
  it("computes exact full body UTF-8/hash in Node and binds an event-proven unique realm", async () => {
    const fake = fakePort(), result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(true);
    expect(result.bodySha256).toBe(hash(canonical(result.body)));
    expect(result.bodyUtf8Bytes).toBe(Buffer.byteLength(canonical(result.body), "utf8"));
    expect(result.body?.counters.textUtf8Bytes).toBe(Buffer.byteLength("完整尾部😄", "utf8"));
    const call = fake.calls.find(item => item.method === "Runtime.callFunctionOn")!;
    expect(call.params?.uniqueContextId).toBe("independent-realm"); expect(call.params).not.toHaveProperty("executionContextId");
    expect(fake.calls.find(item => item.method === "Page.createIsolatedWorld")?.params?.grantUniveralAccess).toBe(false);
    expect(fake.detached()).toBe(1);
  });
  it.each([{ defaultRealm: true }, { wrongFrame: true }, { noRealmEvent: true }, { unavailable: true }, { noDomEvents: true }])("never falls back to page/main-world observations: %j", async options => {
    const fake = fakePort(options), result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.availability).toBe("unavailable"); expect(result.projectionComplete).toBe(false);
    expect(fake.calls.some(call => call.method === "Runtime.evaluate")).toBe(false);
  });
  it("does not launch a browser protocol for wrong physical input/registry or undefined copy material", async () => {
    const createSession = vi.fn(async () => fakePort().port);
    const mismatch = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: new Uint8Array(), createSession });
    expect(mismatch.gaps[0]?.code).toBe("physical-input-mismatch");
    const badRegistry = await collectVercelSandboxHtmlProtectionSnapshot({ request: { ...request(), registrySha256: "0".repeat(64) }, physicalHtml: bytes, createSession });
    expect(badRegistry.availability).toBe("unavailable");
    const copy = await collectVercelSandboxHtmlProtectionSnapshot({ request: request("copy-material-v1"), physicalHtml: bytes, createSession });
    expect(copy.gaps[0]?.code).toBe("copy-material-undefined"); expect(createSession).not.toHaveBeenCalled();
  });
  it("retains missing/duplicate target observations without claiming complete", async () => {
    for (const matchCount of [0, 2]) {
      const material = body(); if (material.projection !== "boot-subtree-v1") throw Error("fixture");
      material.targets[0]!.matchCount = matchCount; material.targets[0]!.nodes = []; material.counters.collectedNodes = 0;
      const fake = fakePort({ material }), result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
      expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(false);
      expect(result.gaps[0]?.code).toBe(matchCount ? "ambiguous-target" : "missing-target");
    }
  });
  it("rejects producer hash/extra claims, omitted target, incomplete counters and broken slot references", async () => {
    const good = body();
    const malformed = [
      { ...good, digest: "a".repeat(64) },
      { ...good, targets: [] },
      { ...good, counters: { ...good.counters, collectedNodes: 0 } },
      { ...good, targets: [{ targetId: "card", matchCount: 1, nodes: [] }] },
    ];
    for (const material of malformed) {
      const fake = fakePort({ material }), result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
      expect(result.availability).toBe("unavailable"); expect(result).not.toHaveProperty("bodySha256");
    }
  });
  it.each(["closed", "iframe", "object", "embed"])("reports unsupported native boundary %s", async kind => {
    const boundary = kind === "closed" ? { nodeType: 11, nodeName: "#document-fragment", nodeValue: "", shadowRootType: "closed" }
      : { nodeType: 1, nodeName: kind.toUpperCase(), nodeValue: "" };
    const fake = fakePort({ mirror: { ...emptyMirror, children: [boundary] } });
    const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(false);
    expect(result.gaps.map(gap => gap.code)).toContain(kind === "closed" ? "closed-shadow-root" : kind);
  });
  it("rejects post-observation document replacement", async () => {
    const fake = fakePort({ navigation: true }), result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.gaps[0]?.code).toBe("unstable-document"); expect(result).not.toHaveProperty("body");
  });
  it.each([
    "DOM.shadowRootPushed", "DOM.shadowRootPopped", "DOM.childNodeInserted", "DOM.childNodeRemoved",
    "DOM.attributeModified", "DOM.attributeRemoved", "DOM.characterDataModified", "DOM.documentUpdated",
    "DOM.distributedNodesUpdated", "DOM.inlineStyleInvalidated", "DOM.childNodeCountUpdated",
  ])("rejects native %s in the window even when both mirror endpoints match", async event => {
    const fake = fakePort({ mutationEvents: [event] });
    const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.availability).toBe("unavailable"); expect(result.gaps[0]?.code).toBe("unstable-dom");
    expect(result).not.toHaveProperty("body"); expect(result).not.toHaveProperty("stability");
  });
  it("never clears transient native insertion/removal generations using endpoint equality", async () => {
    const fake = fakePort({ mutationEvents: ["DOM.childNodeInserted", "DOM.shadowRootPushed", "DOM.childNodeRemoved"] });
    const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.gaps[0]?.code).toBe("unstable-dom"); expect(result).not.toHaveProperty("bodySha256");
  });
  it("rejects a changed backend identity or tree even without a delivered native event", async () => {
    for (const postMirror of [{ ...emptyMirror, backendNodeId: 42 }, { ...emptyMirror, nodeValue: "changed" }]) {
      const fake = fakePort({ postMirror });
      const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
      expect(result.gaps[0]?.code).toBe("unstable-dom"); expect(result.projectionComplete).toBe(false);
    }
  });
  it("uses only bounded shallow native requests and records the stable-window identity", async () => {
    const fake = fakePort();
    const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.stability?.mutationEvents).toBe(0); expect(result.stability?.preMirrorSha256).toBe(result.stability?.postMirrorSha256);
    expect(fake.calls.find(item => item.method === "DOM.enable")?.params?.includeWhitespace).toBe("all");
    const reads = fake.calls.filter(item => ["DOM.getDocument", "DOM.describeNode", "DOM.requestChildNodes"].includes(item.method));
    expect(reads.every(item => item.params?.depth === 0 || item.params?.depth === 1)).toBe(true);
    expect(reads.every(item => item.params?.pierce === false)).toBe(true);
  });
  it("refuses unproven inert template mutation coverage", async () => {
    const fake = fakePort({ mirror: { ...emptyMirror, templateContent: { nodeType: 11, nodeName: "#document-fragment", nodeValue: "" } } });
    const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.gaps[0]?.code).toBe("template-mutation-unavailable"); expect(result).not.toHaveProperty("body");
  });
  it("rejects oversized shallow protocol text without hashing a partial body", async () => {
    const fake = fakePort({ mirror: { ...emptyMirror, nodeValue: "x".repeat(HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes + 1) } });
    const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.gaps[0]?.code).toBe("limit-exceeded"); expect(result).not.toHaveProperty("bodySha256");
  });
  it("does not hash truncated material when the fixed observer reaches its budget", async () => {
    const fake = fakePort({ material: { capabilityGap: "limit-exceeded" } });
    const result = await collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession: async () => fake.port });
    expect(result.gaps[0]?.code).toBe("limit-exceeded"); expect(result).not.toHaveProperty("bodySha256");
  });
  it("detaches a late session after the original deadline without a retry", async () => {
    vi.useFakeTimers();
    const fake = fakePort(); let resolve!: (value: HtmlProtectionSnapshotCdpPort) => void;
    const createSession = vi.fn(() => new Promise<HtmlProtectionSnapshotCdpPort>(done => { resolve = done; }));
    const pending = collectVercelSandboxHtmlProtectionSnapshot({ request: request(), physicalHtml: bytes, createSession });
    await vi.advanceTimersByTimeAsync(HTML_PROTECTION_SNAPSHOT_LIMITS.timeoutMs);
    expect((await pending).availability).toBe("unavailable");
    resolve(fake.port); await Promise.resolve(); await Promise.resolve();
    expect(fake.detached()).toBe(1); expect(createSession).toHaveBeenCalledTimes(1);
  });
});

describe("actual isolated DOM snapshots over synthetic Chromium HTML", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, args: process.env.RUNNER_BROWSER_CI_NO_SANDBOX === "1" ? ["--no-sandbox"] : [] });
  }, 30_000);
  afterAll(async () => { await browser?.close(); });
  async function collect(html: string, projection: "boot-subtree-v1" | "search-membership-v1" = "boot-subtree-v1", tweak?: (value: HtmlProtectionSnapshotRequest) => void, interleave?: (page: Page) => Promise<void>) {
    const physical = new TextEncoder().encode(html), context = await browser.newContext(), page = await context.newPage();
    try {
      const documentUrl = "http://synthetic-snapshot.invalid/";
      await page.route(documentUrl, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: Buffer.from(physical) }));
      await page.goto(documentUrl, { waitUntil: "domcontentloaded" });
      const value = request(projection, physical); value.documentUrl = documentUrl; tweak?.(value);
      value.registrySha256 = htmlProtectionSnapshotRegistrySha256(value.registry);
      return await collectVercelSandboxHtmlProtectionSnapshot({
        request: value, physicalHtml: physical,
        createSession: async () => {
          const port = await context.newCDPSession(page) as unknown as HtmlProtectionSnapshotCdpPort;
          let observations = 0;
          return {
            on: (event, callback) => port.on(event, callback),
            send: async (method, params) => {
              if (method === "Runtime.callFunctionOn" && ++observations === 2) await interleave?.(page);
              return port.send(method, params);
            },
            detach: () => port.detach(),
          };
        },
      });
    } finally { await context.close(); }
  }
  it("captures complete real Unicode text and ordered attributes", async () => {
    const result = await collect('<article id="card" data-value="真实"><p>首段</p><p>完整尾部😄</p></article>');
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(true);
    const material = result.body; if (material?.projection !== "boot-subtree-v1") throw Error("missing boot body");
    const nodes = material.targets[0]!.nodes;
    expect(nodes.map(node => node.value ?? "").join("")).toBe("首段完整尾部😄");
    expect(nodes[0]!.attributes).toContainEqual({ name: "data-value", namespace: null, value: "真实" });
  });
  it("ignores poisoned main-world DOM prototypes and page-generated fake JSON", async () => {
    const result = await collect(`<article id="card"><p>真实完整内容</p></article><script>
      window.__snapshot={complete:true,text:"伪造"};
      Document.prototype.querySelectorAll=()=>[];
      Element.prototype.getAttribute=()=>"伪造";
      Object.defineProperty(Node.prototype,"nodeValue",{get(){return "伪造"}});
      Object.defineProperty(Node.prototype,"textContent",{get(){return "伪造"}});
      window.getComputedStyle=()=>({display:"none"});
      JSON.stringify=()=>'"伪造"';
    </script>`);
    expect(result.availability).toBe("available");
    if (result.body?.projection !== "boot-subtree-v1") throw Error("missing boot body");
    expect(result.body.targets[0]!.nodes.map(node => node.value ?? "").join("")).toBe("真实完整内容");
  });
  it("records open Shadow and slot edges without duplicating assigned text", async () => {
    const result = await collect(`<article id="card"><span slot="main" id="assigned">唯一文本</span></article><script>
      document.getElementById("card").attachShadow({mode:"open"}).innerHTML='<div><slot name="main"></slot></div>';
    </script>`);
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(true);
    if (result.body?.projection !== "boot-subtree-v1") throw Error("missing boot body");
    const nodes = result.body.targets[0]!.nodes, slot = nodes.find(node => node.name === "SLOT")!;
    expect(nodes.some(node => node.edge === "shadow")).toBe(true);
    expect(slot.assignedIndexes).toHaveLength(1); expect(slot.assignedOutsideTarget).toBe(0);
    expect(nodes[slot.assignedIndexes[0]!]!.name).toBe("SPAN");
    expect(nodes.filter(node => node.value === "唯一文本")).toHaveLength(1);
  });
  it("observes all search IDs including hidden members, with actual input and chapter ancestry", async () => {
    const result = await collect('<style>.hidden{display:none}</style><input id="search" value="q"><b id="count">1/2</b><section class="chapter" id="chapter"><article class="card" id="one">A</article><article class="card hidden" id="two">B</article></section>', "search-membership-v1");
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(true);
    if (result.body?.projection !== "search-membership-v1") throw Error("missing membership body");
    expect(result.body.cards.map(card => card.id)).toEqual(["one", "two"]);
    expect(result.body.cards.map(card => card.ancestorDisplayNone)).toEqual([false, true]);
    expect(result.body.cards.map(card => card.chapterId)).toEqual(["chapter", "chapter"]);
    expect(result.body.input.value).toBe("q"); expect(result.body.count.text).toBe("1/2");
  });
  it("does not choose one duplicate ID or conceal missing targets", async () => {
    for (const html of ['<div id="other"></div>', '<article id="card"></article><article id="card"></article>']) {
      const result = await collect(html); expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(false);
    }
  });
  it("keeps duplicate membership and wrong input type as explicit gaps", async () => {
    const result = await collect('<div id="search"></div><b id="count">2</b><section class="chapter" id="chapter"><div class="card" id="same"></div><div class="card" id="same"></div></section>', "search-membership-v1");
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(false);
    expect(result.gaps.map(gap => gap.code)).toContain("missing-or-duplicate-id");
    expect(result.gaps.map(gap => gap.code)).toContain("unsupported-input");
  });
  it("reports real closed Shadow content as unsupported", async () => {
    const result = await collect('<article id="card">公开</article><script>document.getElementById("card").attachShadow({mode:"closed"}).innerHTML="<p>闭合</p>"</script>');
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(false);
    expect(result.gaps.map(gap => gap.code)).toContain("closed-shadow-root");
  });
  it.each(["iframe", "object", "embed"])("does not claim embedded %s content", async tag => {
    const result = await collect('<article id="card">公开<' + tag + '></' + tag + '></article>');
    expect(result.availability).toBe("available"); expect(result.projectionComplete).toBe(false);
    expect(result.gaps.map(gap => gap.code)).toContain(tag);
  });
  it("rejects a timer attaching a closed root after the pre-mirror and before the native observation", async () => {
    const result = await collect('<article id="card">public</article>', "boot-subtree-v1", undefined, async page => {
      await page.evaluate(() => new Promise<void>(resolve => setTimeout(() => {
        document.getElementById("card")!.attachShadow({ mode: "closed" }).innerHTML = "<p>private</p>";
        resolve();
      }, 0)));
    });
    expect(result.availability).toBe("unavailable"); expect(result.gaps[0]?.code).toBe("unstable-dom");
    expect(result).not.toHaveProperty("bodySha256");
  });
  it("rejects a transient closed host inserted and removed in one timer while both endpoint trees are identical", async () => {
    const result = await collect('<article id="card">public</article>', "boot-subtree-v1", undefined, async page => {
      await page.evaluate(() => new Promise<void>(resolve => setTimeout(() => {
        const host = document.createElement("div"); document.getElementById("card")!.appendChild(host);
        host.attachShadow({ mode: "closed" }).innerHTML = "<p>private</p>"; host.remove(); resolve();
      }, 0)));
    });
    expect(result.availability).toBe("unavailable"); expect(result.gaps[0]?.code).toBe("unstable-dom");
    expect(result).not.toHaveProperty("body");
  });
  it("keeps inert template instrumentation unavailable, including hidden closed hosts", async () => {
    const result = await collect('<article id="card"><template><div id="inert"></div></template></article><script>document.querySelector("template").content.querySelector("#inert").attachShadow({mode:"closed"}).innerHTML="<p>private</p>"</script>');
    expect(result.availability).toBe("unavailable"); expect(result.gaps[0]?.code).toBe("template-mutation-unavailable");
  });
  it("bounds native text before UTF-8 encoding and does not request a full CDP tree", async () => {
    const result = await collect('<article id="card">' + "x".repeat(HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes + 1) + "</article>");
    expect(result.availability).toBe("unavailable"); expect(result.gaps[0]?.code).toBe("limit-exceeded");
  });
  it("returns unavailable for unsupported native selector syntax", async () => {
    const result = await collect('<article id="card">公开</article>', "boot-subtree-v1", value => {
      if (value.registry.projection === "boot-subtree-v1") value.registry.targets[0]!.selector = "text=公开";
    });
    expect(result.availability).toBe("unavailable"); expect(result).not.toHaveProperty("body");
  });
});
