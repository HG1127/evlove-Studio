import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import { compactProblemAnalysisInput } from "./problem-analysis-input";

function oversizedInput() {
  const marker = "SCREENSHOT_BYTES_MUST_NOT_LEAK";
  const baseline = {
    ...demoProject.baselineRun,
    runs: [
      { testCaseId: "failed", output: "Failure: navigation does not open. ".repeat(3000), latencyMs: 12, cost: 0,
        verificationStatus: "failed" as const, error: "Navigation click failed", trace: [{ id: "trace-1", stage: "click", status: "fail" as const, summary: "Menu did not open" }],
        screenshots: [{ name: "failure.png", width: 800, height: 600, artifactHash: "hash", dataUrl: `${marker}${"a".repeat(2_000_000)}` }] },
      { testCaseId: "passed", output: "Pass", latencyMs: 10, cost: 0, verificationStatus: "verified" as const, trace: [] },
    ],
  };
  const archive = [{ round: 1, kind: "failure", niche: "navigation", score: 0,
    candidate: { id: "old", name: "Old candidate", change: "Old navigation edit", artifactSnapshots: [{ content: "OLD_SNAPSHOT_BODY".repeat(100_000) }] },
    reason: "Did not improve navigation" }] as unknown as EvolveProject["evolutionArchive"];
  return { marker, input: {
    project: { aiProfile: demoProject.aiProfile, goal: demoProject.goal,
      sourceArtifacts: [{ id: "html", role: "target", name: "guide.html", artifactKind: "document", textContent: "HTML_SOURCE".repeat(100_000),
        structuredContent: { raw: "STRUCTURED_BODY".repeat(100_000) }, originalChars: 1_100_000 }],
      baselineRun: baseline },
    previousRounds: demoProject.roundHistory,
    archive,
  } };
}

describe("problem-analysis input budget", () => {
  it("keeps failure evidence while excluding screenshot bytes and historical snapshots", () => {
    const { input, marker } = oversizedInput();
    const compact = compactProblemAnalysisInput(input);
    const serialized = JSON.stringify(compact);
    expect(serialized.length).toBeLessThanOrEqual(24_000);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain("OLD_SNAPSHOT_BODY");
    expect(serialized).not.toContain("STRUCTURED_BODY");
    expect(serialized).toContain("Navigation click failed");
    expect(compact.baseline?.runs[0]?.testCaseId).toBe("failed");
    expect(compact.baseline?.runs[0]?.screenshotCount).toBe(1);
    expect(compact.baseline?.contextCoverage.omittedScreenshotBytes).toBe(true);
    expect(compact.project.sourceArtifacts[0]?.role).toBe("target");
  });

  it("fails locally when even the smallest evidence summary exceeds the available budget", () => {
    const { input } = oversizedInput();
    expect(() => compactProblemAnalysisInput(input, 500)).toThrow(/输入预算/);
  });
});
