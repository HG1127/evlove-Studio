import { describe, expect, it } from "vitest";
import { experimentRecoveryFixture } from "@evolution/testkit";
import { baselineReadiness } from "./baseline-readiness";
describe("physical Artifact browser Baseline readiness", () => {
  it("counts uniquely identified verified external observations as executable Baseline cases", () => {
    const p = experimentRecoveryFixture().project;
    expect(baselineReadiness(p)).toMatchObject({ ready: true, planned: 1, returned: 1, verified: 1, evidenceCoverage: 100, deferred: 0 });
  });
  it.each(["unverified", "failed", "partial"] as const)("does not call an all-%s external Baseline ready", status => {
    const p = experimentRecoveryFixture().project; p.baselineRun.runs[0]!.verificationStatus = status;
    expect(baselineReadiness(p).ready).toBe(false);
  });
  it("does not hide a missing external case behind verified semantic cases", () => {
    const p = experimentRecoveryFixture().project;
    p.evalSuite.push({ ...p.evalSuite[0]!, id: "V2", executionMode: "artifact-runtime" });
    p.baselineRun.runs = [{ ...p.baselineRun.runs[0]!, testCaseId: "V2" }];
    expect(baselineReadiness(p)).toMatchObject({ ready: false, planned: 2, returned: 1 });
  });
  it("rejects duplicated browser observations", () => {
    const p = experimentRecoveryFixture().project; p.baselineRun.runs.push({ ...p.baselineRun.runs[0]! });
    expect(baselineReadiness(p)).toMatchObject({ ready: false, verified: 0, returned: 0 });
  });
  it("continues to defer manual and visual checks without fabricating observations", () => {
    const p = experimentRecoveryFixture().project;
    p.evalSuite.push({ ...p.evalSuite[0]!, id: "manual", executionMode: "manual" }, { ...p.evalSuite[0]!, id: "visual", executionMode: "visual-review" });
    expect(baselineReadiness(p)).toMatchObject({ ready: true, planned: 1, deferred: 2 });
  });
});
