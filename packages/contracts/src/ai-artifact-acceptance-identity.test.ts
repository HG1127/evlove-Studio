import { describe, expect, it } from "vitest";
import { ArtifactAcceptanceAiResultSchema } from "./ai-schemas";

const row = (criterionId: string) => ({ criterionId, score: 90, pass: true, evidence: ["observed"], gaps: [] });
const response = (results: ReturnType<typeof row>[]) => ({
  overallScore: 90, coverageScore: 90, integrityScore: 90, pairwiseScore: 90,
  hardGatePass: true, results, summary: "checked",
});

describe("Artifact Acceptance AI identity boundary", () => {
  it("accepts unique Criterion rows", () => {
    expect(ArtifactAcceptanceAiResultSchema.safeParse(response([row("A"), row("B")])).success).toBe(true);
  });

  it("rejects duplicate Criterion rows before they can overwrite evidence", () => {
    const parsed = ArtifactAcceptanceAiResultSchema.safeParse(response([row("A"), row("A")]));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["results", 1, "criterionId"]);
  });
});
