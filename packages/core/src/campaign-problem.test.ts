import { describe, expect, it } from "vitest";
import type { EvolveProject, EvaluationResult } from "@evolution/contracts";
import { baselineRubricProblem } from "./campaign-problem";

function fixture(scores: NonNullable<EvaluationResult["criterionScores"]>): EvolveProject {
  return {
    acceptanceRubric: [
      { id: "A", title: "A", minScore: 80, hardGate: true, weight: 70, category: "outcome", artifactIds: [] },
      { id: "B", title: "B", minScore: 80, hardGate: false, weight: 30, category: "quality", artifactIds: [] },
    ],
    baselineRun: { result: { criterionScores: scores } },
  } as unknown as EvolveProject;
}

const score = (criterionId: string, value: number) => ({
  criterionId, score: value, pass: false, verificationStatus: "verified" as const,
  evidence: ["measured"], gaps: [], testCaseIds: ["H1"],
});

describe("baseline rubric problem identity", () => {
  it("does not promote an ambiguous hard-gate score to a measured problem", () => {
    for (const rows of [[score("A", 20), score("A", 60)], [score("A", 60), score("A", 20)]]) {
      const selected = baselineRubricProblem(fixture([...rows, score("B", 65)]));
      expect(selected?.id).toBe("rubric-problem-B");
    }
  });

  it("keeps the problem pending when every claimed failure has duplicate identity", () => {
    expect(baselineRubricProblem(fixture([score("A", 20), score("A", 50)]))).toBeUndefined();
  });
});
