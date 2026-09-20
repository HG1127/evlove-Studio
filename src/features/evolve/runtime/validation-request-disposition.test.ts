import { describe, expect, it } from "vitest";
import { validationRequestDisposition } from "./use-project-runtime";

describe("validation recheck request routing", () => {
  it("runs immediately when the runtime is idle", () => {
    expect(validationRequestDisposition({ busy:false }, "paused")).toBe("run-now");
  });

  it("does not duplicate a validation that is already running", () => {
    expect(validationRequestDisposition({ busy:true, label:"运行 Hidden Validation" }, "paused")).toBe("already-running");
    expect(validationRequestDisposition({ busy:true, phase:"Gate F · Artifact Acceptance" }, "paused")).toBe("already-running");
  });

  it("pauses an active campaign and queues the requested validation", () => {
    expect(validationRequestDisposition({ busy:true, label:"运行一轮 Evolution Search" }, "running")).toBe("pause-campaign-and-queue");
  });

  it("queues behind a different non-campaign task", () => {
    expect(validationRequestDisposition({ busy:true, label:"重新深度解析输入" }, "paused")).toBe("queue-after-current");
  });
});
