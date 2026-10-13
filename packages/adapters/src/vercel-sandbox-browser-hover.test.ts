// @vitest-environment node
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT } from "./vercel-sandbox-browser-step-runtime";

type HoverLocator = { hover?: (options: { timeout: number }) => Promise<unknown> };
function runtime(clock = Date) {
  return new vm.Script(VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT
    + "\n({validateFixedBrowserStep,runFixedTypedBrowserStep});").runInNewContext({ Date: clock, setTimeout, clearTimeout }) as {
    validateFixedBrowserStep: (step: unknown) => void;
    runFixedTypedBrowserStep: (args: { page: { close?: () => Promise<void> }; locator: HoverLocator; step: unknown }) => Promise<{ operation: string }>;
  };
}
const step = { action: "hover", selector: "#synthetic-card" };
afterEach(() => vi.useRealTimers());

describe("bounded Sandbox hover control, synthetic ports only", () => {
  it("calls the trusted locator exactly once with the original 7s action deadline", async () => {
    const hover = vi.fn(async (options) => { expect(options).toEqual({ timeout: 7000 }); });
    const actual = await runtime({ now: () => 1000 } as DateConstructor).runFixedTypedBrowserStep({ page: {}, locator: { hover }, step });
    expect(actual).toEqual({ operation: "hover" });
    expect(hover).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...step, value: "code" }, { ...step, evaluate: "document.body.remove()" },
    { ...step, force: true }, { ...step, timeout: 90_000 }, { ...step, position: { x: 1, y: 1 } },
    { ...step, selector: " " }, { ...step, selector: "x".repeat(501) },
  ])("rejects invalid or executable hover fields %# before action dispatch", raw => {
    expect(() => runtime().validateFixedBrowserStep(raw)).toThrow();
  });
  it("accepts only the closed action and selector shape", () => {
    expect(() => runtime().validateFixedBrowserStep(step)).not.toThrow();
  });
  it("retains unavailable capability when the locator has no hover implementation", async () => {
    await expect(runtime().runFixedTypedBrowserStep({ page: {}, locator: {}, step }))
      .rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
  });
  it("does not retry a rejected hover or turn it into a product assertion failure", async () => {
    const hover = vi.fn(async () => { throw Error("Synthetic capability rejection"); });
    await expect(runtime().runFixedTypedBrowserStep({ page: {}, locator: { hover }, step }))
      .rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    expect(hover).toHaveBeenCalledTimes(1);
  });
  it("closes the page at the original deadline and does not repeat a hanging action", async () => {
    vi.useFakeTimers();
    const hover = vi.fn(() => new Promise<never>(() => {})), close = vi.fn(async () => {});
    const result = runtime().runFixedTypedBrowserStep({ page: { close }, locator: { hover }, step });
    const rejection = expect(result).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(7000);
    await rejection;
    expect(hover).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start a deferred action after the original deadline when the timer has not fired", async () => {
    let now = 1000;
    const hover = vi.fn(async () => {}), close = vi.fn(async () => {});
    const result = runtime({ now: () => now } as DateConstructor)
      .runFixedTypedBrowserStep({ page: { close }, locator: { hover }, step });
    now += 7001;
    await expect(result).rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    expect(hover).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("gives a delayed dispatch only the remainder of the original action budget", async () => {
    let now = 1000;
    const hover = vi.fn(async (options) => { expect(options).toEqual({ timeout: 5500 }); });
    const result = runtime({ now: () => now } as DateConstructor)
      .runFixedTypedBrowserStep({ page: {}, locator: { hover }, step });
    now += 1500;
    await expect(result).resolves.toEqual({ operation: "hover" });
    expect(hover).toHaveBeenCalledTimes(1);
  });
  it("rejects completion observed after the action deadline even before the timer fires", async () => {
    let now = 1000;
    const hover = vi.fn(async () => { now += 7001; });
    await expect(runtime({ now: () => now } as DateConstructor)
      .runFixedTypedBrowserStep({ page: {}, locator: { hover }, step }))
      .rejects.toMatchObject({ code: "BROWSER_CAPABILITY_UNAVAILABLE" });
    expect(hover).toHaveBeenCalledTimes(1);
  });
});