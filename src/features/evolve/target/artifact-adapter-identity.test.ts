import { describe, expect, it, vi } from "vitest";
import { demoProject } from "../data/mock-project";
import { artifactTargetAdapter } from "./artifact-adapter";

vi.mock("../ai/service", () => ({
  runEvolveAi: vi.fn(async () => ({ results: [{ testCaseId: "T1", output: "observed", trace: [] }] })),
}));

describe("Artifact batch adapter identity", () => {
  it("keeps an omitted AI Test Case unverified instead of reporting a product failure", async () => {
    const testCases = demoProject.evalSuite.slice(0, 2).map((testCase, index) => ({
      ...testCase, id: `T${index + 1}`, criterionIds: [], executionMode: "artifact-runtime" as const,
    }));
    const results = await artifactTargetAdapter.runBatch?.({ project: demoProject, testCases });
    expect(results?.map((item) => item.testCaseId)).toEqual(["T1", "T2"]);
    expect(results?.[0]?.verificationStatus).toBe("verified");
    expect(results?.[1]).toMatchObject({ verificationStatus: "unverified", output: expect.stringContaining("未返回") });
    expect(results?.[1]?.error).toBe("batch executor missing result");
  });
});
