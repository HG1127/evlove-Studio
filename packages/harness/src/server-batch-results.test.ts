import { describe, expect, it } from "vitest";
import { indexUniqueBatchResults } from "./server-batch-results";

describe("server batch result identity", () => {
  it("keeps unique cases and rejects every repeated case regardless of ordering", () => {
    const first = { testCaseId: "A", output: "first" };
    const result = indexUniqueBatchResults([
      first,
      { testCaseId: "B", output: "valid" },
      { testCaseId: "A", output: "contradictory" },
      { testCaseId: "A", output: "third" },
    ]);
    expect(result.byId.get("A")).toBeUndefined();
    expect(result.duplicateIds).toEqual(new Set(["A"]));
    expect(result.byId.get("B")?.output).toBe("valid");
  });
});
