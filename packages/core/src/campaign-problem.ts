import type { EvolveProject, Problem } from "@evolution/contracts";
import { indexScopedAcceptanceResults } from "./acceptance-result-identity";

export function baselineRubricProblem(project: EvolveProject): Problem | undefined {
  const deferred=new Set(["SYS-PAIRWISE",...(project.baselineRun.referenceOnlyCriterionIds??[])]);
  const scores = indexScopedAcceptanceResults([{
    requestedCriterionIds: project.acceptanceRubric.map((criterion) => criterion.id),
    results: project.baselineRun.result?.criterionScores ?? [],
  }]).byId;
  const ranked = project.acceptanceRubric.flatMap((criterion) => {
    if(deferred.has(criterion.id))return [];
    const score = scores.get(criterion.id);
    if (!score || score.verificationStatus !== "verified" || score.pass) return [];
    const deficit = Math.max(0, criterion.minScore - score.score);
    return [{ criterion, score, priority: (criterion.hardGate ? 1000 : 0) + deficit * 5 + criterion.weight }];
  }).sort((a, b) => b.priority - a.priority);
  const picked = ranked[0];
  if (!picked) return undefined;
  const evidence = [...new Set([
    ...picked.score.evidence,
    ...picked.score.gaps,
    ...picked.score.testCaseIds.map((id) => `已验证测试 ${id}`),
  ].filter(Boolean))].slice(0, 8);
  const deficit = Math.max(0, picked.criterion.minScore - picked.score.score);
  return {
    id: `rubric-problem-${picked.criterion.id}`,
    title: `${picked.criterion.title} 未达到验收标准`,
    impact: Math.min(100, Math.max(1, Math.round(picked.criterion.weight + deficit))),
    severity: picked.criterion.hardGate || deficit >= 15 ? "high" : deficit >= 6 ? "medium" : "low",
    status: "recommended",
    summary: `Baseline 已有真实证据：${picked.criterion.title} ${picked.score.score}/${picked.criterion.minScore}，本轮优先修复这一明确差距。`,
    evidence: evidence.length ? evidence : [`Criterion ${picked.criterion.id} 已验证但未达最低分`],
    evidenceRefs: [],
    confidence: 0.98,
    affectedComponent: picked.criterion.artifactIds?.length ? picked.criterion.artifactIds.join("、") : `Acceptance · ${picked.criterion.category}`,
  };
}

export function prioritizeProblems(problems: Problem[]) {
  return problems.filter((problem) => problem.status !== "resolved").map((problem) => ({
    problem,
    needsEvidence: !problem.evidence.length || (problem.confidence ?? 0.5) < 0.55
      || (problem.evidenceRefs.length > 0 && !problem.evidenceRefs.some((ref) => ref.verified)),
    score: Math.min(100, Math.max(0, problem.impact)) * (problem.confidence ?? 0.5)
      + ({ high: 30, medium: 15, low: 0 }[problem.severity]),
  })).sort((a, b) => Number(a.needsEvidence) - Number(b.needsEvidence) || b.score - a.score);
}
