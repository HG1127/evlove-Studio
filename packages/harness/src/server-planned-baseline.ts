import { PlannedBaselineRefreshSchema, type BaselineRun, type EvolveProject, type OriginalArtifactReferenceProof, type PlannedBaselineRefresh } from "@evolution/contracts";
import {
  assertIndependentFinalPaper, baselineReadiness, campaignRepairLimitStopReason, candidateFailureContextBlocker,
  fastHash, finalHoldoutContractFingerprint, finalHoldoutPaperHash,
} from "@evolution/core";
import { serverBaselineFingerprint } from "./server-baseline-evidence";
import { serverHtmlNativeRunsMatchOriginal } from "./server-html-native-runs";

const blocked = "[server-campaign-planned-baseline-refresh-pending] 已有 Candidate 规划，但其输入、终验或审批绑定不完整；保留原规划并停止，不自动重新生成。";

/** Refresh observations for an existing hypothesis without spending another planning slot. */
export function plannedBaselineRefresh(project: EvolveProject, routeFingerprint?: string, at = new Date().toISOString()) {
  const checkpoint = project.campaign.checkpoint;
  const stored = project.baselineRun.plannedRefresh;
  if (checkpoint?.completedPhase !== "plan") return stored ? { blocker: blocked } : undefined;
  const parsed = stored ? PlannedBaselineRefreshSchema.safeParse(stored) : undefined;
  if (parsed && !parsed.success) return { blocker: blocked };
  const prior = parsed?.success ? parsed.data : undefined;
  if (!Number.isFinite(Date.parse(at)) || prior?.failedAt && Date.parse(at) < Date.parse(prior.failedAt)) return { blocker: blocked };
  const selected = project.selectedCandidateIds;
  const paper = project.finalHoldout;
  if (!(prior ? ["plan", "baseline"].includes(project.stage) : project.stage === "plan")
    || checkpoint.round !== project.campaign.currentRound + 1 || campaignRepairLimitStopReason(project)
    || (prior ? prior.status !== "retryable" || !["failed", "completed"].includes(project.baselineRun.status)
      : !baselineReadiness(project).ready || !serverHtmlNativeRunsMatchOriginal(project, project.baselineRun.runs))
    || project.baselineRun.measurementFingerprint !== serverBaselineFingerprint(project, routeFingerprint)
    || project.gates.find(g => g.id === "experiment-ready")?.status !== "approved"
    || !selected.length || selected.length > project.campaign.candidateCount || new Set(selected).size !== selected.length
    || !paper || paper.round !== checkpoint.round
    || paper.contractFingerprint !== finalHoldoutContractFingerprint(project)
    || paper.paperHash !== finalHoldoutPaperHash(paper.suite)
    || project.validationRun.independentFinal?.paperHash === paper.paperHash) return { blocker: blocked };
  try { assertIndependentFinalPaper(project, paper.suite); } catch { return { blocker: blocked }; }
  for (const id of selected) {
    const matches = project.candidates.filter(candidate => candidate.id === id);
    const candidate = matches[0];
    if (matches.length !== 1 || !candidate || candidate.status !== "queued"
      || candidate.artifactSnapshots.some(snapshot => snapshot.frozenArtifact)
      || candidate.finalHoldoutPaperHash !== paper.paperHash || candidateFailureContextBlocker(project, candidate)
      || project.experimentRun.candidateResults.some(result => result.candidateId === id)
      || project.experimentRun.executionCheckpoints?.some(record => record.candidateId === id)) return { blocker: blocked };
  }
  const originalReferences = prior?.originalReferences ?? project.baselineRun.originalReferences ?? [];
  const sourceBaselineId = prior?.sourceBaselineId ?? project.baselineRun.id;
  const measurementFingerprint = serverBaselineFingerprint(project, routeFingerprint);
  const planFingerprint = fastHash({
    version: "planned-baseline-refresh-v1", missionId: project.id, checkpoint, sourceBaselineId, measurementFingerprint,
    selected, candidates: selected.map(id => project.candidates.find(candidate => candidate.id === id)),
    paperHash: paper.paperHash, paperContract: paper.contractFingerprint, originalReferences,
    experimentApproval: project.gates.find(g => g.id === "experiment-ready"),
    failureSources: project.failureObservationSources, policy: project.experimentPolicy,
    bounds: { startedAt: project.campaign.startedAt, stopCriteria: project.campaign.stopCriteria, candidateCount: project.campaign.candidateCount,
      repairAttempts: project.artifactAcceptance.attempts, maxRepairAttempts: project.artifactAcceptance.maxRepairAttempts },
  });
  if (prior && (prior.missionId !== project.id || prior.round !== checkpoint.round || prior.checkpointAt !== checkpoint.at
    || prior.measurementFingerprint !== measurementFingerprint || prior.planFingerprint !== planFingerprint
    || JSON.stringify(prior.candidateIds) !== JSON.stringify(selected) || prior.paperHash !== paper.paperHash)) return { blocker: blocked };
  const continuation = PlannedBaselineRefreshSchema.safeParse({
    schemaVersion: "planned-baseline-refresh-v1", missionId: project.id, round: checkpoint.round, checkpointAt: checkpoint.at,
    sourceBaselineId, measurementFingerprint, planFingerprint, candidateIds: selected, paperHash: paper.paperHash, originalReferences,
    createdAt: prior?.createdAt ?? at, attemptStartedAt: at, status: "refreshing",
  });
  return continuation.success ? { checkpoint, continuation: continuation.data } : { blocker: blocked };
}

export function failedPlannedBaselineRefresh(baseline: BaselineRun, kind: NonNullable<PlannedBaselineRefresh["failureKind"]>, at: string,
  status: "retryable" | "unsettled"): BaselineRun {
  return baseline.plannedRefresh ? { ...baseline, plannedRefresh: PlannedBaselineRefreshSchema.parse({
    ...baseline.plannedRefresh, status, failedAt: at, failureKind: kind,
  }) } : baseline;
}

/** A fresh read may not silently change the Original underneath an already planned edit. */
export function samePlannedOriginalReferences(before: OriginalArtifactReferenceProof[] | undefined, after: OriginalArtifactReferenceProof[] | undefined) {
  const normalize = (refs: OriginalArtifactReferenceProof[] | undefined) => (refs ?? []).map(ref => ({
    missionId: ref.missionId, sourceArtifactId: ref.sourceArtifactId, blobId: ref.blobId, sha256: ref.sha256, sizeBytes: ref.sizeBytes,
  })).sort((a, b) => a.sourceArtifactId.localeCompare(b.sourceArtifactId));
  const left = normalize(before), right = normalize(after);
  return new Set(left.map(ref => ref.sourceArtifactId)).size === left.length
    && new Set(right.map(ref => ref.sourceArtifactId)).size === right.length && JSON.stringify(left) === JSON.stringify(right);
}
