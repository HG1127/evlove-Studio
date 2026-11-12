import { describe, expect, it } from "vitest";
import { buildArtifactRepairMemory } from "./artifact-repair-memory";

describe("artifact repair memory", () => {
  it("identifies repeated failed mutation families without exposing raw failure content", () => {
    const memory = buildArtifactRepairMemory([
      { round: 1, kind: "failure", score: 52, safety: "FAIL", failures: ["PRIVATE-TEST-PROMPT"], patches: [{ component: "prompt", operation: "update", target: "tone" }] },
      { round: 2, kind: "failure", score: 55, safety: "FAIL", failures: ["ANOTHER-PRIVATE-TEST"], patches: [{ component: " Prompt ", operation: "Update", target: "tone" }] },
      { round: 3, kind: "champion", score: 91, safety: "PASS", failures: [], patches: [{ component: "workflow", operation: "add", target: "retry stage" }], repairReflection: { parentCandidateId:"c2",rootCause:"a root cause",failureCaseIds:["F1"],mutationRationale:"a causal change",antiPatternsAvoided:["prompt:update:tone"] } },
    ]);
    expect(memory.antiPatterns).toEqual([expect.objectContaining({ family: "prompt:update:tone", attempts: 2, failures: 2 })]);
    expect(memory.recent).toHaveLength(3);
    expect(memory.reflections).toHaveLength(1);
    expect(memory.reflections[0]?.antiPatternsAvoided).toContain("prompt:update:tone");
    expect(JSON.stringify(memory)).not.toMatch(/PRIVATE-TEST-PROMPT|ANOTHER-PRIVATE-TEST/);
    expect(memory.privacy).toContain("No hidden holdout prompts");
  });
  it("bounds recent history and handles an empty archive", () => {
    const entries = Array.from({ length: 12 }, (_, round) => ({
      round, kind: "stepping-stone", score: 70, safety: "PASS", failures: [],
      patches: [{ component: "code", operation: "update", target: "src/router.ts" }],
    }));
    expect(buildArtifactRepairMemory(entries).recent).toHaveLength(8);
    expect(buildArtifactRepairMemory([]).recent).toEqual([]);
  });
});