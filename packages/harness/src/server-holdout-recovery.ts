import type { Candidate, EvaluationResult, EvolveProject, TargetRunResult, TestCase, ValidationRun } from "@evolution/contracts";
import { criteriaRequiringJudge, evidenceFingerprint, fastHash, LIVE_TARGET_OBSERVATION_MAX_AGE_MS } from "@evolution/core";
import { SERVER_MEASURED_REVIEW_VERSION } from "./server-measured-review-evidence";

export type ServerHoldoutArtifactReader = (args: { project: EvolveProject; candidate: Candidate }) => Promise<string | undefined>;

/** Missing/invalid physical identity disables reuse, without inventing an execution failure. */
export async function readServerHoldoutArtifactFingerprint(project: EvolveProject, candidate: Candidate, read?: ServerHoldoutArtifactReader) {
  try {
    const value = await read?.({ project, candidate });
    return value && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
  } catch { return undefined; }
}

/** Domain record identity, not an authentication/signature substitute. */
export function serverHoldoutExecutionEvidenceFingerprint(prior: Pick<ValidationRun, "runs" | "baselineRuns" | "baselineObservedAt">) {
  const wire = JSON.parse(JSON.stringify({ version: "server-holdout-execution-evidence-v1", runs: prior.runs,
    baselineRuns: prior.baselineRuns, baselineObservedAt: prior.baselineObservedAt }));
  return fastHash(wire);
}

/** Resume assessment only; incomplete execution and legacy observations must run again. */
export function recoverableServerHoldout(
  project: EvolveProject, candidate: Candidate, suite: TestCase[], round: number,
  baselineFingerprint: string, artifactFingerprint: string | undefined, nowMs: number,
): ValidationRun | undefined {
  const prior = project.validationRun;
  const observed = prior.baselineObservedAt;
  const pending = prior.status === "failed" && prior.error?.startsWith("[server-campaign-holdout-judge-pending]")
    || prior.status === "completed" && prior.summary?.startsWith("[server-campaign-holdout-review-pending]");
  if (project.targetConnection.adapter !== "artifact" || !pending || !artifactFingerprint || prior.executionArtifactFingerprint !== artifactFingerprint
    || prior.id !== "validation-server-r"+round || prior.validationMode !== "full"
    || prior.candidateId !== candidate.id || prior.evidenceFingerprint !== evidenceFingerprint(project, candidate)
    || prior.baselineContextFingerprint !== baselineFingerprint
    || prior.executionEvidenceFingerprint !== serverHoldoutExecutionEvidenceFingerprint(prior)
    || !Number.isFinite(nowMs) || !Number.isFinite(observed) || !observed || nowMs < observed
    || nowMs - observed >= LIVE_TARGET_OBSERVATION_MAX_AGE_MS
    || prior.plannedCases !== suite.length || prior.executedCases !== suite.length
    || !suite.length || new Set(suite.map(item => item.id)).size !== suite.length
    || prior.baselineSuiteIds?.length !== suite.length
    || prior.runs.length !== suite.length || prior.baselineRuns.length !== suite.length) return undefined;
  const observable = (run: TargetRunResult | undefined, id: string) => run?.testCaseId === id
    && !run.error && Boolean(run.output.trim())
    && (run.verificationStatus === "verified" || run.verificationStatus === "partial");
  return suite.every((testCase, index) => prior.baselineSuiteIds?.[index] === testCase.id
    && observable(prior.runs[index], testCase.id) && observable(prior.baselineRuns[index], testCase.id)) ? prior : undefined;
}

/** Retain a complete independent assessment only on the already checked execution binding. */
export function reusableServerHoldoutAssessment(project: EvolveProject, suite: TestCase[], runs: TargetRunResult[], evaluation?: EvaluationResult) {
  if (!evaluation || evaluation.demoJudged) return false;
  const judgeCriteria = criteriaRequiringJudge(project.acceptanceRubric, suite, runs);
  if (judgeCriteria.length && evaluation.measuredReviewVersion !== SERVER_MEASURED_REVIEW_VERSION) return false;
  const scores = evaluation.criterionScores ?? [];
  if (new Set(scores.map(item => item.criterionId)).size !== scores.length) return false;
  return judgeCriteria.every(criterion => {
    const score = scores.find(item => item.criterionId === criterion.id);
    const ids = new Set(suite.filter(item => item.criterionIds.includes(criterion.id)).map(item => item.id));
    return score && (score.verificationStatus === "verified" || score.verificationStatus === "partial")
      && score.testCaseIds.length > 0 && score.testCaseIds.every(id => ids.has(id));
  });
}
