import type { EvolveProject, PlanAiResult } from "@evolution/contracts";
import {planningBaselineEvidence,planningBaselineFailures,PLANNING_EVIDENCE_INSTRUCTION} from "./planning-baseline";

export function planGroundingContext(project: EvolveProject, selectedProblemId?: string) {
  const selected = project.problems.find((problem) => problem.id === (selectedProblemId ?? project.selectedProblemId)) ?? project.problems[0];
  return {
    acceptanceRubric: project.acceptanceRubric.map((criterion) => ({ id:criterion.id,title: criterion.title, requirement: criterion.requirement, minScore:criterion.minScore,
      hardGate: criterion.hardGate, weight: criterion.weight, category: criterion.category,source:criterion.source,
      validationMethod:criterion.validationMethod,protectedConstraint:criterion.protectedConstraint,artifactIds:[...(criterion.artifactIds??[])] })),
    metrics: project.metrics.map((metric) => ({ key: metric.key, label: metric.label, value: metric.value, target: metric.target, unit: metric.unit, direction: metric.direction })),
    baselineFailures: planningBaselineFailures(project),
    planningBaseline:planningBaselineEvidence(project),planningInstruction:PLANNING_EVIDENCE_INSTRUCTION,
    selectedProblem: selected ? { id: selected.id, title: selected.title, summary: selected.summary, rootCause: selected.rootCause, evidence: selected.evidence } : undefined,
  };
}

export function flagUngroundedCandidates(result: PlanAiResult): { result: PlanAiResult; ungroundedCount: number } {
  let ungroundedCount = 0;
  const candidates = result.candidates.map((candidate) => {
    const grounded = (candidate.designRationale?.sourceEvidence.length ?? 0) > 0 && Boolean(candidate.designRationale?.mechanism);
    if (grounded) return candidate;
    ungroundedCount += 1;
    return { ...candidate, notes: [...candidate.notes, "设计论证不完整：缺少源成果证据引用或机制链，实验前请对照原文核对或重新生成方案"] };
  });
  return { result: { ...result, candidates }, ungroundedCount };
}
