import { describe, expect, it } from "vitest";
import type { EvolveProject } from "@evolution/contracts";
import { baselineReadiness, reusableBaselineRuns } from "./baseline-readiness";

function fixture(): EvolveProject {
  const run = (testCaseId: string) => ({ testCaseId, output: "measured", latencyMs: 1, cost: 0, trace: [], verificationStatus: "verified" as const });
  return {
    targetConnection: { adapter: "artifact" },
    acceptanceRubric: [{ id: "A" }, { id: "B" }],
    evalSuite: [
      { id: "T1", criterionIds: ["A"], executionMode: "artifact-runtime" },
      { id: "T2", criterionIds: ["B"], executionMode: "artifact-runtime" },
    ],
    baselineRun: {
      status: "completed", measurementFingerprint: "same", runs: [run("T1"), run("T2")],
      result: { demoJudged: false, criterionScores: [
        { criterionId: "A", score: 90, pass: true, verificationStatus: "verified" },
        { criterionId: "B", score: 90, pass: true, verificationStatus: "verified" },
      ] },
    },
  } as unknown as EvolveProject;
}

describe("baseline evidence identity", () => {
  it("counts only unique Test Case runs toward coverage", () => {
    const project = fixture();
    expect(baselineReadiness(project).ready).toBe(true);
    project.baselineRun.runs = [project.baselineRun.runs[0]!, { ...project.baselineRun.runs[0]! }];
    const readiness = baselineReadiness(project);
    expect(readiness.ready).toBe(false);
    expect(readiness.returned).toBe(0);
    expect(readiness.evidenceCoverage).toBe(0);
    expect(readiness.blockers.join(" ")).toContain("执行结果 ID 重复：T1");
    expect(reusableBaselineRuns(project, "same", true)).toEqual([]);
  });

  it("rejects duplicate Test Case definitions even when a matching Run exists", () => {
    const project = fixture();
    project.evalSuite[1] = { ...project.evalSuite[0]! };
    const readiness = baselineReadiness(project);
    expect(readiness.ready).toBe(false);
    expect(readiness.returned).toBe(0);
    expect(readiness.blockers.join(" ")).toContain("验收题 ID 重复：T1");
    expect(reusableBaselineRuns(project, "same", true).map((run) => run.testCaseId)).not.toContain("T1");
  });

  it("does not reuse a verified Run whose mapped Criterion score is duplicated", () => {
    const project = fixture();
    project.baselineRun.result!.criterionScores!.push({ ...project.baselineRun.result!.criterionScores![0]! });
    expect(reusableBaselineRuns(project, "same", true).map((run) => run.testCaseId)).toEqual(["T2"]);
  });
});
