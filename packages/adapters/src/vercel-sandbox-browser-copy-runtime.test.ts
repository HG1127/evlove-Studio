// @vitest-environment node
import { createHash } from "node:crypto";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT } from "./vercel-sandbox-browser-step-runtime";
import { VERCEL_SANDBOX_NATIVE_COPY_RUNTIME_SCRIPT } from "./vercel-sandbox-browser-copy-runtime";
import { VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT } from "./vercel-sandbox-browser-runner";

function protocolFixture(mode = "good", expected = "A  B\nliteral clipboard [x].") {
  let clipboard = "unrelated stale value", ticks = 0, clicks = 0;
  const sequence: string[] = [];
  const mainEvaluate = vi.fn(() => { throw new Error("User HTML main-world evaluation is prohibited"); });
  const probe = {
    goto: vi.fn(async (url: string) => { sequence.push("probe-open"); expect(url).toBe("http://127.0.0.1:4173/.evolution/clipboard-probe-synthetic"); }),
    bringToFront: vi.fn(async () => { sequence.push("probe-focus"); }),
    evaluate: vi.fn(async (fn: unknown, argument?: string) => {
      const source = String(fn);
      if (source.includes("typeof navigator.clipboard")) { sequence.push("native-capability"); return mode !== "no-api"; }
      if (source.includes("writeText")) { sequence.push("native-write-sentinel"); clipboard = argument!; return; }
      if (source.includes("readText")) {
        sequence.push("native-read");
        if (mode === "read-denied") throw new Error("Native read permission denied");
        return mode === "preflight-mismatch" ? "wrong sentinel" : clipboard;
      }
      throw new Error("Unexpected probe callback");
    }),
    close: vi.fn(async () => { sequence.push("probe-close"); }),
  };
  const context = {
    grantPermissions: vi.fn(async (permissions: string[], options: { origin: string }) => {
      sequence.push("grant-origin");
      expect(permissions).toEqual(["clipboard-read", "clipboard-write"]);
      expect(options.origin).toBe("http://127.0.0.1:4173");
      if (mode === "permission-denied") throw new Error("Permission unavailable");
    }),
    newPage: vi.fn(async () => probe),
  };
  const page = { bringToFront: vi.fn(async () => { sequence.push("user-focus"); }), evaluate: mainEvaluate };
  const locator = { click: vi.fn(async () => {
    sequence.push("actual-button-click"); clicks++;
    if (mode === "click-failed") throw new Error("Actual button is hidden");
    if (mode === "good") clipboard = expected;
    if (mode === "wrong-text") clipboard = "A B\nliteral clipboard [x].";
    // Toast-only and user-overridden Clipboard API never touch this native probe value.
  }) };
  // Execute only trusted adapter-owned protocol code in a synthetic VM. Fake Page
  // methods never execute the callback and never access any host/native clipboard.
  const copy = new vm.Script(VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT + "\n"
    + VERCEL_SANDBOX_NATIVE_COPY_RUNTIME_SCRIPT + "\ncopyTextWithNativeProbe;").runInNewContext({
    createHash, randomUUID: () => "synthetic-unique-sentinel", URL,
    Date: { now: () => { ticks += 10; return ticks; } },
    setTimeout: (callback: () => void, delay: number) => { if (delay <= 50 || mode === "deadline-expired") callback(); return 0; },
    clearTimeout: () => {},
  }) as (args: unknown) => Promise<{ operation: string; actualLength: number; actualSha256: string; nativeProbe: boolean }>;
  const execute = () => copy({ context, page, locator, probeUrl: "http://127.0.0.1:4173/.evolution/clipboard-probe-synthetic",
    step: { action: "copy-text", selector: "#copy", value: expected } });
  return { execute, sequence, context, probe, page, locator, clicks: () => clicks };
}

describe("Sandbox-only native clipboard atomic protocol (synthetic fake Pages)", () => {
  it("writes/reads its unique sentinel before one actual click then compares exact native probe bytes", async () => {
    const fixture = protocolFixture();
    const result = await fixture.execute();
    expect(result).toMatchObject({ operation: "copy-text", actualLength: "A  B\nliteral clipboard [x].".length, nativeProbe: true });
    expect(result.actualSha256).toBe(createHash("sha256").update("A  B\nliteral clipboard [x].").digest("hex"));
    expect(fixture.clicks()).toBe(1);
    expect(fixture.sequence).toEqual(["grant-origin", "probe-open", "probe-focus", "native-capability",
      "native-write-sentinel", "native-read", "user-focus", "actual-button-click", "probe-focus", "native-read", "probe-close"]);
    expect(fixture.page.evaluate).not.toHaveBeenCalled();
  });
  it("cannot reuse prior clipboard content when the exact expected value is empty", async () => {
    const fixture = protocolFixture("good", "");
    const result = await fixture.execute();
    expect(result.actualLength).toBe(0);
    expect(fixture.clicks()).toBe(1);
    expect(fixture.sequence.indexOf("native-write-sentinel")).toBeLessThan(fixture.sequence.indexOf("actual-button-click"));
  });

  it("handles exact Unicode and whitespace without invented normalization", async () => {
    const result = await protocolFixture("good", "示例🙂\r\nA  B [x].").execute();
    expect(result.actualSha256).toBe(createHash("sha256").update("示例🙂\r\nA  B [x].").digest("hex"));
  });
  it.each(["permission-denied", "no-api", "read-denied", "preflight-mismatch", "deadline-expired"])("leaves %s capability unverified and never clicks", async mode => {
    const fixture = protocolFixture(mode);
    await expect(fixture.execute()).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    expect(fixture.clicks()).toBe(0);
    expect(fixture.page.evaluate).not.toHaveBeenCalled();
    if (mode !== "permission-denied" && mode !== "deadline-expired") expect(fixture.probe.close).toHaveBeenCalledOnce();
  });
  it.each(["toast-only", "user-api-overridden", "wrong-text"])("observes %s as actual clipboard assertion violation", async mode => {
    const fixture = protocolFixture(mode);
    await expect(fixture.execute()).rejects.toThrow("Clipboard exact text assertion failed");
    expect(fixture.clicks()).toBe(1);
    expect(fixture.probe.close).toHaveBeenCalledOnce();
    expect(fixture.page.evaluate).not.toHaveBeenCalled();
  });
  it("keeps a real failed button activation distinct from clipboard permission absence", async () => {
    const fixture = protocolFixture("click-failed");
    await expect(fixture.execute()).rejects.toThrow("Actual button is hidden");
    expect(fixture.clicks()).toBe(1);
    expect(fixture.probe.close).toHaveBeenCalledOnce();
  });
  it("installs only the exact random probe route with script-free CSP in the isolated context", () => {
    expect(VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT).toContain('url===clipboardProbeUrl&&route.request().method()==="GET"');
    expect(VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT).toContain("default-src 'none'; script-src 'none'");
    expect(VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT).not.toContain("navigator.clipboard= ");
    expect(VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT).not.toContain("exposeBinding");
  });
});
