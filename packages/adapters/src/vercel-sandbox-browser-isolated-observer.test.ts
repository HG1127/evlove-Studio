// @vitest-environment node
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT } from "./vercel-sandbox-browser-isolated-observer";
import { VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT } from "./vercel-sandbox-browser-step-runtime";

function fixture(mode = "good") {
  let created: ((event: unknown) => void) | undefined;
  const session = {
    on: vi.fn((_name: string, listener: (event: unknown) => void) => { created = listener; }),
    send: vi.fn(async (method: string, args?: Record<string, unknown>) => {
      if (method === "Runtime.enable") return {};
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "synthetic-frame" } } };
      if (method === "Page.createIsolatedWorld") {
        if (mode === "create-denied") throw new Error("CDP unavailable");
        expect(args?.grantUniveralAccess).toBe(false);
        expect(args).not.toHaveProperty("grantUniversalAccess");
        if (mode !== "missing-event") created?.({ context: { id: 17,
          name: mode === "wrong-name" ? "artifact-main" : args?.worldName,
          uniqueId: mode === "missing-unique" ? undefined : "synthetic-unique-world",
          auxData: { frameId: mode === "wrong-frame" ? "other-frame" : "synthetic-frame", isDefault: mode === "main-realm", type: mode === "main-realm" ? "default" : "isolated" },
        } });
        return { executionContextId: 17 };
      }
      if (method === "Runtime.callFunctionOn") {
        expect(args?.uniqueContextId).toBe("synthetic-unique-world");
        expect(args).not.toHaveProperty("executionContextId");
        expect(args?.userGesture).toBe(false);
        if (mode === "navigation") throw new Error("Unique context destroyed by navigation");
        if (mode === "exception") return { exceptionDetails: { text: "Native observer unavailable" }, result: { type: "object" } };
        if (mode === "missing-value") return { result: { type: "undefined" } };
        return { result: { type: "object", value: { observer: "chromium-cdp-isolated-v1", count: 1, effectiveOpacity: 1 } } };
      }
      throw new Error("Unowned CDP method: " + method);
    }),
    detach: vi.fn(async () => {}),
  };
  const context = { newCDPSession: vi.fn(async () => { if (mode === "no-cdp") throw new Error("No CDP"); return session; }) };
  const page = { evaluate: vi.fn(() => { throw new Error("Main-world fallback is forbidden"); }) };
  const observe = new vm.Script(VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT + "\n"
    + VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT + "\nobserveFixedBrowserFacts;").runInNewContext({
    randomUUID: () => "synthetic-world-suffix",
  }) as (context: unknown, page: unknown, step: unknown) => Promise<unknown>;
  const step = { action: "computed-style", selector: "#target", property: "opacity", mode: "numeric-range", min: 0.99, max: 1 };
  return { observe: (input: unknown = step) => observe(context, page, input), context, page, session };
}

describe("fixed isolated Chromium observation authority (synthetic CDP only)", () => {
  it("binds the event-proven non-default realm by system-unique context ID", async () => {
    const test = fixture();
    expect(await test.observe()).toMatchObject({ observer: "chromium-cdp-isolated-v1", effectiveOpacity: 1 });
    expect(test.session.send.mock.calls.map(call => call[0])).toEqual(["Runtime.enable", "Page.getFrameTree", "Page.createIsolatedWorld", "Runtime.callFunctionOn"]);
    expect(test.page.evaluate).not.toHaveBeenCalled();
    expect(test.session.detach).toHaveBeenCalledOnce();
  });
  it("transports selector/property only as closed JSON arguments, never supplied function source", async () => {
    const test = fixture(), selector = '#x"; globalThis.attack = true; //';
    await test.observe({ action: "computed-style", selector, property: "width", mode: "parent-relative", relativeTo: "#parent", min: 0.2, max: 0.9, eval: "attack" });
    const args = test.session.send.mock.calls.find(call => call[0] === "Runtime.callFunctionOn")![1]!;
    expect(args.functionDeclaration).not.toContain(selector);
    expect(args.arguments).toEqual([{ value: { action: "computed-style", selector, property: "width", mode: "parent-relative", relativeTo: "#parent" } }]);
  });
  it.each(["no-cdp", "create-denied", "missing-event", "wrong-name", "main-realm", "wrong-frame", "missing-unique", "navigation", "exception", "missing-value"])("rejects %s without any main-world fallback", async mode => {
    const test = fixture(mode);
    await expect(test.observe()).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    expect(test.page.evaluate).not.toHaveBeenCalled();
    if (mode !== "no-cdp") expect(test.session.detach).toHaveBeenCalledOnce();
    if (["create-denied", "missing-event", "wrong-name", "main-realm", "wrong-frame", "missing-unique"].includes(mode))
      expect(test.session.send.mock.calls.some(call => call[0] === "Runtime.callFunctionOn")).toBe(false);
  });
});

function fixedDispatch(readings: Array<{ value?: Record<string, unknown>; error?: Error }>) {
  let index = 0;
  const observe = async () => { const reading = readings[Math.min(index++, readings.length - 1)]; if (reading.error) throw reading.error; return reading.value; };
  const poll = (callback: () => Promise<boolean>) => ({ toBe: async () => {
    for (let attempt = 0; attempt < readings.length; attempt++) if (await callback()) return;
    throw new Error("Observed predicate violation");
  } });
  const run = new vm.Script(VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT + "\nrunFixedTypedBrowserStep;").runInNewContext({
    observeFixedBrowserFacts: observe, expect: { poll },
  }) as (args: unknown) => Promise<unknown>;
  return (step: unknown) => run({ context: {}, page: {}, locator: {}, step });
}

describe("complete failed observations remain product violations", () => {
  it("clears a transient unavailable style observation before a complete mismatch", async () => {
    const run = fixedDispatch([{ error: new Error("Temporary measurement failure") }, { value: { count: 1, computed: "0", effectiveOpacity: 0 } }]);
    await expect(run({ action: "computed-style", selector: "#card", property: "opacity", mode: "numeric-range", min: 0.99, max: 1 })).rejects.toThrow("Observed predicate violation");
  });
  it("clears transient viewport failure before the actual out-of-view mismatch", async () => {
    const run = fixedDispatch([{ error: new Error("Temporary measurement failure") }, { value: { count: 1, intersectionRatio: 0 } }]);
    await expect(run({ action: "in-viewport", selector: "#card" })).rejects.toThrow("Observed predicate violation");
  });
  it("clears transient scroll failure before a complete physical scroll mismatch", async () => {
    const run = fixedDispatch([{ error: new Error("Temporary measurement failure") }, { value: { actual: 1500 } }]);
    await expect(run({ action: "scroll-position", selector: "html", min: 0, max: 2 })).rejects.toThrow("Observed predicate violation");
  });
  it("keeps final missing measurements unverified instead of failing the artifact", async () => {
    const unavailable = Object.assign(new Error("Isolated observer unavailable"), { code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    const run = fixedDispatch([{ error: unavailable }]);
    await expect(run({ action: "in-viewport", selector: "#card" })).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
  });
});
function nativeFactFixture(options: { matrix?: number[]; width?: number; referenceWidth?: number; scroll?: number } = {}) {
  const child = { getBoundingClientRect: () => ({ width: options.width ?? 80 }) };
  const reference = { getBoundingClientRect: () => ({ width: options.referenceWidth ?? 100 }) };
  const observe = new vm.Script(VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT + "\ncollectFixedIsolatedBrowserFacts;").runInNewContext({
    document: { querySelectorAll: (selector: string) => selector === "#child" ? [child] : selector === "#reference" ? [reference] : [] },
    window: { scrollX: options.scroll ?? 0, scrollY: options.scroll ?? 0 },
    getComputedStyle: () => ({ getPropertyValue: (property: string) => property === "width" ? "80px" : "none" }),
    DOMMatrixReadOnly: class { toFloat64Array() { return options.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; } },
  }) as (args: unknown) => Promise<Record<string, unknown>>;
  return observe;
}

describe("native fixed observation completeness (synthetic independent realm)", () => {
  it.each([{ matrix: [] }, { matrix: Array(15).fill(1) }, { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, NaN, 1] }])("rejects incomplete/nonfinite transform $matrix", async ({ matrix }) => {
    await expect(nativeFactFixture({ matrix })({ action: "computed-style", selector: "#child", property: "transform", mode: "identity-transform" }))
      .rejects.toThrow("complete finite matrix");
  });
  it("returns all sixteen finite transform components", async () => {
    const facts = await nativeFactFixture()({ action: "computed-style", selector: "#child", property: "transform", mode: "identity-transform" });
    expect(facts.matrix).toHaveLength(16);
  });
  it("rejects absent/nonfinite physical scroll data", async () => {
    await expect(nativeFactFixture({ scroll: Infinity })({ action: "scroll-position", selector: "html", axis: "y" })).rejects.toThrow("not finite");
  });
  it("rejects nonfinite physical element geometry", async () => {
    await expect(nativeFactFixture({ width: Infinity })({ action: "computed-style", selector: "#child", property: "width", mode: "numeric-range" })).rejects.toThrow("not finite");
  });
  it("rejects zero reference geometry rather than inventing a progress ratio", async () => {
    await expect(nativeFactFixture({ referenceWidth: 0 })({ action: "computed-style", selector: "#child", property: "width", mode: "parent-relative", relativeTo: "#reference" })).rejects.toThrow("no measurable border-box");
  });
  it("cannot fabricate viewport observations when isolated native IntersectionObserver is missing", async () => {
    await expect(nativeFactFixture()({ action: "in-viewport", selector: "#child" })).rejects.toThrow("IntersectionObserver is unavailable");
  });
});