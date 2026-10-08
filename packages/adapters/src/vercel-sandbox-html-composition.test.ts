// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestCaseSchema } from "@evolution/contracts";
import { runVercelSandboxHtmlValidation } from "./vercel-sandbox-html";
const { files, commands, state, stop, create, getOrCreate } = vi.hoisted(() => ({ files: new Map<string, Uint8Array | string>(), commands: [] as Array<{ cmd: string; args: string[]; detached?: boolean }>, state: { status: "verified" as "verified" | "partial" }, stop: vi.fn(), create: vi.fn(), getOrCreate: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create, getOrCreate } }));
const html = new TextEncoder().encode('<html><body><p id="actual">实际 HTML</p></body></html>');
const expectedSha256 = createHash("sha256").update(html).digest("hex");
const testCase = TestCaseSchema.parse({ id: "H1", title: "Hidden browser", input: "inspect", expected: ["实际"], hidden: true, executionMode: "external-runner", evidenceScope: "product-behavior", browserSteps: [{ action: "visible", selector: "#actual" }] });
beforeEach(() => {
  files.clear(); commands.length = 0; stop.mockReset(); state.status = "verified";
  getOrCreate.mockReset().mockResolvedValue({ currentSnapshotId: "existing-browser-runtime" });
  create.mockReset().mockResolvedValue({
    cwd: "/vercel/sandbox", region: "test", domain: () => "https://sandbox.invalid",
    writeFiles: async (entries: Array<{ path: string; content: Uint8Array | string }>) => { for (const file of entries) files.set(file.path, file.content); },
    updateNetworkPolicy: vi.fn(), stop,
    runCommand: async (raw: string | { cmd: string; args: string[]; detached?: boolean }, argv?: string[]) => {
      const command = typeof raw === "string" ? { cmd: raw, args: argv ?? [] } : raw;
      commands.push(command);
      let stdout = "READY";
      if (command.args.some((arg) => arg.includes("fs.existsSync"))) stdout = ["dist", "build", "out"].find((dir) => files.has(`${dir}/index.html`)) ?? "";
      if (command.args[0]?.endsWith("browser-runner.mjs")) stdout = JSON.stringify({ results: [{ testCaseId: "H1", verificationStatus: state.status, assertions: state.status === "verified" ? 1 : 0, blockedResources: [], latencyMs: 1, trace: [{ id: "assert-1", stage: "browser-step", status: "pass", summary: "#actual" }] }] });
      return { exitCode: 0, durationMs: 1, stdout: async () => stdout, stderr: async () => "" };
    },
  });
});
describe("standalone HTML through the real Sandbox adapter composition", () => {
  it("requests SDK recovery of a stale named runtime before creating the isolated Target", async () => {
    vi.resetModules();
    getOrCreate.mockImplementation(async (options: { resume?: boolean }) => ({ currentSnapshotId: options.resume ? "recovered-browser-runtime" : "missing-old-snapshot" }));
    const { runVercelSandboxHtmlValidation: recoveredValidation } = await import("./vercel-sandbox-html");
    const result = await recoveredValidation({ html, expectedSha256, testCases: [testCase] });
    expect(getOrCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ resume: true, persistent: true, networkPolicy: "deny-all" }));
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: { type: "snapshot", snapshotId: "recovered-browser-runtime" }, persistent: false, networkPolicy: "deny-all" }));
    expect(result.results[0]?.verificationStatus).toBe("verified");
    expect(result.artifactHash).toBe(expectedSha256);
  });

  it("selects a real static preview root, keeps Hidden runtime files outside it and binds original bytes", async () => {
    const result = await runVercelSandboxHtmlValidation({ html, expectedSha256, testCases: [testCase] });
    expect(files.get("dist/index.html")).toEqual(html);
    expect(files.has(".evolution/runtime/browser-cases.json")).toBe(true);
    expect([...files.keys()].filter((path) => path.startsWith("dist/"))).toEqual(["dist/index.html"]);
    const preview = commands.find((command) => command.detached);
    expect(preview?.args).toEqual(["/vercel/sandbox/.evolution/runtime/static-server.mjs", "dist", "4173"]);
    expect(commands.some((command) => command.args[0]?.endsWith("browser-runner.mjs"))).toBe(true);
    expect(getOrCreate).toHaveBeenCalledWith(expect.objectContaining({ resume: true }));
    expect(result.previewHealthy).toBe(true);
    expect(result.results[0]!.verificationStatus).toBe("verified");
    expect(result.artifactHash).toBe(expectedSha256);
    expect(stop).toHaveBeenCalledOnce();
  });
  it("retains screenshot-only or incomplete browser evidence as partial", async () => {
    state.status = "partial";
    const result = await runVercelSandboxHtmlValidation({ html, expectedSha256, testCases: [testCase] });
    expect(result.previewHealthy).toBe(true);
    expect(result.results[0]!.verificationStatus).toBe("partial");
  });
});
