import { htmlProtectionCoverageGap } from "@evolution/core";
import type { AcceptanceCriterion, Candidate, EvaluationResult, EvolveProject, SupplementalValidationEvidence } from "../schemas";
import { evidenceFingerprint } from "./evidence-binding";

export type SupplementalEvidenceMethod = SupplementalValidationEvidence["method"];

export function supplementalMethodForCriterion(criterion: AcceptanceCriterion): SupplementalEvidenceMethod | undefined {
  if (criterion.validationMethod === "visual-review") return "visual-review";
  if (criterion.validationMethod === "manual-review") return "manual-review";
  return undefined;
}

export function activeSupplementalEvidence(project: EvolveProject, candidate: Candidate) {
  const fingerprint = evidenceFingerprint(project, candidate);
  const latest = new Map<string, SupplementalValidationEvidence>();
  for (const item of project.supplementalValidationEvidence ?? []) {
    if (item.candidateId !== candidate.id || item.evidenceFingerprint !== fingerprint) continue;
    const criterion = project.acceptanceRubric.find((entry) => entry.id === item.criterionId);
    if (!criterion || supplementalMethodForCriterion(criterion) !== item.method) continue;
    if (item.method === "visual-review" && item.screenshotIds.length === 0) continue;
    const prior = latest.get(item.criterionId);
    if (!prior || prior.createdAt <= item.createdAt) latest.set(item.criterionId, item);
  }
  return latest;
}

/**
 * Explicit human/visual sign-off verifies only the matching criterion on the exact Candidate fingerprint.
 * It never upgrades runner/E2E or unrelated criteria, and stale evidence is ignored automatically.
 */
export function applySupplementalEvidenceToEvaluation(project: EvolveProject, candidate: Candidate, evaluation: EvaluationResult): EvaluationResult {
  if (!evaluation.criterionScores?.length || !(project.supplementalValidationEvidence ?? []).length) return evaluation;
  const evidence = activeSupplementalEvidence(project, candidate);
  if (!evidence.size) return evaluation;
  const criterionById = new Map(project.acceptanceRubric.map((criterion) => [criterion.id, criterion]));
  const touched: string[] = [];
  const criterionScores = evaluation.criterionScores.map((score) => {
    const record = evidence.get(score.criterionId);
    const criterion = criterionById.get(score.criterionId);
    if (!record || !criterion) return score;
    const scopeGap = htmlProtectionCoverageGap(criterion, project);
    if (scopeGap) {
      // A matching note or screenshot is not the independent complete-scope collector.
      // Preserve observed rejections and raw ledger entries; never clear their gaps.
      const observedRejection = score.verificationStatus === "verified" && !score.pass;
      return { ...score, pass: false,
        verificationStatus: observedRejection ? "verified" as const : score.verificationStatus === "unverified" ? "unverified" as const : "partial" as const,
        gaps: [...new Set([...score.gaps, scopeGap])],
      };
    }
    touched.push(criterion.title);
    const pass = record.verdict === "pass";
    const nextScore = pass ? Math.max(score.score, criterion.minScore) : Math.min(score.score, Math.max(0, criterion.minScore - 1));
    const kind = record.method === "visual-review" ? "视觉人工验收" : "人工验收";
    return {
      ...score,
      score: nextScore,
      pass,
      verificationStatus: "verified" as const,
      evidence: [
        ...score.evidence,
        `${kind}：${record.note}`,
        ...(record.screenshotIds.length ? [`截图证据 ${record.screenshotIds.length} 张（已绑定当前 Candidate/Artifact 指纹）`] : []),
      ].slice(-8),
      gaps: pass ? [] : [`${kind}明确判定未通过：${record.note}`],
    };
  });
  const weightTotal = project.acceptanceRubric.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  const scoreById = new Map(criterionScores.map((score) => [score.criterionId, score]));
  const effectiveWeight = (criterion: AcceptanceCriterion) => {
    const status = scoreById.get(criterion.id)?.verificationStatus;
    return status === "verified" ? criterion.weight : status === "partial" ? criterion.weight * 0.5 : 0;
  };
  const scoredWeight = project.acceptanceRubric.reduce((sum, criterion) => sum + effectiveWeight(criterion), 0);
  const rubricScore = scoredWeight > 0
    ? Math.round(project.acceptanceRubric.reduce((sum, criterion) => sum + (scoreById.get(criterion.id)?.score ?? 0) * effectiveWeight(criterion), 0) / scoredWeight)
    : evaluation.rubricScore;
  const verifiedWeight = project.acceptanceRubric.reduce((sum, criterion) => sum + (scoreById.get(criterion.id)?.verificationStatus === "verified" ? criterion.weight : 0), 0);
  const verifiedRubricCoverage = project.acceptanceRubric.length ? Math.round(verifiedWeight / weightTotal * 100) : 100;
  const unverifiedCriterionIds = criterionScores.filter((score) => score.verificationStatus !== "verified").map((score) => score.criterionId);
  return {
    ...evaluation,
    criterionScores,
    rubricScore,
    verifiedRubricCoverage,
    unverifiedCriterionIds,
    notes: touched.length ? [`补充验收证据已应用：${touched.join("、")}`, ...evaluation.notes] : [...evaluation.notes],
  };
}

export function latestSupplementalEvidenceForCriterion(project: EvolveProject, candidate: Candidate, criterionId: string) {
  return activeSupplementalEvidence(project, candidate).get(criterionId);
}
