// @vitest-environment node
import { describe, expect, it } from "vitest";
import { htmlProtectionWholeRuntimeSourcePlan } from "./html-protection-whole-runtime-plan";
import { assessHtmlProtectionScriptEffectExecution } from "./html-protection-script-effect-execution";
const literal = 'if (flag) node.textContent = call();';
const plan = htmlProtectionWholeRuntimeSourcePlan({ original: { sourceArtifactId: "synthetic", sha256: "a".repeat(64), byteLength: 90 }, html: '<!doctype html><html><head></head><body><script>' + literal + '</script></body></html>' });
function coverage(ranges = [{ startOffset: 0, endOffset: literal.length, count: 1 }], block = true): Parameters<typeof assessHtmlProtectionScriptEffectExecution>[0]["original"] { return { producer: "chromium-v8-precise-source-coverage-v1", scripts: [{ parentId: "runtime-script:0", sourceSha256: "b".repeat(64), sourceCharacters: literal.length, frameId: "frame", coveragePresent: true, functions: [{ isBlockCoverage: block, ranges }] }], unmatched: [], missingParentIds: [], gaps: [] }; }
const assess = (original = coverage(), executed = coverage()) => assessHtmlProtectionScriptEffectExecution({ sourcePlan: plan, original, executed }).parents[0]!;
describe("whole effect precise range evidence", () => {
  it("retains full span positive evidence as partial, never verified parent", () => { expect(assess().observations.every(item => item.verificationStatus === "partial")).toBe(true); expect(assess().support).toBe("unresolved"); });
  it("does not use a positive start position when effect later reaches zero range", () => { const zero = coverage([{ startOffset: 0, endOffset: literal.length, count: 1 }, { startOffset: literal.indexOf("call"), endOffset: literal.length - 1, count: 0 }]); expect(assess(zero).observations.every(item => item.verificationStatus === "unverified")).toBe(true); });
  it("function-only count cannot prove expression block execution", () => { expect(assess(coverage(undefined, false)).observations.every(item => item.verificationStatus === "unverified")).toBe(true); });
  it("overlapping nonnested blocks remain ambiguous", () => { const bad = coverage([{ startOffset: 0, endOffset: literal.length, count: 1 }, { startOffset: 12, endOffset: 30, count: 2 }, { startOffset: 20, endOffset: 33, count: 1 }]); expect(assess(bad).observations[0]?.gaps).toContain("ambiguous-native-source-range"); });
  it("native source missing or foreign gaps retain unverified effects", () => { expect(assess({ ...coverage(), gaps: ["foreign-or-dynamic-page-script"] }).sourceBindingPresent).toBe(false); });
});
