import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimentRecoveryAt as at, experimentRecoveryWaitFixture } from "@evolution/testkit";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { AutonomousEvolutionPanel } from "./autonomous-evolution-panel";
const m = vi.hoisted(() => ({ mode: vi.fn(), retry: vi.fn() }));
vi.mock("../runtime/production-runtime", () => ({ productionRuntimeMode: m.mode }));
vi.mock("../runtime/server-experiment-retry", async (original) => ({ ...await original<typeof import("../runtime/server-experiment-retry")>(), retryStoredServerExperiment: m.retry }));
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  m.mode.mockReset().mockReturnValue("http"); m.retry.mockReset().mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const button = () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes("重试已保存的评审"));
async function render(busy = false) {
  const runtime = { project: experimentRecoveryWaitFixture(), status: { busy }, runAutoPilot: vi.fn(), resumeAutonomousEvolution: vi.fn() } as unknown as ProjectRuntime;
  await act(async () => root.render(<AutonomousEvolutionPanel runtime={runtime} onOpenSource={vi.fn()} onOpenOutputs={vi.fn()} onOpenAdvanced={vi.fn()} onOpenRuntime={vi.fn()}/>));
  return runtime;
}
describe("main Mission panel can retry the stored backend Experiment", () => {
  it("starts one backend request through the actual panel, even for repeated clicks", async () => {
    let complete!: () => void;
    m.retry.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    const runtime = await render(); const retry = button()!; expect(retry).toBeDefined();
    await act(async () => { retry.click(); retry.click(); });
    expect(m.retry).toHaveBeenCalledTimes(1); expect(retry.disabled).toBe(true);
    expect(runtime.runAutoPilot).not.toHaveBeenCalled(); expect(runtime.resumeAutonomousEvolution).not.toHaveBeenCalled();
    expect(host.textContent).toContain("AI 调用未完成");
    await act(async () => complete());
    expect(host.textContent).toContain("已交给后台继续"); expect(host.textContent).not.toContain("进化完成，等待你验收成果");
  });
  it("shows a real start error and allows retry without claiming completion", async () => {
    m.retry.mockRejectedValueOnce(new Error("需要配置后台访问"));
    await render(); await act(async () => button()!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("需要配置后台访问");
    expect(button()!.disabled).toBe(false); expect(host.textContent).not.toContain("已交给后台继续");
    await act(async () => button()!.click()); expect(m.retry).toHaveBeenCalledTimes(2);
  });
  it("does not offer a backend retry in browser-only mode", async () => {
    m.mode.mockReturnValue("local"); await render(); expect(button()).toBeUndefined(); expect(m.retry).not.toHaveBeenCalled();
  });
  it("does not offer another request while the Mission is busy", async () => {
    await render(true); expect(button()).toBeUndefined(); expect(m.retry).not.toHaveBeenCalled();
  });
});
