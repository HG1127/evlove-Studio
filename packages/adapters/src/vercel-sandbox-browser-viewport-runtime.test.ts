// @vitest-environment node
import vm from "node:vm";
import { describe, expect, it, vi, afterEach } from "vitest";
import { VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT } from "./vercel-sandbox-browser-step-runtime";
import { VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT } from "./vercel-sandbox-browser-runner";

function viewportFixture(setViewportSize: (dimensions: { width: number; height: number }) => Promise<void> = async () => {}) {
  const page = { setViewportSize: vi.fn(setViewportSize), close: vi.fn(async () => {}), evaluate: vi.fn(() => { throw new Error("Viewport control is not a DOM observation"); }) };
  const runtime = new vm.Script(VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT + "\n({ validateFixedBrowserStep,runFixedTypedBrowserStep });").runInNewContext({ Date, setTimeout, clearTimeout }) as {
    validateFixedBrowserStep: (step: unknown) => void;
    runFixedTypedBrowserStep: (args: unknown) => Promise<{ operation: string; width: number; height: number }>;
  };
  const run = (step: unknown = { action: "viewport", selector: "html", width: 390, height: 844 }) => {
    runtime.validateFixedBrowserStep(step);
    return runtime.runFixedTypedBrowserStep({ page, context: {}, locator: {}, step });
  };
  return { page, run };
}

afterEach(() => vi.useRealTimers());
describe("trusted bounded viewport control (fake Page only)", () => {
  it("sets the requested dimensions exactly once without a DOM evaluation", async () => {
    const test = viewportFixture();
    expect(await test.run()).toEqual({ operation: "viewport", width: 390, height: 844 });
    expect(test.page.setViewportSize).toHaveBeenCalledExactlyOnceWith({ width: 390, height: 844 });
    expect(test.page.evaluate).not.toHaveBeenCalled();
    expect(test.page.close).not.toHaveBeenCalled();
  });
  it.each([
    { selector: "#menu", width: 390, height: 844 },
    { selector: "html", width: 239, height: 844 },
    { selector: "html", width: 390, height: 2561 },
    { selector: "html", width: 390.5, height: 844 },
    { selector: "html", width: 390, height: Infinity },
    { selector: "html", width: "390", height: 844 },
  ])("rejects invalid controls before any browser operation %#", async dimensions => {
    const test = viewportFixture();
    await expect(test.run({ action: "viewport", ...dimensions })).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    expect(test.page.setViewportSize).not.toHaveBeenCalled();
  });
  it("rejects arbitrary extra protocol fields without calling the browser", () => {
    const test = viewportFixture();
    expect(() => test.run({ action: "viewport", selector: "html", width: 390, height: 844, callback: "arbitrary" })).toThrow("Unsupported browser operation field");
    expect(test.page.setViewportSize).not.toHaveBeenCalled();
  });
  it("keeps an absent/failed trusted browser control unavailable instead of failing the product", async () => {
    const test = viewportFixture(async () => { throw new Error("CDP control unavailable"); });
    await expect(test.run()).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    expect(test.page.setViewportSize).toHaveBeenCalledOnce();
  });
  it("shares the original seven-second action deadline without retrying the resize", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const test = viewportFixture(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = expect(test.run()).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(6999);
    expect(test.page.setViewportSize).toHaveBeenCalledOnce();
    expect(test.page.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(test.page.close).toHaveBeenCalledOnce();
    finish?.();
    await Promise.resolve();
    expect(test.page.setViewportSize).toHaveBeenCalledOnce();
  });
  it("stops case cleanup resizes after unavailable rather than converting a closed page into product failure", () => {
    expect(VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT).toContain('for(const viewport of unavailable?[]:');
  });
});