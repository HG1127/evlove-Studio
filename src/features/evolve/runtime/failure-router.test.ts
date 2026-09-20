import { describe, expect, it } from "vitest";
import { classifyRuntimeFailure } from "./failure-router";

describe("failure router", () => {
  it("auto-retries clearly transient provider failures", () => {
    const result = classifyRuntimeFailure(new Error("429 rate limit, please retry"));
    expect(result.kind).toBe("transient-system");
    expect(result.retryable).toBe(true);
    expect(result.maxAttempts).toBeGreaterThan(1);
  });

  it("does not pretend missing Runner capability is a product failure", () => {
    const result = classifyRuntimeFailure(new Error("需要真实 Runner / E2E 验证"));
    expect(result.kind).toBe("capability");
    expect(result.retryable).toBe(false);
  });

  it("does not auto-retry high-impact production actions", () => {
    const result = classifyRuntimeFailure(new Error("生产发布需要授权"));
    expect(result.kind).toBe("safety");
    expect(result.retryable).toBe(false);
  });
});

