import { beforeEach, describe, expect, it } from "vitest";
import { isCoolingDown, noteRouteFailure, noteRouteSuccess, orderModelCandidates, resetModelHealth } from "./model-health";

describe("model-health · 失败冷却与路由排序", () => {
  beforeEach(() => resetModelHealth());

  it("单次失败不进冷却；窗口内连续失败到阈值才降权", () => {
    noteRouteFailure("c1", "bad");
    expect(isCoolingDown("c1", "bad")).toBe(false);
    noteRouteFailure("c1", "bad");
    expect(isCoolingDown("c1", "bad")).toBe(true);
  });

  it("成功一次即清除失败记忆", () => {
    noteRouteFailure("c1", "m");
    noteRouteFailure("c1", "m");
    expect(isCoolingDown("c1", "m")).toBe(true);
    noteRouteSuccess("c1", "m");
    expect(isCoolingDown("c1", "m")).toBe(false);
  });

  it("超过失败窗口的旧失败不再计入冷却", () => {
    const t0 = 1_000_000;
    noteRouteFailure("c1", "m", t0);
    noteRouteFailure("c1", "m", t0 + 1_000);
    expect(isCoolingDown("c1", "m", t0 + 2_000)).toBe(true);
    // 6 分钟后（窗口 5 分钟）：旧失败过期，不再冷却。
    expect(isCoolingDown("c1", "m", t0 + 6 * 60_000)).toBe(false);
  });

  it("排序：冷却中的模型降到链尾，健康的按实测延迟升序", () => {
    noteRouteFailure("c1", "slow");
    noteRouteFailure("c1", "slow"); // slow 进入冷却
    const latency = { fast: 120, mid: 400 };
    // primary=slow（冷却）应让位；其余按延迟 fast < mid，未测过的 keep 排最后。
    const ordered = orderModelCandidates("c1", ["slow", "mid", "fast", "keep"], latency);
    expect(ordered[0]).toBe("fast");
    expect(ordered[1]).toBe("mid");
    expect(ordered[2]).toBe("keep");
    expect(ordered[ordered.length - 1]).toBe("slow");
  });

  it("全部冷却时保持原序，宁可重试也不瘫掉", () => {
    noteRouteFailure("c1", "a"); noteRouteFailure("c1", "a");
    noteRouteFailure("c1", "b"); noteRouteFailure("c1", "b");
    expect(orderModelCandidates("c1", ["a", "b"], undefined)).toEqual(["a", "b"]);
  });

  it("主模型健康时稳居首位，不被延迟更低的备用模型抢位", () => {
    const ordered = orderModelCandidates("c1", ["primary", "faster"], { primary: 500, faster: 100 });
    expect(ordered[0]).toBe("primary");
  });
});
