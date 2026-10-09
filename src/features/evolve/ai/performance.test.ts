import { beforeEach, describe, expect, it } from "vitest";
import { clearAiResultCache, getCachedAiResult, setCachedAiResult } from "./performance";

describe("AI result cache", () => {
  it("does not reuse persisted results decoded under the old envelope policy",()=>{
    const payload={query:"same"};setCachedAiResult("understand","x",payload,{ok:true});
    const entries=window.localStorage.getItem("evolve-studio:ai-result-cache:v2.9")!;clearAiResultCache();
    window.localStorage.setItem("evolve-studio:ai-result-cache:v2.8",entries);
    expect(getCachedAiResult("understand","x",payload)).toBeUndefined();
    window.localStorage.removeItem("evolve-studio:ai-result-cache:v2.8");
  });
  beforeEach(() => clearAiResultCache());

  it("reuses an exact cached result and clears it explicitly", () => {
    const payload = { project: { id: "p1" }, query: "same" };
    setCachedAiResult("understand", "m1", payload, { ok: true });
    expect(getCachedAiResult<{ ok: boolean }>("understand", "m1", payload)).toEqual({ ok: true });
    clearAiResultCache();
    expect(getCachedAiResult("understand", "m1", payload)).toBeUndefined();
  });
});
