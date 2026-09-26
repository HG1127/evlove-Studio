import { describe, expect, it } from "vitest";
import { indexScopedTestCaseResults } from "./test-case-result-identity";

describe("batch Test Case result identity", () => {
  it("ignores another batch's extra row regardless of response completion order", () => {
    const a = { requestedTestCaseIds: ["A"], results: [{ testCaseId: "A", value: 80 }, { testCaseId: "B", value: 100 }] };
    const b = { requestedTestCaseIds: ["B"], results: [{ testCaseId: "B", value: 20 }] };
    for (const batches of [[a, b], [b, a]]) {
      const indexed = indexScopedTestCaseResults(batches);
      expect(indexed.byId.get("A")?.value).toBe(80);
      expect(indexed.byId.get("B")?.value).toBe(20);
      expect(indexed.duplicateIds.size).toBe(0);
    }
  });

  it("removes a repeated requested row while retaining independent results", () => {
    const indexed = indexScopedTestCaseResults([{ requestedTestCaseIds: ["A", "B"], results: [
      { testCaseId: "A", value: 100 }, { testCaseId: "A", value: 0 }, { testCaseId: "B", value: 80 },
    ] }]);
    expect(indexed.byId.has("A")).toBe(false);
    expect(indexed.duplicateIds.has("A")).toBe(true);
    expect(indexed.byId.get("B")?.value).toBe(80);
  });
});
