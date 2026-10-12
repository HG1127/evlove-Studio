// @vitest-environment node
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT } from "./vercel-sandbox-browser-isolated-observer";
class SyntheticShadowRoot {
  host: SyntheticElement;
  constructor(host: SyntheticElement) { this.host = host; }
}
class SyntheticElement {
  parentElement: SyntheticElement | null = null;
  assignedSlot: SyntheticElement | null = null;
  root: object = {};
  opacity: number;
  constructor(opacity: number) { this.opacity = opacity; }
  getRootNode() { return this.root; }
  getBoundingClientRect() { return { width: 80 }; }
}
function measure(element: SyntheticElement) {
  const observe = new vm.Script(VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT + "\ncollectFixedIsolatedBrowserFacts;").runInNewContext({
    ShadowRoot: SyntheticShadowRoot,
    document: { querySelectorAll: (selector: string) => selector === "#synthetic" ? [element] : [] },
    getComputedStyle: (item: SyntheticElement) => ({ opacity: String(item.opacity), getPropertyValue: () => String(item.opacity) }),
  }) as (args: unknown) => Promise<{ effectiveOpacity: number }>;
  return observe({ action: "computed-style", selector: "#synthetic", property: "opacity", mode: "numeric-range" });
}
describe("trusted observer composed-tree scope (synthetic DOM only)", () => {
  it("includes transparent slot wrappers instead of skipping to light-DOM host", async () => {
    const host = new SyntheticElement(1), root = new SyntheticShadowRoot(host);
    const wrapper = new SyntheticElement(0); wrapper.root = root;
    const slot = new SyntheticElement(1); slot.root = root; slot.parentElement = wrapper;
    const child = new SyntheticElement(1); child.parentElement = host; child.assignedSlot = slot;
    expect((await measure(child)).effectiveOpacity).toBe(0);
  });
  it("multiplies slot, wrapper, host and child opacity exactly once", async () => {
    const host = new SyntheticElement(0.5), root = new SyntheticShadowRoot(host);
    const wrapper = new SyntheticElement(0.5); wrapper.root = root;
    const slot = new SyntheticElement(0.5); slot.root = root; slot.parentElement = wrapper;
    const child = new SyntheticElement(0.8); child.parentElement = host; child.assignedSlot = slot;
    expect((await measure(child)).effectiveOpacity).toBeCloseTo(0.1, 12);
  });
});
