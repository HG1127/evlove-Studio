import { describe, expect, it } from "vitest";
import { abortRunScope, beginRunScope, endRunScope, getActiveAbortSignal, isRunScopeAborted } from "./abort-scope";
import { EvolutionCampaignSchema } from "../schemas";

describe("abort-scope · 打断作用域", () => {
  it("暂停时活跃信号被中止，作用域结束后可重开新的", () => {
    beginRunScope("p1");
    const signal = getActiveAbortSignal();
    expect(signal?.aborted).toBe(false);
    expect(abortRunScope("p1")).toBe(true);
    expect(isRunScopeAborted("p1")).toBe(true);
    expect(signal?.aborted).toBe(true);
    endRunScope("p1");
    expect(isRunScopeAborted("p1")).toBe(false);
    expect(getActiveAbortSignal()).toBeUndefined();
  });

  it("没有运行中的作用域时 abort 返回 false，不误伤", () => {
    expect(abortRunScope("nope")).toBe(false);
  });
});

describe("campaign checkpoint · 轮内断点", () => {
  it("无断点字段也能解析（旧数据兼容）", () => {
    const parsed = EvolutionCampaignSchema.parse({});
    expect(parsed.checkpoint).toBeUndefined();
  });

  it("断点记录轮次与已完成阶段", () => {
    const parsed = EvolutionCampaignSchema.parse({ checkpoint: { round: 3, completedPhase: "plan", at: "2026-09-11T00:00:00.000Z" } });
    expect(parsed.checkpoint?.round).toBe(3);
    expect(parsed.checkpoint?.completedPhase).toBe("plan");
  });
});
