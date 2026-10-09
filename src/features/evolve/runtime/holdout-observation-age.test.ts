import { expect, it, vi } from "vitest";
import { demoProject } from "../data/mock-project";
import { clearRoundCaches, getHoldoutBaseline, setHoldoutBaseline } from "./round-cache";

it("rejudging cached baseline evidence cannot renew its observation lifetime", () => {
  clearRoundCaches();
  const at = Date.parse("2026-10-09T03:00:00Z");
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  try {
    setHoldoutBaseline("live-age", { fingerprint: "same", suiteIds: [], runs: [], evaluation: demoProject.baselineRun.result! });
    const first = getHoldoutBaseline("live-age", "same", 10 * 60_000)!;
    expect(first.observedAt).toBe(at);
    clock.mockReturnValue(at + 5 * 60_000);
    setHoldoutBaseline("live-age", { ...first, evaluation: { ...first.evaluation, accuracy: 99 } });
    expect(getHoldoutBaseline("live-age", "same", 10 * 60_000)?.observedAt).toBe(at);
    clock.mockReturnValue(at + 10 * 60_000);
    expect(getHoldoutBaseline("live-age", "same", 10 * 60_000)).toBeUndefined();
  } finally { clock.mockRestore(); clearRoundCaches(); }
});
