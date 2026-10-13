import { EvolveProjectSchema, InputUnderstandingSchema, TestCaseSchema } from "@evolution/contracts";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "./experiment-recovery-fixture";

/** Synthetic failed paper for policy-transition tests; no production content or cloud proof. */
export function baselinePolicyTransitionFixture() {
  const x = experimentRecoveryFixture(), p = x.project;
  p.inputUnderstanding = InputUnderstandingSchema.parse({ status: "ready", confidence: .9 });
  p.gates.push({ id: "target-ready", status: "approved", approvedAt: at });
  p.candidates = [{ ...x.current, status: "draft" }];
  const current = { ...p.acceptanceRubric[0]!, requirement: "Current document contains supported content", validationMethod: "semantic-judge" as const };
  p.acceptanceRubric = [current, { ...current, id: "READABLE", title: "Readable current text", requirement: "Current text has readable instructions", weight: 30 },
    { ...current, id: "COMPLETE", title: "Current completion checks", requirement: "Current instructions describe completion checks", weight: 30 }];
  p.acceptanceRubric[0]!.weight = 40;
  p.evalSuite = [TestCaseSchema.parse({ ...p.evalSuite[0]!, criterionIds: p.acceptanceRubric.map(criterion => criterion.id) })];
  p.acceptanceRubricState = { status: "ready", summary: "Synthetic current contract", version: 1, weightTotal: 100,
    uncoveredCriterionIds: [], warnings: [], confirmedAt: at };
  p.hiddenEvalSuite = [TestCaseSchema.parse({ ...p.evalSuite[0]!, id: "H1", hidden: true })];
  p.baselineRun = { ...p.baselineRun, status: "failed", result: undefined, runs: Array.from({ length: 6 }, (_, index) => ({
    testCaseId: "prior-case-" + index, output: "synthetic old observation " + index, latencyMs: 1, cost: 0,
    verificationStatus: "verified" as const, trace: [],
  })) };
  p.stage = "baseline";
  p.campaign = { ...p.campaign, status: "paused", stopReason: "[server-campaign-baseline-judge-pending] malformed synthetic Judge response" };
  return EvolveProjectSchema.parse(p);
}
