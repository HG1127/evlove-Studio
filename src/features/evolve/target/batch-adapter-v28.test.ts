import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { semanticEvidenceStatus } from "./artifact-adapter";
import { mockTargetAdapter } from "./mock-adapter";

describe("V2.8 batch target execution", () => {
  it("returns one ordered result for every test case", async () => {
    const cases = demoProject.evalSuite.slice(0, 3);
    const results = await mockTargetAdapter.runBatch?.({ project: demoProject, testCases: cases });
    expect(results?.map((item) => item.testCaseId)).toEqual(cases.map((item) => item.id));
  });
});

it("does not label an unavailable or historically grounded semantic answer as verified", () => {
  expect(semanticEvidenceStatus("UNVERIFIED: browser needed")).toBe("unverified");
  expect(semanticEvidenceStatus("diagnosis.trace[4]: body字号不足")).toBe("unverified");
  expect(semanticEvidenceStatus(" ")).toBe("unverified");
  expect(semanticEvidenceStatus("PASS: 保护项1已验证，保护项2 UNVERIFIED")).toBe("partial");
  expect(semanticEvidenceStatus("快照正文包含 body {font-size:16px}")).toBe("verified");
});
