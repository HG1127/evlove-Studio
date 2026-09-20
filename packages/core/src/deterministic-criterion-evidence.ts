import type {
  AcceptanceCriterion,
  CriterionScore,
  EvaluationResult,
  TargetRunResult,
  TestCase,
} from "@evolution/contracts";

export function hasDeterministicRoundtripProof(
  criterion: AcceptanceCriterion,
  testCases: TestCase[],
  runs: TargetRunResult[],
) {
  if (criterion.validationMethod !== "format-roundtrip") return false;
  const mappedCases = testCases.filter((testCase) => testCase.criterionIds.includes(criterion.id)).map((testCase) => testCase.id);
  if (!mappedCases.length) return false;
  const runMap = new Map(runs.map((run) => [run.testCaseId, run]));
  return mappedCases.every((id) => {
    const run = runMap.get(id);
    return run?.verificationStatus === "verified"
      && (run.output?.includes("CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED")
        || run.trace?.some((step) => step.stage === "format-roundtrip" && step.status === "pass"));
  });
}

export function deterministicRoundtripScore(
  criterion: AcceptanceCriterion,
  testCases: TestCase[],
  runs: TargetRunResult[],
): CriterionScore | undefined {
  if (!hasDeterministicRoundtripProof(criterion, testCases, runs)) return undefined;
  const testCaseIds = testCases.filter((testCase) => testCase.criterionIds.includes(criterion.id)).map((testCase) => testCase.id);
  return {
    criterionId: criterion.id,
    score: 100,
    pass: true,
    verificationStatus: "verified",
    evidence: testCaseIds.map((id) => `${id}: 当前 Candidate 已完成原格式 Roundtrip 并逐字一致`),
    gaps: [],
    testCaseIds,
  };
}

/**
 * Merge deterministic roundtrip proof into an existing evaluation without fabricating
 * semantic/visual/runtime judgements. Missing non-deterministic criteria remain unverified.
 */
export function applyDeterministicRoundtripEvidence(args: {
  criteria: AcceptanceCriterion[];
  testCases: TestCase[];
  runs: TargetRunResult[];
  evaluation: EvaluationResult;
}) {
  const existing = new Map((args.evaluation.criterionScores ?? []).map((score) => [score.criterionId, score]));
  const settledCriterionIds: string[] = [];
  for (const criterion of args.criteria) {
    const score = deterministicRoundtripScore(criterion, args.testCases, args.runs);
    if (!score) continue;
    existing.set(criterion.id, score);
    settledCriterionIds.push(criterion.id);
  }
  if (!settledCriterionIds.length) return { evaluation: args.evaluation, settledCriterionIds };

  const criterionScores = args.criteria.flatMap((criterion) => {
    const score = existing.get(criterion.id);
    return score ? [score] : [];
  });
  const scoreById = new Map(criterionScores.map((score) => [score.criterionId, score]));
  const totalWeight = args.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  const effectiveWeight = (criterion: AcceptanceCriterion) => {
    const status = scoreById.get(criterion.id)?.verificationStatus;
    return status === "verified" ? criterion.weight : status === "partial" ? criterion.weight * 0.5 : 0;
  };
  const scoredWeight = args.criteria.reduce((sum, criterion) => sum + effectiveWeight(criterion), 0);
  const rubricScore = args.criteria.length && scoredWeight > 0
    ? Math.round(args.criteria.reduce((sum, criterion) => sum + (scoreById.get(criterion.id)?.score ?? 0) * effectiveWeight(criterion), 0) / scoredWeight)
    : undefined;
  const verifiedWeight = args.criteria.reduce((sum, criterion) => sum + (scoreById.get(criterion.id)?.verificationStatus === "verified" ? criterion.weight : 0), 0);
  const verifiedRubricCoverage = args.criteria.length ? Math.round(verifiedWeight / totalWeight * 100) : 100;
  const unverifiedCriterionIds = args.criteria
    .filter((criterion) => scoreById.get(criterion.id)?.verificationStatus !== "verified")
    .map((criterion) => criterion.id);

  return {
    settledCriterionIds,
    evaluation: {
      ...args.evaluation,
      criterionScores,
      rubricScore,
      verifiedRubricCoverage,
      unverifiedCriterionIds,
      notes: [
        `Durable Workflow 已用 Candidate Snapshot 确定性补证：${settledCriterionIds.join("、")}`,
        ...args.evaluation.notes,
      ],
    },
  };
}
