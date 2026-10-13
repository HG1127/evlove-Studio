// @vitest-environment node
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { withOwnedHtmlProtectionDocument } from "./html-protection-owned-document";
const digest = (bytes: Buffer) => ({ sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength });
const authored = Buffer.from('<meta charset="utf-8"><input id="search"><output id="count">boot</output><script>document.querySelector("#search").addEventListener("input",event=>{document.querySelector("#count").textContent=event.target.value||"restored"})</script>');
describe("owned document callback preserves one physical Page across native action sequence", () => {
  it("pins Node/main-frame bytes and loader while trusted caller performs query and clear on the same Page", async () => {
    const seen = await withOwnedHtmlProtectionDocument({ chromium, physicalHtml: authored, expectedMaterial: digest(authored), consume: async owned => {
      const initial = owned.page;
      await owned.page.locator("#search").fill("synthetic-query"); await owned.assertCurrent();
      expect(await owned.page.locator("#count").textContent()).toBe("synthetic-query");
      await owned.page.locator("#search").fill(""); await owned.assertCurrent();
      expect(await owned.page.locator("#count").textContent()).toBe("restored");
      expect(owned.page).toBe(initial);
      return { custody: owned.readCustody(), page: initial };
    } });
    expect(seen.custody.staged).toEqual(digest(authored));
    expect(seen.custody.nodeResponse).toEqual(digest(authored));
    expect(seen.custody.browserResponse).toEqual(digest(authored));
    expect(seen.custody.blockedRequests).toBe(0);
    expect(seen.page.isClosed()).toBe(true);
  }, 30_000);
  it("rejects physical mismatch before trusted browser launch", async () => {
    let consumed = false;
    await expect(withOwnedHtmlProtectionDocument({ chromium, physicalHtml: authored, expectedMaterial: { ...digest(authored), sha256: "a".repeat(64) },
      consume: async () => { consumed = true; } })).rejects.toThrow("served-material-mismatch");
    expect(consumed).toBe(false);
  });
  it("retains actual blocked-resource count for callers to preserve attempted state failures", async () => {
    let blocked = 0;
    await expect(withOwnedHtmlProtectionDocument({ chromium, physicalHtml: authored, expectedMaterial: digest(authored), consume: async owned => {
      await owned.page.locator("#search").fill("before-block");
      await owned.page.evaluate(async () => { await fetch("https://outside.invalid/blocked").catch(() => undefined); }); // authored fixture trigger only
      blocked = owned.readCustody().blockedRequests;
      await owned.assertCurrent();
    } })).rejects.toThrow("blocked-resource");
    expect(blocked).toBeGreaterThan(0);
  }, 30_000);
  it("does not permit a callback to relabel a document navigation as the pinned initial document", async () => {
    await expect(withOwnedHtmlProtectionDocument({ chromium, physicalHtml: authored, expectedMaterial: digest(authored), consume: async owned => {
      await owned.page.goto("about:blank"); await owned.assertCurrent();
    } })).rejects.toThrow("served-material-mismatch");
  }, 30_000);
});

it("allows same-document anchors while preserving exact loader and bytes", async () => {
  const html = Buffer.from('<a id="link" href="#chapter">navigate</a><section id="chapter">same document</section>');
  await withOwnedHtmlProtectionDocument({ chromium, physicalHtml: html, expectedMaterial: digest(html), consume: async owned => {
    const loader = owned.custody.navigation.loaderId;
    await owned.page.locator("#link").click(); await owned.assertCurrent();
    expect(owned.page.url()).toBe("http://127.0.0.1:4173/index.html#chapter");
    expect(owned.readCustody().navigation.loaderId).toBe(loader);
  } });
}, 30_000);
it("counts a native CSP refusal separately from a routeable image refusal", async () => {
  const html = Buffer.from('<input id="search"><script>search.oninput=()=>{const image=new Image();image.src="https://outside.invalid/image";document.body.append(image);fetch("https://outside.invalid/csp").catch(()=>{})}</script>');
  let attempted = 0;
  await expect(withOwnedHtmlProtectionDocument({ chromium, physicalHtml: html, expectedMaterial: digest(html), consume: async owned => {
    const failed = owned.page.waitForEvent("requestfailed", { predicate: request => request.url().endsWith("/image"), timeout: 5_000 });
    await owned.page.locator("#search").fill("dispatch"); await failed;
    attempted = owned.readCustody().blockedRequests; await owned.assertCurrent();
  } })).rejects.toThrow("blocked-resource");
  expect(attempted).toBeGreaterThanOrEqual(2);
}, 30_000);
it("bounds owned close even when the browser cleanup never settles", async () => {
  const close = vi.fn(() => new Promise<void>(() => {}));
  const fake = { launch: async () => ({ newContext: async () => { throw Error("synthetic startup failure"); }, close }) } as unknown as typeof chromium;
  const start = Date.now();
  await expect(withOwnedHtmlProtectionDocument({ chromium: fake, physicalHtml: authored, expectedMaterial: digest(authored), consume: async () => {} })).rejects.toThrow("synthetic startup failure");
  expect(close).toHaveBeenCalledTimes(1); expect(Date.now() - start).toBeLessThan(8_000);
}, 12_000);
it("does not create a late CDP session after owned newPage outlives the deadline", async () => {
  vi.useFakeTimers();
  let enter!: () => void, release!: (page: unknown) => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), pending = new Promise<unknown>(resolve => { release = resolve; });
  const cdp = vi.fn(), close = vi.fn(async () => {});
  const fake = { launch: async () => ({ newContext: async () => ({ newPage: () => { enter(); return pending; }, newCDPSession: cdp }), close }) } as unknown as typeof chromium;
  const consume = vi.fn(async () => {});
  const run = withOwnedHtmlProtectionDocument({ chromium: fake, physicalHtml: authored, expectedMaterial: digest(authored), consume });
  const rejected = expect(run).rejects.toThrow("observation-unavailable");
  await entered; await vi.advanceTimersByTimeAsync(90_000); await rejected;
  release({}); await Promise.resolve(); await Promise.resolve();
  expect(cdp).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
}, 12_000);