import type { Candidate, EvaluationResult, EvolveProject, TargetRunResult, TestCase, ValidationRun } from "@evolution/contracts";
import { criteriaRequiringJudge, evidenceFingerprint, fastHash, LIVE_TARGET_OBSERVATION_MAX_AGE_MS, verifiedValidationFailures } from "@evolution/core";
import { SERVER_MEASURED_REVIEW_VERSION } from "./server-measured-review-evidence";
import {serverHtmlNativeRunsMatchOriginal} from "./server-html-native-runs";

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

/** A complete negative Candidate verdict does not require a passing/complete comparison verdict. */
export function knownServerHoldoutRejection(project:EvolveProject,suite:TestCase[],prior:ValidationRun){
  const candidates=project.candidates.filter(item=>item.id===prior.candidateId),candidate=candidates.length===1?candidates[0]:undefined;
  if(!serverHtmlNativeRunsMatchOriginal(project,prior.baselineRuns,undefined,suite)
    ||prior.runs.some(run=>run.nativeHtmlProof)&&(!candidate||!serverHtmlNativeRunsMatchOriginal(project,prior.runs,candidate,suite)))return false;
  return prior.status==="completed"&&Boolean(prior.baselineEvaluation&&!prior.baselineEvaluation.demoJudged)
    &&Boolean(prior.evaluation&&!prior.evaluation.demoJudged&&prior.evaluation.measuredReviewVersion===SERVER_MEASURED_REVIEW_VERSION)
    &&verifiedValidationFailures(project,prior).some(criterion=>{
      if(!criterion.hardGate)return false;
      const score=prior.evaluation?.criterionScores?.find(item=>item.criterionId===criterion.id);
      const mapped=suite.filter(test=>test.criterionIds.includes(criterion.id)).map(test=>test.id);
      return Boolean(score?.testCaseIds.length&&score.testCaseIds.every(id=>mapped.includes(id))
        &&mapped.length&&mapped.every(id=>prior.runs.some(run=>run.testCaseId===id&&run.verificationStatus==="verified"&&!run.error)));
    });
}

/** A bound rejection may advance to repair; it never becomes a fresh passing observation. */
export function recoverableServerHoldout(
  project: EvolveProject, candidate: Candidate, suite: TestCase[], round: number,
  baselineFingerprint: string, artifactFingerprint: string | undefined, nowMs: number,
): ValidationRun | undefined {
  const prior = project.validationRun;
  const observed = prior.baselineObservedAt;
  const knownFailure = knownServerHoldoutRejection(project,suite,prior);
  const pending = prior.status === "failed" && prior.error?.startsWith("[server-campaign-holdout-judge-pending]")
    || prior.status === "completed" && prior.summary?.startsWith("[server-campaign-holdout-review-pending]")
    || knownFailure;
  if (project.targetConnection.adapter !== "artifact" || !pending || !artifactFingerprint || prior.executionArtifactFingerprint !== artifactFingerprint
    || !serverHtmlNativeRunsMatchOriginal(project,prior.runs,candidate,suite)||!serverHtmlNativeRunsMatchOriginal(project,prior.baselineRuns,undefined,suite)
    || prior.id !== "validation-server-r"+round || prior.validationMode !== "full"
    || prior.candidateId !== candidate.id || prior.evidenceFingerprint !== evidenceFingerprint(project, candidate)
    || prior.baselineContextFingerprint !== baselineFingerprint
    || prior.executionEvidenceFingerprint !== serverHoldoutExecutionEvidenceFingerprint(prior)
    || !Number.isFinite(nowMs) || !Number.isFinite(observed) || !observed || nowMs < observed
    || !knownFailure && nowMs - observed >= LIVE_TARGET_OBSERVATION_MAX_AGE_MS
    || prior.plannedCases !== suite.length || prior.executedCases !== suite.length
    || !suite.length || new Set(suite.map(item => item.id)).size !== suite.length
    || prior.baselineSuiteIds?.length !== suite.length
    || prior.runs.length !== suite.length || prior.baselineRuns.length !== suite.length) return undefined;
  const observable = (run: TargetRunResult | undefined, id: string) => run?.testCaseId === id
    && !run.error && Boolean(run.output.trim())
    && (run.verificationStatus === "verified" || run.verificationStatus === "partial");
  return suite.every((testCase, index) => prior.baselineSuiteIds?.[index] === testCase.id
    && (knownFailure
      ? prior.runs[index]?.testCaseId===testCase.id&&prior.baselineRuns[index]?.testCaseId===testCase.id
        &&Boolean(prior.runs[index]?.output.trim())&&Boolean(prior.baselineRuns[index]?.output.trim())
      : observable(prior.runs[index], testCase.id) && observable(prior.baselineRuns[index], testCase.id))) ? prior : undefined;
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
