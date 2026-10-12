import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "../data/mock-project";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { AutonomousEvolutionPanel } from "./autonomous-evolution-panel";
const m = vi.hoisted(() => ({ load: vi.fn(), retry: vi.fn(), unavailable: class extends Error {} }));
vi.mock("../runtime/server-failed-control-retry", () => ({ loadServerFailedControlRetry: m.load, retryServerFailedControl: m.retry, ServerFailedControlRetryUnavailableError: m.unavailable }));
const target = { missionId: "mission", jobId: "control-old", runId: "run-old" };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  m.load.mockReset().mockResolvedValue(target); m.retry.mockReset().mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const retryButton = () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("重试后台执行"));
function runtime(busy = false) {
  return { project: { ...structuredClone(demoProject), id: "mission", updatedAt: "2026-10-12T03:00:00.000Z", stage: "plan",
    campaign: { ...structuredClone(demoProject.campaign), status: "running" } }, status: { busy },
    runAutoPilot: vi.fn(), resumeAutonomousEvolution: vi.fn(), pauseCampaign: vi.fn(), commit: vi.fn(), setStage: vi.fn() } as unknown as ProjectRuntime;
}
async function render(value = runtime()) {
  await act(async () => root.render(<AutonomousEvolutionPanel runtime={value} onOpenSource={vi.fn()} onOpenOutputs={vi.fn()} onOpenAdvanced={vi.fn()} onOpenRuntime={vi.fn()}/>));
  return value;
}
describe("main panel explicit backend execution recovery", () => {
  it("offers an explicit retry for confirmed failure while stored campaign remains running", async () => {
    const value = await render(), snapshot = structuredClone(value.project);
    expect(retryButton()).toBeDefined(); expect(host.textContent).toContain("后台执行已失败或已取消");
    expect(host.querySelector("h2")?.textContent).toBe("后台执行已中断");
    expect(host.querySelector(".animate-spin")).toBeNull();
    expect([...host.querySelectorAll("button")].some(button => button.textContent?.includes("暂停"))).toBe(false);
    expect(m.load).toHaveBeenCalledExactlyOnceWith(value.project); expect(m.retry).not.toHaveBeenCalled();
    expect(value.project).toEqual(snapshot); expect(value.pauseCampaign).not.toHaveBeenCalled(); expect(value.commit).not.toHaveBeenCalled();
  });
  it("submits once on a double click and keeps backend acceptance separate from completion", async () => {
    let complete!: () => void;
    m.retry.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    const value = await render(), retry = retryButton()!;
    await act(async () => { retry.click(); retry.click(); });
    expect(m.retry).toHaveBeenCalledExactlyOnceWith(value.project, target); expect(retry.disabled).toBe(true);
    expect(value.runAutoPilot).not.toHaveBeenCalled(); expect(value.resumeAutonomousEvolution).not.toHaveBeenCalled();
    await act(async () => complete());
    expect(host.textContent).toContain("新后台执行已提交"); expect(host.textContent).not.toContain("进化完成，等待你验收成果");
    expect(host.textContent).toContain("请查看实时运行状态"); expect(host.querySelector(".animate-spin")).toBeNull();
    expect([...host.querySelectorAll("button")].find(button => button.textContent?.includes("新后台执行已提交"))?.disabled).toBe(true);
  });
  it("shows server errors and allows the same explicit operation without a local fallback", async () => {
    m.retry.mockRejectedValueOnce(new Error("当前任务版本已变化，请刷新后重试"));
    const value = await render(); await act(async () => retryButton()!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("当前任务版本已变化");
    expect(retryButton()!.disabled).toBe(false); expect(host.textContent).not.toContain("新后台执行已提交");
    await act(async () => retryButton()!.click()); expect(m.retry).toHaveBeenCalledTimes(2);
    expect(m.retry.mock.calls[0]).toEqual(m.retry.mock.calls[1]);
    expect(value.runAutoPilot).not.toHaveBeenCalled(); expect(value.resumeAutonomousEvolution).not.toHaveBeenCalled();
    expect(value.pauseCampaign).not.toHaveBeenCalled(); expect(value.commit).not.toHaveBeenCalled();
  });
  it("withdraws the retry after click verification finds that it is no longer eligible", async () => {
    m.retry.mockRejectedValue(new m.unavailable("后台执行状态已变化或无法确认失败"));
    await render(); await act(async () => retryButton()!.click());
    expect(retryButton()).toBeUndefined();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("状态已变化");
    expect(host.querySelector("h2")?.textContent).not.toBe("后台执行已中断");
  });
  it("does not offer an execution retry for active, completed, missing or unknown controls", async () => {
    m.load.mockResolvedValue(undefined); await render();
    expect(retryButton()).toBeUndefined(); expect(m.retry).not.toHaveBeenCalled();
  });
  it("shows a metadata read error without starting or offering an unverified retry", async () => {
    m.load.mockRejectedValue(new Error("无法核验后台状态")); await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("无法核验后台状态");
    expect(retryButton()).toBeUndefined(); expect(m.retry).not.toHaveBeenCalled();
  });
  it("disables a confirmed retry while an explicit UI action is busy", async () => {
    await render(runtime(true)); expect(retryButton()!.disabled).toBe(true); expect(m.retry).not.toHaveBeenCalled();
  });
  it("ignores an old metadata result after the persisted Mission version changes", async () => {
    let complete!: (value: typeof target) => void;
    m.load.mockImplementationOnce(() => new Promise<typeof target>(resolve => { complete = resolve; })).mockResolvedValueOnce(undefined);
    const value = await render(); expect(retryButton()).toBeUndefined();
    await render({ ...value, project: { ...value.project, updatedAt: "2026-10-12T03:02:00.000Z" } });
    await act(async () => complete(target)); expect(retryButton()).toBeUndefined(); expect(m.retry).not.toHaveBeenCalled();
  });
  it("observes SDK failure without a Mission version change and never automatically starts", async () => {
    m.load.mockResolvedValueOnce(undefined).mockResolvedValue(target);
    const value = await render(), snapshot = structuredClone(value.project);
    expect(retryButton()).toBeUndefined();
    await act(async () => vi.advanceTimersByTimeAsync(14_999)); expect(m.load).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(m.load).toHaveBeenCalledTimes(2); expect(retryButton()).toBeDefined();
    expect(host.querySelector("h2")?.textContent).toBe("后台执行已中断");
    expect(value.project).toEqual(snapshot); expect(m.retry).not.toHaveBeenCalled();
    expect(value.runAutoPilot).not.toHaveBeenCalled(); expect(value.commit).not.toHaveBeenCalled();
  });
  it("allows one metadata read at a time and waits 15 seconds after completion", async () => {
    let complete!: (value: undefined) => void;
    m.load.mockImplementationOnce(() => new Promise<undefined>(resolve => { complete = resolve; })).mockResolvedValue(target);
    await render(); await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(m.load).toHaveBeenCalledTimes(1);
    await act(async () => complete(undefined));
    await act(async () => vi.advanceTimersByTimeAsync(14_999)); expect(m.load).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(m.load).toHaveBeenCalledTimes(2);
    expect(retryButton()).toBeDefined(); expect(m.retry).not.toHaveBeenCalled();
  });
  it("recovers from a permission or network read error without stacking requests", async () => {
    m.load.mockResolvedValueOnce(target).mockRejectedValueOnce(new Error("后台访问暂不可用")).mockResolvedValue(target);
    await render(); await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(m.load).toHaveBeenCalledTimes(2); expect(retryButton()).toBeUndefined();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("后台访问暂不可用");
    await act(async () => vi.advanceTimersByTimeAsync(14_999)); expect(m.load).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1)); expect(m.load).toHaveBeenCalledTimes(3);
    expect(retryButton()).toBeDefined(); expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(m.retry).not.toHaveBeenCalled();
  });
  it("cleans up the refresh timer on unmount", async () => {
    await render(); expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(m.load).toHaveBeenCalledTimes(1);
  });
  it("ignores an old Project object response and waits for it before reading the replacement", async () => {
    let complete!: (value: typeof target) => void;
    m.load.mockImplementationOnce(() => new Promise<typeof target>(resolve => { complete = resolve; }))
      .mockResolvedValueOnce(undefined).mockResolvedValue(target);
    const oldValue = await render();
    const newValue = { ...oldValue, project: { ...oldValue.project, name: "Updated projection" } };
    await render(newValue); expect(m.load).toHaveBeenCalledTimes(1);
    await act(async () => complete(target)); expect(retryButton()).toBeUndefined();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(m.load).toHaveBeenCalledTimes(2); expect(m.load.mock.calls[1]![0]).toBe(newValue.project);
    expect(retryButton()).toBeUndefined();
    await act(async () => vi.advanceTimersByTimeAsync(15_000)); expect(retryButton()).toBeDefined();
    expect(m.retry).not.toHaveBeenCalled();
  });
  it("keeps submission truthful until a distinct new Run is confirmed failed", async () => {
    const nextTarget = { ...target, jobId: "control-next", runId: "run-next" };
    m.load.mockResolvedValueOnce(target).mockResolvedValueOnce(undefined).mockResolvedValueOnce(target).mockResolvedValue(nextTarget);
    const value = await render(); await act(async () => retryButton()!.click());
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(host.querySelector("h2")?.textContent).toBe("新后台执行已提交");
    expect(host.textContent).toContain("请查看实时运行状态"); expect(retryButton()).toBeUndefined();
    expect(host.querySelector(".animate-spin")).toBeNull(); expect(m.retry).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(retryButton()).toBeDefined(); expect(host.querySelector("h2")?.textContent).toBe("后台执行已中断");
    expect(m.retry).toHaveBeenCalledTimes(1);
    await act(async () => retryButton()!.click()); expect(m.retry).toHaveBeenLastCalledWith(value.project, nextTarget);
  });
  it("does not read or automatically start while an explicit retry is in flight", async () => {
    let complete!: () => void;
    m.retry.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    await render(); await act(async () => retryButton()!.click());
    await act(async () => vi.advanceTimersByTimeAsync(45_000));
    expect(m.load).toHaveBeenCalledTimes(1); expect(m.retry).toHaveBeenCalledTimes(1);
    await act(async () => complete());
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(m.load).toHaveBeenCalledTimes(2); expect(host.querySelector("h2")?.textContent).toBe("新后台执行已提交");
    expect(m.retry).toHaveBeenCalledTimes(1);
  });
  it("retains a real start rejection across a successful metadata refresh", async () => {
    m.retry.mockRejectedValue(new Error("后台拒绝了重试请求"));
    await render(); await act(async () => retryButton()!.click());
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("后台拒绝了重试请求");
    expect(retryButton()!.disabled).toBe(false); expect(m.retry).toHaveBeenCalledTimes(1);
  });
});
