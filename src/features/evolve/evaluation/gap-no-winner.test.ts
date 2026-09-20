import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { ExperimentRunSchema } from "../schemas";
import { buildExperimentGapAdvicePayload, fallbackExperimentAdvice, experimentNeedsEvidenceRepair } from "./gap";

describe("无 Winner 优化闭环", () => {
  it("选择最接近胜出的候选并生成有证据的可执行建议", () => {
    const baseline = demoProject.baselineRun.result!;
    const experiment = ExperimentRunSchema.parse({
      id: "no-winner",
      status: "completed",
      summary: "候选未通过安全门槛",
      candidateResults: [{
        candidateId: "CAND-01",
        evaluation: { ...baseline, accuracy: baseline.accuracy - 8, completeness: baseline.completeness - 6, safety: "FAIL", failures: ["文本对比度不达标"] },
        runs: [],
        artifactSnapshots: [],
        experimentStage: "finalist",
      }],
    });
    const payload = buildExperimentGapAdvicePayload(demoProject, experiment);
    expect(payload.phase).toBe("visible-experiment-no-winner");
    expect(payload.closestCandidate?.candidateId).toBe("CAND-01");
    expect(payload.gap.dimensions.some((item) => item.exceeded)).toBe(true);

    const advice = fallbackExperimentAdvice(demoProject, experiment);
    expect(advice.overall).toContain("CAND-01");
    expect(advice.actions[0]).toMatchObject({ target: "Safety / Hard Gate" });
    expect(advice.actions.some((item) => item.detail.includes("落后"))).toBe(true);
  });
});

it("routes missing evidence to retesting without rewriting the candidate", () => {
  const experiment = ExperimentRunSchema.parse({ id: "evidence-gap", status: "completed", candidateResults: [{ candidateId: "C1", evaluation: { ...demoProject.baselineRun.result!, safety: "PASS", criterionScores: [{ criterionId: "READ", score: 0, pass: false, verificationStatus: "unverified", testCaseIds: [], evidence: [], gaps: ["missing test"] }] } }] });
  expect(experimentNeedsEvidenceRepair(experiment)).toBe(true);
  expect(fallbackExperimentAdvice(demoProject, experiment).actions.map((item) => item.target)).toEqual(["Eval / Runner"]);
  experiment.candidateResults[0].evaluation.criterionScores![0].verificationStatus = "verified";
  expect(experimentNeedsEvidenceRepair(experiment)).toBe(false);
});
