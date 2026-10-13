import { describe, expect, it } from "vitest";
import { BrowserStepSchema, browserStepHasAssertion } from "./browser-step-contract";
import { TestCaseSchema } from "./evolve-schemas";

describe("bounded additive browser operation contract", () => {
  it.each([
    { action: "click", selector: "#button" },
    { action: "fill", selector: "#query", value: "" },
    { action: "visible", selector: "#result" },
    { action: "text", selector: "#result", value: "A  B [x]." },
    { action: "count", selector: ".row", count: 0 },
  ])("preserves legacy $action JSON", step => expect(BrowserStepSchema.parse(step)).toEqual(step));

  it.each([
    { action: "hover", selector: "#card" },
    { action: "scroll-into-view", selector: "#card" },
    { action: "in-viewport", selector: "#card", ratio: 0.5, expected: true },
    { action: "in-viewport", selector: "#menu", expected: false },
    { action: "attribute", selector: "#menu", name: "aria-expanded", value: "false" },
    { action: "attribute", selector: "#menu", name: "class", value: "open", mode: "contains" },
    { action: "checked", selector: "#task", checked: true },
    { action: "checked", selector: "#task", checked: false },
    { action: "scroll-position", selector: "html", min: 0, max: 2 },
    { action: "computed-style", selector: "#card", property: "opacity", mode: "literal", value: "1" },
    { action: "computed-style", selector: "#card", property: "opacity", mode: "numeric-range", min: 0.99, max: 1 },
    { action: "computed-style", selector: "#card", property: "transform", mode: "identity-transform" },
    { action: "computed-style", selector: "#bar", property: "width", mode: "parent-relative", relativeTo: "#track", min: 0.24, max: 0.26 },
    { action: "copy-text", selector: "#copy", value: "A  B\nliteral clipboard [x]." },
  ])("accepts typed $action", step => expect(BrowserStepSchema.safeParse(step).success).toBe(true));
  it("retains selector whitespace instead of mutating legacy paper JSON", () => {
    const step = { action: "visible", selector: " #actual " };
    expect(BrowserStepSchema.parse(step)).toEqual(step);
  });

  it("keeps the existing 24-step frozen-paper boundary", () => {
    const step = { action: "scroll-into-view", selector: "#card" };
    const paper = { id: "case", title: "case", input: "", expected: [], browserSteps: Array(24).fill(step) };
    expect(TestCaseSchema.safeParse(paper).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...paper, browserSteps: Array(25).fill(step) }).success).toBe(false);
  });
  it.each([
    { action: "hover", selector: "#card", value: "arbitrary" },
    { action: "hover", selector: "#card", position: { x: 1, y: 1 } },
    { action: "hover", selector: "#card", force: true },
    { action: "hover", selector: "#card", timeout: 60_000 },
    { action: "evaluate", selector: "html", value: "process.exit()" },
    { action: "visible", selector: "body", evaluate: "arbitrary" },
    { action: "text", selector: "body", value: "x", regex: true },
    { action: "scroll-into-view", selector: "" },
    { action: "click", selector: "x".repeat(501) },
    { action: "in-viewport", selector: "#card", ratio: 1.01 },
    { action: "in-viewport", selector: "#card", ratio: -0.1 },
    { action: "checked", selector: "#task", checked: "true" },
    { action: "attribute", selector: "#x", name: "style;eval()", value: "x" },
    { action: "attribute", selector: "#x", name: "class", value: "[x]", mode: "regex" },
    { action: "scroll-position", selector: "#content", min: 0, max: 1 },
    { action: "scroll-position", selector: "html", min: 2, max: 1 },
    { action: "scroll-position", selector: "html", min: 0, max: Infinity },
    { action: "computed-style", selector: "#x", property: "unknown", mode: "literal", value: "x" },
    { action: "computed-style", selector: "#x", property: "opacity", mode: "literal", value: "calc(1)" },
    { action: "computed-style", selector: "#x", property: "opacity", mode: "numeric-range", min: 0, max: 2 },
    { action: "computed-style", selector: "#x", property: "transform", mode: "numeric-range", min: 0, max: 1 },
    { action: "computed-style", selector: "#x", property: "width", mode: "identity-transform" },
    { action: "computed-style", selector: "#x", property: "transform", mode: "identity-transform", tolerance: 0.5 },
    { action: "computed-style", selector: "#x", property: "width", mode: "parent-relative", relativeTo: "#y", min: -1, max: 1 },
    { action: "computed-style", selector: "#x", property: "width", mode: "parent-relative", relativeTo: "#y", min: 0.5, max: 0.1 },
    { action: "copy-text", selector: "#copy", value: "x", callback: "() => true" },
    { action: "copy-text", selector: "#copy", value: "x".repeat(65_537) },
  ])("rejects unsupported or unbounded operation %#", step => expect(BrowserStepSchema.safeParse(step).success).toBe(false));
  it("counts assertions while leaving scrolling and inputs as actions", () => {
    for (const action of ["visible", "text", "count", "in-viewport", "attribute", "checked", "scroll-position", "computed-style", "copy-text"] as const) {
      expect(browserStepHasAssertion({ action })).toBe(true);
    }
    for (const action of ["click", "fill", "scroll-into-view", "viewport", "hover"] as const) expect(browserStepHasAssertion({ action })).toBe(false);
  });
});

describe("closed responsive viewport control", () => {
  it.each([{ width: 240, height: 240 }, { width: 390, height: 844 }, { width: 2560, height: 2560 }])("accepts integer viewport $width x $height", dimensions => {
    const step = { action: "viewport", selector: "html", ...dimensions };
    expect(BrowserStepSchema.parse(step)).toEqual(step);
    expect(browserStepHasAssertion({ action: "viewport" })).toBe(false);
  });
  it.each([
    { width: 239, height: 844 }, { width: 390, height: 239 },
    { width: 2561, height: 844 }, { width: 390, height: 2561 },
    { width: 390.5, height: 844 }, { width: 390, height: 844.5 },
    { width: Infinity, height: 844 }, { width: 390, height: NaN },
    { width: "390", height: 844 }, { width: 390 },
    { width: 390, height: 844, value: "callback" },
    { width: 390, height: 844, eval: "arbitrary" },
  ])("rejects invalid viewport dimensions/fields %#", dimensions => {
    expect(BrowserStepSchema.safeParse({ action: "viewport", selector: "html", ...dimensions }).success).toBe(false);
  });
  it("rejects DOM selectors for viewport control", () => {
    expect(BrowserStepSchema.safeParse({ action: "viewport", selector: "#menu", width: 390, height: 844 }).success).toBe(false);
  });
  it("retains the same 24-step paper limit for control actions", () => {
    const paper = { id: "responsive", title: "responsive", input: "", expected: [], browserSteps: Array(24).fill({ action: "viewport", selector: "html", width: 390, height: 844 }) };
    expect(TestCaseSchema.safeParse(paper).success).toBe(true);
    expect(TestCaseSchema.safeParse({ ...paper, browserSteps: [...paper.browserSteps, paper.browserSteps[0]] }).success).toBe(false);
  });
});