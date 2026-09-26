import { describe, expect, it } from "vitest";
import { indexScopedAcceptanceResults } from "./acceptance-result-identity";

describe("acceptance result identity", () => {
  it("ignores an extra result for another concurrent batch regardless of completion order", () => {
    const first = { requestedCriterionIds: ["A"], results: [{ criterionId: "A", score: 91 }, { criterionId: "B", score: 100 }] };
    const second = { requestedCriterionIds: ["B"], results: [{ criterionId: "B", score: 42 }] };
    for (const batches of [[first, second], [second, first]]) {
      const indexed = indexScopedAcceptanceResults(batches);
      expect(indexed.byId.get("A")?.score).toBe(91);
      expect(indexed.byId.get("B")?.score).toBe(42);
      expect(indexed.duplicateIds.size).toBe(0);
    }
  });

  it("removes repeated requested results without hiding unrelated results", () => {
    const indexed = indexScopedAcceptanceResults([{ requestedCriterionIds: ["A", "B"], results: [
      { criterionId: "A", score: 20 }, { criterionId: "A", score: 100 }, { criterionId: "B", score: 90 },
    ] }]);
    expect(indexed.byId.has("A")).toBe(false);
    expect(indexed.duplicateIds.has("A")).toBe(true);
    expect(indexed.byId.get("B")?.score).toBe(90);
  });
});
