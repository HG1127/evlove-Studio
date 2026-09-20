import type { PlanAiResult } from "../ai/schemas";
import type { EvolveProject } from "../schemas";

// 方案 grounding 上下文：过去「方案太简单」的根因之一是生成端只看到成果摘要与根因一句话，
// 论证链没有可引用的锚点。这里把验收标准、指标目标、基线失败清单和当前选中问题摊开，
// 让每个候选的「源证据 → 指令对应 → 机制 → 验收标准」都有具体对象可指。
export function planGroundingContext(project: EvolveProject, selectedProblemId?: string) {
  const selected = project.problems.find((problem) => problem.id === (selectedProblemId ?? project.selectedProblemId)) ?? project.problems[0];
  return {
    acceptanceRubric: project.acceptanceRubric.map((criterion) => ({ title: criterion.title, requirement: criterion.requirement, hardGate: criterion.hardGate, weight: criterion.weight, category: criterion.category })),
    metrics: project.metrics.map((metric) => ({ key: metric.key, label: metric.label, value: metric.value, target: metric.target, unit: metric.unit, direction: metric.direction })),
    baselineFailures: project.baselineRun?.result?.failures ?? [],
    selectedProblem: selected ? { id: selected.id, title: selected.title, summary: selected.summary, rootCause: selected.rootCause, evidence: selected.evidence } : undefined,
  };
}

// 生成后兜底校验：部分模型提供方不严格执行 JSON Schema，缺源证据引用的候选会被打上可见标记，
// 让界面上一眼看出哪些方案是「悬空」的，而不是静默放过或丢弃。
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
