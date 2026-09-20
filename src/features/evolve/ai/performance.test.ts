import { beforeEach, describe, expect, it } from "vitest";
import { clearAiResultCache, getCachedAiResult, setCachedAiResult } from "./performance";

describe("AI result cache", () => {
  beforeEach(() => clearAiResultCache());

  it("reuses an exact cached result and clears it explicitly", () => {
    const payload = { project: { id: "p1" }, query: "same" };
    setCachedAiResult("understand", "m1", payload, { ok: true });
    expect(getCachedAiResult<{ ok: boolean }>("understand", "m1", payload)).toEqual({ ok: true });
    clearAiResultCache();
    expect(getCachedAiResult("understand", "m1", payload)).toBeUndefined();
  });
});
