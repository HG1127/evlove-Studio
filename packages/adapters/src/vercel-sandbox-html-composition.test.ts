// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestCaseSchema } from "@evolution/contracts";
const { files, commands, state, stop, create, getOrCreate, snapshotGet, deleteCache } = vi.hoisted(() => ({ files: new Map<string, Uint8Array | string>(), commands: [] as Array<{ cmd: string; args: string[]; detached?: boolean }>, state: { status: "verified" as "verified" | "partial" }, stop: vi.fn(), create: vi.fn(), getOrCreate: vi.fn(), snapshotGet: vi.fn(), deleteCache: vi.fn() }));
vi.mock("@vercel/sandbox", async (importOriginal) => ({ ...await importOriginal<typeof import("@vercel/sandbox")>(), Sandbox: { create, getOrCreate }, Snapshot: { get: snapshotGet } }));
const html = new TextEncoder().encode('<html><body><p id="actual">实际 HTML</p></body></html>');
const expectedSha256 = createHash("sha256").update(html).digest("hex");
const testCase = TestCaseSchema.parse({ id: "H1", title: "Hidden browser", input: "inspect", expected: ["实际"], hidden: true, executionMode: "external-runner", evidenceScope: "product-behavior", browserSteps: [{ action: "visible", selector: "#actual" }] });
async function validate() {
  const { runVercelSandboxHtmlValidation } = await import("./vercel-sandbox-html");
  return runVercelSandboxHtmlValidation({ html, expectedSha256, testCases: [testCase] });
}
beforeEach(() => {
  vi.resetModules();
  files.clear(); commands.length = 0; stop.mockReset(); state.status = "verified";
  snapshotGet.mockReset().mockResolvedValue({}); deleteCache.mockReset().mockResolvedValue(undefined);
  getOrCreate.mockReset().mockResolvedValue({ currentSnapshotId: "existing-browser-runtime", delete: deleteCache });
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
  it("checks the stored snapshot without resuming or deleting a valid cache", async () => {
    const result = await validate();
    expect(getOrCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ resume: false, persistent: true, networkPolicy: "deny-all" }));
    expect(snapshotGet).toHaveBeenCalledExactlyOnceWith({ snapshotId: "existing-browser-runtime" });
    expect(deleteCache).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: { type: "snapshot", snapshotId: "existing-browser-runtime" }, persistent: false, networkPolicy: "deny-all" }));
    expect(result.results[0]?.verificationStatus).toBe("verified");
    expect(result.artifactHash).toBe(expectedSha256);
  });

  it("rebuilds only the trusted cache on an explicit missing-snapshot 404", async () => {
    const { APIError } = await import("@vercel/sandbox");
    snapshotGet.mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })));
    const rebuilt = { updateNetworkPolicy: vi.fn(), runCommand: vi.fn().mockResolvedValue({ exitCode: 0 }), writeFiles: vi.fn(), snapshot: vi.fn().mockResolvedValue({ snapshotId: "recovered-browser-runtime" }) };
    getOrCreate.mockResolvedValueOnce({ currentSnapshotId: "missing-old-snapshot", delete: deleteCache }).mockResolvedValueOnce(rebuilt);
    const result = await validate();
    expect(deleteCache).toHaveBeenCalledExactlyOnceWith({ deleteOrphanSnapshots: false });
    expect(getOrCreate).toHaveBeenCalledTimes(2);
    expect(getOrCreate.mock.calls[1]?.[0]).toEqual(getOrCreate.mock.calls[0]?.[0]);
    expect(rebuilt.runCommand).toHaveBeenCalledWith("npm", ["install", "--prefix", ".evolution/browser", "playwright@1.63.0"], expect.anything());
    expect(rebuilt.snapshot).toHaveBeenCalledExactlyOnceWith({ expiration: 7 * 24 * 60 * 60 * 1000 });
    expect(rebuilt.updateNetworkPolicy).toHaveBeenLastCalledWith("deny-all");
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: { type: "snapshot", snapshotId: "recovered-browser-runtime" }, persistent: false, networkPolicy: "deny-all" }));
    expect(result.results[0]?.verificationStatus).toBe("verified");
    expect(result.artifactHash).toBe(expectedSha256);
  });

  it.each([401, 403, 429, 500])("keeps the cache on a %s snapshot API failure and leaves evidence unverified", async (status) => {
    const { APIError } = await import("@vercel/sandbox");
    snapshotGet.mockRejectedValueOnce(new APIError(new Response(null, { status })));
    const result = await validate();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(getOrCreate).toHaveBeenCalledTimes(1);
    expect(result.results[0]?.verificationStatus).toBe("unverified");
    expect(result.previewHealthy).toBe(false);
    expect(result.browserStepsExecuted).toBe(0);
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("source");
  });

  it("keeps the cache on a transport error and does not clone an unchecked snapshot", async () => {
    snapshotGet.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await validate();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(getOrCreate).toHaveBeenCalledTimes(1);
    expect(result.results[0]?.verificationStatus).toBe("unverified");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("source");
  });

  it("does not build a replacement if cache deletion fails", async () => {
    const { APIError } = await import("@vercel/sandbox");
    snapshotGet.mockRejectedValueOnce(new APIError(new Response(null, { status: 404 })));
    deleteCache.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await validate();
    expect(getOrCreate).toHaveBeenCalledTimes(1);
    expect(result.results[0]?.verificationStatus).toBe("unverified");
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("source");
  });

  it("selects a real static preview root, keeps Hidden runtime files outside it and binds original bytes", async () => {
    const result = await validate();
    expect(files.get("dist/index.html")).toEqual(html);
    expect(files.has(".evolution/runtime/browser-cases.json")).toBe(true);
    expect([...files.keys()].filter((path) => path.startsWith("dist/"))).toEqual(["dist/index.html"]);
    expect(files.has(".evolution/runtime/static-server.mjs")).toBe(false);
    const preview = commands.find((command) => command.detached);
    expect(preview?.args).toEqual(["/vercel/sandbox/.evolution/runtime/static-server.mjs", "dist", "4173"]);
    expect(commands.some((command) => command.args[0]?.endsWith("browser-runner.mjs"))).toBe(true);
    expect(result.previewHealthy).toBe(true);
    expect(result.results[0]!.verificationStatus).toBe("verified");
    expect(result.artifactHash).toBe(expectedSha256);
    expect(stop).toHaveBeenCalledOnce();
  });
  it("retains screenshot-only or incomplete browser evidence as partial", async () => {
    state.status = "partial";
    const result = await validate();
    expect(result.previewHealthy).toBe(true);
    expect(result.results[0]!.verificationStatus).toBe("partial");
  });
});