import { describe, expect, it } from "vitest";
import { BACKEND_REQUIREMENTS, EVOLUTION_PHASES, deriveEngineReadiness } from "./system-readiness";

describe("system readiness catalog", () => {
  it("covers all 23 workflow nodes exactly once", () => {
    const ids = EVOLUTION_PHASES.flatMap((phase) => {
      const [start, end] = phase.range;
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    });
    expect(ids).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
  });

  it("keeps critical backend gaps explicit", () => {
    const p0 = BACKEND_REQUIREMENTS.filter((item) => item.priority === "P0").map((item) => item.id);
    expect(p0).toEqual(expect.arrayContaining(["control-plane", "git-target", "sandbox", "release"]));
  });

  it("does not report release/build ready without real runner capabilities", () => {
    const engines = deriveEngineReadiness({ runner: { htmlBrowser: true, screenshots: true, e2e: true, build: false, release: false }, visualJudgeLive: true });
    expect(engines.find((item) => item.id === "experiment")?.state).toBe("partial");
    expect(engines.find((item) => item.id === "release")?.state).toBe("backend");
  });
});
