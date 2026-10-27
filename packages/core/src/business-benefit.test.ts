import { describe, expect, it } from "vitest";
import { BusinessBenefitPolicySchema, EvolveProjectSchema } from "@evolution/contracts";
import { businessBenefitFixture } from "@evolution/testkit";
import { assessBusinessBenefit } from "./business-benefit";
import { analyzeOutcomeSamples } from "./outcome-statistics";
import { productionGoalFingerprint, productionGoalReadiness } from "./production-goal-evidence";

function analyzed(meanOnly = false) {
  const x = businessBenefitFixture(meanOnly), p = x.project;
  const analysis = analyzeOutcomeSamples({ missionId: p.id, candidateId: "C", minimumSamplesPerArm: 30, samples: x.samples, checkedAt: x.checkedAt, businessBenefitPolicy: x.policy });
  p.release.goalEvidence = { schemaVersion: "production-goal-v1", missionId: p.id, candidateId: "C", deploymentId: "candidate", stableDeploymentId: "stable",
    goalFingerprint: productionGoalFingerprint(p), checkedAt: x.checkedAt, analysis };
  return { ...x, analysis };
}

describe("controlled task benefit gates", () => {
  it("rejects the real-function mean-only counterexample without rewriting the statistical findings", () => {
    const x = businessBenefitFixture(true), p = x.project;
    const legacy = analyzeOutcomeSamples({ missionId: p.id, candidateId: "C", minimumSamplesPerArm: 30, samples: x.samples, checkedAt: x.checkedAt });
    expect(legacy.verdict).toBe("healthy"); expect(legacy).not.toHaveProperty("businessBenefit");
    const { analysis, project } = analyzed(true);
    expect(analysis).toMatchObject({ verdict: "watch", regressions: [], businessBenefit: { status: "failed", establishesCausalBenefit: false,
      stable: { completeTasks: 30, acceptedTasks: 28, medianElapsedMs: 100 }, candidate: { completeTasks: 30, acceptedTasks: 24, medianElapsedMs: 150 },
      checks: { completeCohorts: true, acceptanceAtLeast80Percent: true, medianTimeReduced20Percent: false, costPerAcceptedNoIncrease: false } } });
    expect(analysis.metrics.every(m => m.significance !== "significant-regression")).toBe(true);
    expect(analysis.businessBenefit!.candidate.reportedCostPerAccepted).toBeCloseTo(1.125);
    expect(productionGoalReadiness(project, Date.parse(x.checkedAt)).improved).toBe(false);
  });

  it("counts all attempts and reaches numeric thresholds without claiming human benefit or causal transfer", () => {
    const { analysis, project, checkedAt } = analyzed();
    expect(analysis.businessBenefit).toMatchObject({ status: "thresholds-met", establishesCausalBenefit: false,
      stable: { acceptedTasks: 28 }, candidate: { acceptedTasks: 27, acceptanceRate: 0.9, medianElapsedMs: 70 } });
    expect(analysis.businessBenefit!.candidate.reportedCostPerAccepted).toBeCloseTo(1);
    expect(productionGoalReadiness(EvolveProjectSchema.parse(project), Date.parse(checkedAt)).improved).toBe(true);
  });

  it.each(["missing-failed-task", "missing-cost", "duplicate-conflict", "cross-arm", "wrong-unit", "negative-cost", "cost-overflow", "negative-time", "non-binary-acceptance", "mixed-time", "extra-task", "aggregate", "source", "deployment", "config"])(
    "keeps %s evidence insufficient and does not shrink the acceptance denominator", kind => {
      const x = businessBenefitFixture(), index = x.samples.findIndex(s => s.id === "candidate-9-cost");
      if (kind === "missing-failed-task") x.samples = x.samples.filter(s => !s.id.startsWith("candidate-9-"));
      if (kind === "missing-cost") x.samples.splice(index, 1);
      if (kind === "duplicate-conflict") x.samples.push({ ...x.samples[index]!, id: "conflicting-replay", value: 999 });
      if (kind === "cross-arm") x.samples[index]!.arm = "stable";
      if (kind === "wrong-unit") x.samples[index]!.unit = "tokens";
      if (kind === "negative-cost") x.samples[index]!.value = -1;
      if (kind === "cost-overflow") for (const s of x.samples) if(s.arm==="candidate"&&s.metricKey==="cost")s.value=1e308;
      if (kind === "negative-time") x.samples.find(s => s.id === "candidate-9-elapsed")!.value = -1;
      if (kind === "non-binary-acceptance") x.samples.find(s => s.id === "candidate-9-accepted")!.value = 0.8;
      if (kind === "mixed-time") x.samples[index]!.observedAt = x.checkedAt;
      if (kind === "extra-task") x.samples.push({ ...x.samples[index]!, id: "unexpected", observation: { schemaVersion: "outcome-observation-v1", kind: "independent-task", taskId: "not-planned" } });
      if (kind === "aggregate") x.samples[index]!.observation = { schemaVersion: "outcome-observation-v1", kind: "aggregate-snapshot" };
      if (kind === "source") x.samples[index]!.source = "manual";
      if (kind === "deployment") x.samples[index]!.deploymentId = "another-deployment";
      const result = assessBusinessBenefit({ policy: x.policy, samples: x.samples, checkedAt: x.checkedAt, configurationError: kind === "config" ? "not configured" : undefined });
      expect(result.status).toBe("insufficient"); expect(result.checks.completeCohorts).toBe(false);
      expect(result.checks.acceptanceAtLeast80Percent).toBe(false); expect(result.candidate.expectedTasks).toBe(30);
      if (kind === "missing-failed-task" || kind === "missing-cost") expect(result.candidate.acceptanceRate).toBeUndefined();
    },
  );

  it("deduplicates exact replays and retains zero accepted tasks as a failed comparison with unknown cost per success", () => {
    const x = businessBenefitFixture();
    x.samples.push(...x.samples.map(s => ({ ...s, id: `replay-${s.id}` })));
    expect(assessBusinessBenefit(x).candidate.completeTasks).toBe(30);
    for (const s of x.samples) if (s.arm === "stable" && s.metricKey === "accepted") s.value = 0;
    const result = assessBusinessBenefit(x);
    expect(result.status).toBe("failed"); expect(result.stable.reportedCostPerAccepted).toBeUndefined();
  });

  it.each(["short", "duplicate", "cross-arm-id", "same-metric", "manual-source"])("rejects invalid %s contracts", kind => {
    const { policy } = businessBenefitFixture();
    if (kind === "short") policy.stableTaskIds.pop();
    if (kind === "duplicate") policy.stableTaskIds[1] = policy.stableTaskIds[0]!;
    if (kind === "cross-arm-id") policy.candidateTaskIds[0] = policy.stableTaskIds[0]!;
    if (kind === "same-metric") policy.costMetricKey = policy.acceptanceMetricKey;
    if (kind === "manual-source") policy.source = "manual";
    expect(BusinessBenefitPolicySchema.safeParse(policy).success).toBe(false);
  });

  it.each(["missing", "changed-policy", "wrong-time", "forged-healthy", "contradictory-median", "contradictory-cost", "contradictory-count"])("cannot reuse %s business evidence for goal or Skill promotion", kind => {
    const { project: p, checkedAt } = analyzed();
    const analysis = p.release.goalEvidence!.analysis!;
    if (kind === "missing") delete analysis.businessBenefit;
    if (kind === "changed-policy") { p.businessBenefitPolicy!.costUnit = "CNY"; p.release.goalEvidence!.goalFingerprint = productionGoalFingerprint(p); }
    if (kind === "wrong-time") analysis.businessBenefit!.checkedAt = "2000-01-01T00:00:00Z";
    if (kind === "forged-healthy") analysis.businessBenefit!.status = "failed";
    if (kind === "contradictory-median") analysis.businessBenefit!.candidate.medianElapsedMs=999;
    if (kind === "contradictory-cost") analysis.businessBenefit!.candidate.reportedCostPerAccepted=0;
    if (kind === "contradictory-count") analysis.businessBenefit!.candidate.completeTasks=29;
    expect(productionGoalReadiness(p, Date.parse(checkedAt)).improved).toBe(false);
  });
});
