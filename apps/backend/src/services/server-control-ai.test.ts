// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireServerControlAi, runServerControlAi, ServerControlAiUnavailableError } from "./server-control-ai";

const mocks = vi.hoisted(() => ({ probe: vi.fn(), passive: vi.fn(), ai: vi.fn() }));
vi.mock("./server-ai-health", () => ({ probeServerAiRuntime: mocks.probe, getPassiveServerAiHealth: mocks.passive }));
vi.mock("./ai-gateway", async (original) => ({ ...await original<typeof import("./ai-gateway")>(), runServerAi: mocks.ai }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.probe.mockResolvedValue({ configured: true, ready: true, status: "ready" });
  mocks.passive.mockResolvedValue({ configured: true, ready: false, status: "not-checked" });
});
describe("Workflow control AI boundary", () => {
  it("executes the actual business task despite a stale separate health probe", async () => {
    mocks.probe.mockResolvedValue({ configured: true, ready: false, status: "error", reasonCode: "runtime-error" });
    const actual = { intentRestatement: "Verified actual task" };
    mocks.ai.mockResolvedValue(actual);
    expect(await runServerControlAi("understand", { original: "grounded input" })).toEqual(actual);
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.passive).toHaveBeenCalledOnce();
    expect(mocks.ai).toHaveBeenCalledOnce();
  });
  it("records missing configuration as a capability error", async () => {
    mocks.passive.mockResolvedValue({ configured: false, ready: false, status: "unconfigured" });
    await expect(requireServerControlAi()).rejects.toMatchObject({ reasonCode: "not-configured" });
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("keeps unknown probe errors out of the capability classification", async () => {
    mocks.probe.mockResolvedValue({ ready: false, status: "error", reasonCode: "runtime-error", message: "private provider text" });
    const error = await requireServerControlAi({ force: true }).catch((caught) => caught);
    expect(error).not.toBeInstanceOf(ServerControlAiUnavailableError);
    expect(error.message).not.toContain("private provider text");
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it.each([401, 402, 403, 429, 503])("handles availability loss after the probe (%s) without leaking provider text", async (status) => {
    mocks.ai.mockRejectedValue(Object.assign(new Error("sensitive provider response"), { status }));
    const error = await runServerControlAi("understand", {}).catch((caught) => caught);
    expect(error).toBeInstanceOf(ServerControlAiUnavailableError);
    expect(error.message).not.toContain("sensitive provider response");
  });
  it("keeps ordinary model contract/runtime exceptions retryable", async () => {
    const failure = new Error("schema invalid");
    mocks.ai.mockRejectedValue(failure);
    await expect(runServerControlAi("understand", {})).rejects.toBe(failure);
  });
  it("continues real operations after health is restored, preserving media and result", async () => {
    const value = { summary: "result" };
    mocks.ai.mockResolvedValue(value);
    const payload = { input: "input" }, media = { imageDataUrls: ["test-image"] };
    expect(await runServerControlAi("visual-judge", payload, media)).toBe(value);
    expect(mocks.ai).toHaveBeenCalledWith("visual-judge", payload, media);
  });
});
