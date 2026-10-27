import type { EvaluationResult, EvolveProject, TestCase } from "@evolution/contracts";
import { indexScopedAcceptanceResults } from "./acceptance-result-identity";

export const USER_GOAL_SCOPE_POLICY = "all-user-goals-v1" as const;
export const originalUserGoalCriteria = (project: EvolveProject) =>
  project.acceptanceRubric.filter(c => c.source === "user-command" && !c.protectedConstraint);

export function userGoalScopeContext(project: EvolveProject) {
  if (project.experimentPolicy?.winnerGoalScope !== USER_GOAL_SCOPE_POLICY) return undefined;
  return {
    policy: USER_GOAL_SCOPE_POLICY,
    requiredCriteria: originalUserGoalCriteria(project).map(c => ({
      criterionId: c.id, title: c.title, requirement: c.requirement, minScore: c.minScore, weight: c.weight,
    })),
    instruction: "Every original user-command goal remains in the Visible focus regardless of Candidate coveredCriteria. Each goal needs complete paired evidence on the current paper and no score regression; the full user-goal weighted gain must reach one point. Passing an absolute minimum does not establish relative improvement. Preserve all original gates and distinguish missing evidence from a verified failure.",
  };
}

/** Verified paired scores only; the caller supplies Visible or ordinary Hidden, never substitutes a final paper. */
export function userGoalProgress(
  project: EvolveProject, evaluation: EvaluationResult, baseline: EvaluationResult, suite: TestCase[] = project.evalSuite,
) {
  const goals = originalUserGoalCriteria(project), ids = goals.map(c => c.id);
  const scores = (e: EvaluationResult) => indexScopedAcceptanceResults([{ requestedCriterionIds: ids, results: e.criterionScores ?? [] }]);
  const current = scores(evaluation), prior = scores(baseline);
  const unique = (values: string[]) => values.length > 0 && new Set(values).size === values.length;
  const same = (a: string[], b: string[]) => unique(a) && unique(b) && a.length === b.length && a.every(id => b.includes(id));
  const weight = goals.reduce((sum, c) => sum + c.weight, 0);
  const validContract = unique(ids) && weight > 0 && unique(suite.map(t => t.id)) && !evaluation.demoJudged && !baseline.demoJudged;
  const criteria = goals.map(criterion => {
    const score = current.byId.get(criterion.id), before = prior.byId.get(criterion.id);
    const expected = suite.filter(t => t.criterionIds.includes(criterion.id)).map(t => t.id);
    const paired = validContract && !current.duplicateIds.has(criterion.id) && !prior.duplicateIds.has(criterion.id)
      && score?.verificationStatus === "verified" && before?.verificationStatus === "verified"
      && same(score.testCaseIds, expected) && same(before.testCaseIds, expected);
    return {
      criterionId: criterion.id, title: criterion.title, weight: criterion.weight, minScore: criterion.minScore,
      baselineScore: before?.score, candidateScore: score?.score,
      baselineMinimumPassed: before?.pass, candidateMinimumPassed: score?.pass,
      expectedCaseIds: expected, paired: Boolean(paired), delta: paired ? score!.score - before!.score : undefined,
    };
  });
  const ready = validContract && criteria.every(c => c.paired);
  return {
    policy: USER_GOAL_SCOPE_POLICY, ready, criteria, requiredCriterionIds: ids,
    pendingCriterionIds: criteria.filter(c => !c.paired).map(c => c.criterionId),
    regressedCriterionIds: criteria.filter(c => c.delta !== undefined && c.delta < 0).map(c => c.criterionId),
    weightedDelta: ready ? criteria.reduce((sum, c) => sum + c.delta! * c.weight, 0) / weight : undefined,
  };
}
