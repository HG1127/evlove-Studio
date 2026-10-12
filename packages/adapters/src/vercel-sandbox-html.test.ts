// @vitest-environment node
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestCaseSchema } from "@evolution/contracts";
import { runVercelSandboxHtmlValidation } from "./vercel-sandbox-html";
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("./vercel-sandbox-adapter", () => ({ runVercelSandboxCodebaseValidation: execute }));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const html = new TextEncoder().encode('<html><body><p id="actual">真实完整 HTML</p>\r\n</body></html>');
const testCase = TestCaseSchema.parse({ id: "H1", title: "Read actual file", input: "inspect actual", expected: ["真实"], hidden: true, executionMode: "external-runner", evidenceScope: "product-behavior", browserSteps: [{ action: "text", selector: "#actual", value: "真实" }] });
const fixture = () => ({ html, expectedSha256: hash(html), testCases: [testCase] });
beforeEach(() => { execute.mockReset(); });
describe("standalone HTML Sandbox transport", () => {
  it.each(["verified", "partial", "unverified", "failed"] as const)("preserves %s evidence and binds the exact original HTML bytes", async (status) => {
    execute.mockImplementation(async (args: { archive: Uint8Array; expectedSha256: string }) => {
      expect(hash(args.archive)).toBe(args.expectedSha256);
      const zip = await JSZip.loadAsync(args.archive, { checkCRC32: true });
      expect(await zip.file("dist/index.html")!.async("uint8array")).toEqual(html);
      expect(JSON.parse(await zip.file("package.json")!.async("string"))).toEqual({ name: "evolution-standalone-html", version: "1.0.0", private: true });
      return { artifactHash: args.expectedSha256, scriptsRun: [], results: [{ testCaseId: "H1", output: `HTML browser evidence ${args.expectedSha256}`, latencyMs: 1, cost: 0, artifactHash: args.expectedSha256, verificationStatus: status, trace: [] }] };
    });
    const result = await runVercelSandboxHtmlValidation(fixture());
    expect(result.artifactHash).toBe(hash(html));
    expect(result.results[0]!.artifactHash).toBe(hash(html));
    expect(result.results[0]!.verificationStatus).toBe(status);
    expect(result.results[0]!.trace.at(-1)!.detail).toContain("transport ZIP SHA-256");
  });
  it.each([
    { action: "viewport", selector: "html", width: 390, height: 844 },
    { action: "scroll-into-view", selector: "#actual" },
    { action: "computed-style", selector: "#actual", property: "opacity", mode: "numeric-range", min: 0.99, max: 1 },
    { action: "checked", selector: "#actual", checked: true },
    { action: "copy-text", selector: "#actual", value: "真实完整 HTML" },
  ])("transports additive typed $action unchanged without relabeling file identity", async step => {
    const paper = TestCaseSchema.parse({ ...testCase, browserSteps: [step] });
    execute.mockImplementation(async (args: { archive: Uint8Array; expectedSha256: string; testCases: unknown[] }) => {
      expect(args.testCases).toEqual([paper]);
      const zip = await JSZip.loadAsync(args.archive, { checkCRC32: true });
      expect(await zip.file("dist/index.html")!.async("uint8array")).toEqual(html);
      return { artifactHash: args.expectedSha256, results: [{ testCaseId: paper.id, output: "typed boundary fixture",
        latencyMs: 1, cost: 0, artifactHash: args.expectedSha256, verificationStatus: "partial", trace: [] }] };
    });
    const result = await runVercelSandboxHtmlValidation({ ...fixture(), testCases: [paper] });
    expect(result.artifactHash).toBe(hash(html));
    expect(result.results[0]?.verificationStatus).toBe("partial");
  });

  it("copies mutable input bytes before asynchronous ZIP preparation", async () => {
    execute.mockImplementation(async (args: { archive: Uint8Array; expectedSha256: string }) => {
      const zip = await JSZip.loadAsync(args.archive, { checkCRC32: true });
      expect(await zip.file("dist/index.html")!.async("uint8array")).toEqual(html);
      return { artifactHash: args.expectedSha256, results: [{ testCaseId: "H1", output: "bound", latencyMs: 1, cost: 0, artifactHash: args.expectedSha256, verificationStatus: "verified", trace: [] }] };
    });
    const args = { ...fixture(), html: html.slice() };
    const result = runVercelSandboxHtmlValidation(args);
    args.html.fill(0);
    expect((await result).artifactHash).toBe(hash(html));
  });
  it("blocks a changed file before allocating a Sandbox", async () => {
    const result = await runVercelSandboxHtmlValidation({ ...fixture(), html: new TextEncoder().encode("changed") });
    expect(result.results[0]!.verificationStatus).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects an unbound wrapper receipt instead of relabeling it as original HTML evidence", async () => {
    execute.mockResolvedValue({ artifactHash: "a".repeat(64), scriptsRun: [], results: [{ testCaseId: "H1", output: "wrong wrapper", latencyMs: 1, cost: 0, artifactHash: "a".repeat(64), verificationStatus: "verified", trace: [] }] });
    await expect(runVercelSandboxHtmlValidation(fixture())).rejects.toThrow(/receipt/);
  });
  it.each(["empty", "oversized", "bad-hash", "bad-step", "bad-viewport"])("validates the %s boundary before external execution", async (kind) => {
    const args = fixture();
    if (kind === "empty") args.html = new Uint8Array();
    if (kind === "oversized") args.html = new Uint8Array(20 * 1024 * 1024 + 1);
    if (kind === "bad-hash") args.expectedSha256 = "not-a-hash";
    if (kind === "bad-step") args.testCases[0] = { ...testCase, browserSteps: [{ action: "count", selector: "#actual", count: -1 }] };
    if (kind === "bad-viewport") args.testCases[0] = { ...testCase, browserSteps: [{ action: "viewport", selector: "html", width: 239, height: 844 }] };
    await expect(runVercelSandboxHtmlValidation(args)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
