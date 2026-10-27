import { BusinessBenefitAssessmentSchema, BusinessBenefitPolicySchema, type BusinessBenefitAssessment, type BusinessBenefitPolicy, type OutcomeMetricSample } from "@evolution/contracts";
import { qualifyOutcomeObservations } from "./outcome-observation-identity";
import { fastHash } from "./stable-hash";

export const businessBenefitPolicyFingerprint = (policy: BusinessBenefitPolicy) => fastHash(JSON.stringify(BusinessBenefitPolicySchema.parse(policy)));

type ArmSummary = BusinessBenefitAssessment["stable"];
function thresholdChecks(stable: ArmSummary, candidate: ArmSummary, completeCohorts: boolean) {
  return {
    completeCohorts,
    acceptanceAtLeast80Percent: completeCohorts && (candidate.acceptanceRate ?? -1) >= 0.8,
    medianTimeReduced20Percent: completeCohorts && stable.medianElapsedMs !== undefined && stable.medianElapsedMs > 0
      && candidate.medianElapsedMs !== undefined && candidate.medianElapsedMs <= stable.medianElapsedMs * 0.8,
    costPerAcceptedNoIncrease: completeCohorts && stable.reportedCostPerAccepted !== undefined && candidate.reportedCostPerAccepted !== undefined
      && candidate.reportedCostPerAccepted <= stable.reportedCostPerAccepted + 1e-12,
  };
}
/** A receipt's claimed status cannot override its counts or numeric thresholds. */
export function businessBenefitEvidenceMatches(policy: BusinessBenefitPolicy, proof: BusinessBenefitAssessment) {
  const armValid = (s: ArmSummary, expected: number) => s.expectedTasks === expected && s.completeTasks === expected
    && s.acceptedTasks !== undefined && s.acceptedTasks > 0 && s.acceptedTasks <= expected
    && s.acceptanceRate === s.acceptedTasks / expected && s.reportedTotalCost !== undefined && s.reportedCostPerAccepted !== undefined
    && Math.abs(s.reportedCostPerAccepted - s.reportedTotalCost / s.acceptedTasks) <= 1e-12;
  return proof.status === "thresholds-met" && proof.policyFingerprint === businessBenefitPolicyFingerprint(policy)
    && proof.conflictCount === 0 && proof.unexpectedTaskCount === 0 && proof.pendingTaskCount === 0
    && armValid(proof.stable, policy.stableTaskIds.length) && armValid(proof.candidate, policy.candidateTaskIds.length)
    && Object.values(proof.checks).every(Boolean) && Object.values(thresholdChecks(proof.stable, proof.candidate, true)).every(Boolean);
}

/** All attempted tasks, including failures, must have the same three source-bound measurements. */
export function assessBusinessBenefit(input: {
  policy: BusinessBenefitPolicy; samples: OutcomeMetricSample[]; checkedAt: string; configurationError?: string;
}) {
  const policy = BusinessBenefitPolicySchema.parse(input.policy);
  const keys = [policy.acceptanceMetricKey, policy.elapsedMetricKey, policy.costMetricKey];
  const relevant = input.samples.filter(s => s.source === policy.source && s.segment === policy.segment && keys.includes(s.metricKey));
  const qualified = qualifyOutcomeObservations(relevant);
  const expected = new Set([...policy.stableTaskIds, ...policy.candidateTaskIds]);
  const unexpected = new Set(relevant.flatMap(s => s.observation?.kind === "independent-task" && !expected.has(s.observation.taskId) ? [s.observation.taskId] : []));
  const cohortScope = new Set(relevant.map(s => JSON.stringify([s.workspaceId, s.missionId, s.candidateId])));
  const deployments = (arm: "stable" | "candidate") => new Set(relevant.filter(s => s.arm === arm).map(s => s.deploymentId ?? ""));
  const stableDeployments = deployments("stable"), candidateDeployments = deployments("candidate");
  const scopeValid = cohortScope.size === 1 && stableDeployments.size === 1 && candidateDeployments.size === 1
    && !stableDeployments.has("") && !candidateDeployments.has("") && [...stableDeployments][0] !== [...candidateDeployments][0];
  const armSummary = (arm: "stable" | "candidate", ids: string[]): ArmSummary => {
    const complete: Array<{ accepted: number; elapsed: number; cost: number }> = [];
    for (const id of ids) {
      const rows = qualified.samples.filter(s => s.arm === arm && s.observation?.kind === "independent-task" && s.observation.taskId === id);
      const byKey = new Map(rows.map(s => [s.metricKey, s]));
      const acceptance = byKey.get(policy.acceptanceMetricKey), elapsed = byKey.get(policy.elapsedMetricKey), cost = byKey.get(policy.costMetricKey);
      if (rows.length !== 3 || byKey.size !== 3 || !acceptance || !elapsed || !cost) continue;
      if (acceptance.metricKind !== "business" || acceptance.direction !== "higher" || acceptance.unit !== "ratio" || ![0, 1].includes(acceptance.value)
        || elapsed.metricKind !== "latency" || elapsed.direction !== "lower" || elapsed.unit !== "ms" || elapsed.value < 0 || !Number.isFinite(elapsed.value)
        || cost.metricKind !== "cost" || cost.direction !== "lower" || cost.unit !== policy.costUnit || cost.value < 0 || !Number.isFinite(cost.value)
        || new Set(rows.map(s => Date.parse(s.observedAt))).size !== 1 || rows.some(s => !Number.isFinite(Date.parse(s.observedAt)))) continue;
      complete.push({ accepted: acceptance.value, elapsed: elapsed.value, cost: cost.value });
    }
    const base = { expectedTasks: ids.length, completeTasks: complete.length };
    // An incomplete subset cannot supply an acceptance denominator or hide failed attempts.
    if (complete.length !== ids.length) return base;
    const acceptedTasks = complete.reduce((sum, t) => sum + t.accepted, 0);
    const sorted = complete.map(t => t.elapsed).sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    const reportedTotalCost = complete.reduce((sum, t) => sum + t.cost, 0);
    if (!Number.isFinite(reportedTotalCost)) return { ...base, completeTasks: 0 };
    return { ...base, acceptedTasks, acceptanceRate: acceptedTasks / ids.length,
      medianElapsedMs: sorted.length % 2 ? sorted[middle]! : sorted[middle - 1]! / 2 + sorted[middle]! / 2,
      reportedTotalCost, reportedCostPerAccepted: acceptedTasks > 0 ? reportedTotalCost / acceptedTasks : undefined };
  };
  const stable = armSummary("stable", policy.stableTaskIds), candidate = armSummary("candidate", policy.candidateTaskIds);
  const pendingTaskCount = stable.expectedTasks + candidate.expectedTasks - stable.completeTasks - candidate.completeTasks;
  const completeCohorts = !input.configurationError && scopeValid && !qualified.conflictCount && !unexpected.size && pendingTaskCount === 0;
  const checks = thresholdChecks(stable, candidate, completeCohorts);
  const status = !completeCohorts ? "insufficient" : Object.values(checks).every(Boolean) ? "thresholds-met" : "failed";
  return BusinessBenefitAssessmentSchema.parse({
    version: policy.version, policyFingerprint: businessBenefitPolicyFingerprint(policy), checkedAt: input.checkedAt,
    status, stable, candidate, checks, conflictCount: qualified.conflictCount, unexpectedTaskCount: unexpected.size, pendingTaskCount,
    establishesCausalBenefit: false,
    reason: input.configurationError || (status === "insufficient" ? "计划任务缺少完整同源对照观测，或任务、部署、数值存在冲突。"
      : status === "failed" ? "验收率、中位耗时或每个成功任务的报告成本未达到业务门槛。"
        : "报告的任务观测达到数值门槛；仍须独立核验真实人类任务、预登记分组和实际账单，统计结果不证明因果收益。"),
  });
}
