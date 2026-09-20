// 覆盖运行登记的存活规则：刷新被打断要能续跑、心跳新鲜说明别处还在跑不能抢跑、
// 「自动运行到下个 Gate」开关与运行状态镜像跨挂载存活。
import { afterEach, describe, expect, it } from "vitest";
import {
  beginRunTask,
  endRunTask,
  getAutoGateFlag,
  getLiveRun,
  getLiveStatus,
  getRunTask,
  heartbeatRunTask,
  markAllTasksInterrupted,
  publishLiveStatus,
  setAutoGateFlag,
  shouldResumeTask,
} from "./run-manager";

afterEach(() => {
  localStorage.clear();
});

describe("run task registry", () => {
  it("records a task and clears it when the run ends", () => {
    beginRunTask("p1", { kind: "action", actionId: "plan", label: "AI 生成进化方案" });
    const task = getRunTask("p1");
    expect(task?.kind).toBe("action");
    expect(task?.actionId).toBe("plan");
    endRunTask("p1");
    expect(getRunTask("p1")).toBeUndefined();
  });

  it("does not resume a task whose heartbeat is still fresh (run alive elsewhere)", () => {
    beginRunTask("p1", { kind: "campaign", label: "运行一轮 Evolution Search" });
    expect(shouldResumeTask(getRunTask("p1")!)).toBe(false);
  });

  it("resumes immediately after the page was refreshed/closed (interrupted mark)", () => {
    beginRunTask("p1", { kind: "campaign", label: "运行一轮 Evolution Search" });
    markAllTasksInterrupted();
    expect(shouldResumeTask(getRunTask("p1")!)).toBe(true);
  });

  it("resumes when the heartbeat went stale (runner disappeared)", () => {
    beginRunTask("p1", { kind: "action", actionId: "baseline", label: "运行 Baseline" });
    const stale = Date.now() + 60_000;
    expect(shouldResumeTask(getRunTask("p1")!, stale)).toBe(true);
  });

  it("heartbeat clears the interrupted flag so a live runner is not double-resumed", () => {
    beginRunTask("p1", { kind: "action", actionId: "plan", label: "x" });
    markAllTasksInterrupted();
    heartbeatRunTask("p1");
    expect(getRunTask("p1")?.interrupted).toBe(false);
  });
});

describe("auto-run-to-gate flag", () => {
  it("persists per project and clears on disable", () => {
    setAutoGateFlag("p1", true);
    setAutoGateFlag("p2", false);
    expect(getAutoGateFlag("p1")).toBe(true);
    expect(getAutoGateFlag("p2")).toBe(false);
    setAutoGateFlag("p1", false);
    expect(getAutoGateFlag("p1")).toBe(false);
  });
});

describe("live status mirror", () => {
  it("getLiveRun only reports busy runs; getLiveStatus reports the last published state", () => {
    publishLiveStatus("p1", { busy: true, label: "运行 Baseline · 3/10 题" });
    expect(getLiveRun("p1")?.label).toContain("Baseline");
    expect(getLiveStatus("p1")?.busy).toBe(true);
    publishLiveStatus("p1", { busy: false, message: "运行 Baseline完成" });
    expect(getLiveRun("p1")).toBeUndefined();
    expect(getLiveStatus("p1")?.message).toContain("完成");
  });
});
