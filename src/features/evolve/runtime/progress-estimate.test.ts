import { describe, expect, it } from "vitest";
import { displayProgress } from "./progress-estimate";

describe("displayProgress", () => {
  it("AI 等待期间持续增长但不到 100%", () => {
    const early = displayProgress({ busy: true, phase: "生成项目专属测试", done: 0, total: 1, elapsedSeconds: 10 });
    const later = displayProgress({ busy: true, phase: "生成项目专属测试", done: 0, total: 1, elapsedSeconds: 90 });
    expect(early.estimated).toBe(true);
    expect(later.percent).toBeGreaterThan(early.percent);
    expect(displayProgress({ busy: true, phase: "生成项目专属测试", done: 0, total: 1, elapsedSeconds: 9999 }).percent).toBe(90);
  });

  it("有真实分项时使用真实进度", () => {
    expect(displayProgress({ busy: true, done: 3, total: 8, percent: 38, elapsedSeconds: 20 })).toEqual({
      percent: 38, estimated: false, caption: "3/8 项完成", etaSeconds: undefined,
    });
  });
});
