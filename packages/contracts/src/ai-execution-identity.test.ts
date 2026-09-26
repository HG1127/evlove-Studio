import { describe, expect, it } from "vitest";
import { ExecuteArtifactBatchAiResultSchema } from "./ai-schemas";

const row = (testCaseId: string) => ({ testCaseId, output: "observed", trace: [] });

describe("Artifact batch AI result identity", () => {
  it("accepts one result per Test Case", () => {
    expect(ExecuteArtifactBatchAiResultSchema.safeParse({ results: [row("A"), row("B")] }).success).toBe(true);
  });

  it("rejects repeated Test Case rows before local adapter normalization", () => {
    const parsed = ExecuteArtifactBatchAiResultSchema.safeParse({ results: [row("A"), row("A")] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["results", 1, "testCaseId"]);
  });
});
