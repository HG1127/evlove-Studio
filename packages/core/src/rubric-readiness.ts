import type { AcceptanceCriterion, TestCase } from "@evolution/contracts";

export function rubricWeightTotal(criteria: AcceptanceCriterion[]) {
  return Number(criteria.reduce((sum, item) => sum + item.weight, 0).toFixed(2));
}

export function rubricValidation(criteria: AcceptanceCriterion[]) {
  const warnings: string[] = [];
  const weightTotal = rubricWeightTotal(criteria);
  if (criteria.length < 3) warnings.push("验收标准不足 3 条");
  if (criteria.length > 12) warnings.push(`验收标准过多（${criteria.length} 条），建议压缩到 7-10 条核心标准`);
  if (Math.abs(weightTotal - 100) > 0.5) warnings.push(`权重合计 ${weightTotal}，应约等于 100`);
  if (!criteria.some((item) => item.source === "user-command" || item.source === "source-understanding")) warnings.push("没有直接对应用户进化要求的 criterion");
  if (!criteria.some((item) => item.hardGate)) warnings.push("没有 Hard Gate，关键约束可能被平均分掩盖");
  if (criteria.some((item) => !item.evidenceExpected.length)) warnings.push("部分 criterion 未定义 evidenceExpected");
  if (criteria.some((item) => item.category === "artifact-specific" && item.artifactIds.length === 0)) warnings.push("部分 Artifact-specific criterion 未绑定目标成果物");
  return { ready: warnings.length === 0, weightTotal, warnings };
}

export function rubricCoverage(criteria: AcceptanceCriterion[], cases: TestCase[]) {
  const known = new Set(criteria.map((item) => item.id));
  const covered = new Set(cases.flatMap((testCase) => testCase.criterionIds).filter((id) => known.has(id)));
  return { covered, uncovered: criteria.map((item) => item.id).filter((id) => !covered.has(id)) };
}

export function rubricSuiteCoverage(criteria: AcceptanceCriterion[], validationCases: TestCase[], hiddenCases: TestCase[]) {
  const coverage = rubricCoverage(criteria, [...validationCases, ...hiddenCases]);
  const hiddenHardGateMissing = criteria.filter((criterion) => criterion.hardGate
    && !hiddenCases.some((testCase) => testCase.criterionIds.includes(criterion.id)));
  return {
    covered: coverage.covered,
    uncovered: coverage.uncovered,
    hiddenHardGateMissing,
    ready: coverage.uncovered.length === 0 && hiddenHardGateMissing.length === 0,
  };
}
