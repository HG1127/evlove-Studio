import type {BusinessBenefitAssessment,BusinessBenefitPolicy,OutcomeMetricSample} from '@evolution/contracts';
import {qualifyOutcomeObservations} from './outcome-observation-identity';
type ArmSummary=BusinessBenefitAssessment['stable'];
export function thresholdChecks(stable: ArmSummary, candidate: ArmSummary, completeCohorts: boolean) {
  return {
    completeCohorts,
    acceptanceAtLeast80Percent: completeCohorts && (candidate.acceptanceRate ?? -1) >= 0.8,
    medianTimeReduced20Percent: completeCohorts && stable.medianElapsedMs !== undefined && stable.medianElapsedMs > 0
      && candidate.medianElapsedMs !== undefined && candidate.medianElapsedMs <= stable.medianElapsedMs * 0.8,
    costPerAcceptedNoIncrease: completeCohorts && stable.reportedCostPerAccepted !== undefined && candidate.reportedCostPerAccepted !== undefined
      && candidate.reportedCostPerAccepted <= stable.reportedCostPerAccepted + 1e-12,
  };
}

/** Shared numeric gates; callers must separately validate deployment or artifact subject identity. */
export function assessTaskBenefitCohorts(input:{policy:Omit<BusinessBenefitPolicy,'version'>;samples:OutcomeMetricSample[];checkedAt:string;configurationError?:string;scopeMatches:(rows:OutcomeMetricSample[])=>boolean}){
 const policy=input.policy;
  const keys = [policy.acceptanceMetricKey, policy.elapsedMetricKey, policy.costMetricKey];
  const relevant = input.samples.filter(s => s.source === policy.source && s.segment === policy.segment && keys.includes(s.metricKey));
  const qualified = qualifyOutcomeObservations(relevant);
  const expected = new Set([...policy.stableTaskIds, ...policy.candidateTaskIds]);
  const unexpected = new Set(relevant.flatMap(s => s.observation?.kind === "independent-task" && !expected.has(s.observation.taskId) ? [s.observation.taskId] : []));
  const scopeValid = input.scopeMatches(relevant);
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
  return {
    checkedAt: input.checkedAt,
    status, stable, candidate, checks, conflictCount: qualified.conflictCount, unexpectedTaskCount: unexpected.size, pendingTaskCount,
    establishesCausalBenefit: false,
    reason: input.configurationError || (status === "insufficient" ? "计划任务缺少完整同源对照观测，或任务、部署、数值存在冲突。"
      : status === "failed" ? "验收率、中位耗时或每个成功任务的报告成本未达到业务门槛。"
        : "报告的任务观测达到数值门槛；仍须独立核验真实人类任务、预登记分组和实际账单，统计结果不证明因果收益。"),
  };
}
