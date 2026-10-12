import type { EvolveProject, TestCase } from "@evolution/contracts";
import {
  campaignLiveObservationFresh,
  campaignScoringInputBlocker,
  hasAuthoritativeHiddenRelease,
  settleArtifactAcceptanceFromValidation,
} from "@evolution/core";
import { canReuseServerBaseline, serverBaselineFingerprint, serverCampaignScoringRouteBlocker } from "./server-baseline";
import { exactServerHoldoutSuite } from "./server-holdout-preflight";
import { serverHoldoutExecutionEvidenceFingerprint } from "./server-holdout-recovery";
import { serverMainFlowRecoveryActive, serverMainFlowRecoveryWait } from "./server-main-flow-wait";

/**
 * Classify an already bound Gate F wait whose only remaining operation can be local readback.
 * Composition must independently verify the receipt SHA, the new active control Job and actual
 * Source/parent/Candidate bytes. Receipt metadata below is only a precheck; no acceptance is saved.
 */
export function canRecoverServerArtifactReadbackWithoutAi(
  project: EvolveProject,
  scoringRouteFingerprint?: string,
  nowMs = Date.now(),
): boolean {
  if (project.targetConnection.adapter !== "artifact" || !scoringRouteFingerprint?.trim()
    || !Number.isFinite(new Date(nowMs).getTime())) return false;
  const receipt = serverMainFlowRecoveryWait(project)
    ?? (serverMainFlowRecoveryActive(project) ? project.campaign.serverRecoveryWait : undefined);
  if (receipt?.marker !== "artifact-acceptance-evidence-pending"
    || project.stage !== "validation"
    || project.campaign.checkpoint?.round !== project.campaign.currentRound + 1
    || project.campaign.checkpoint.completedPhase !== "validation"
    || campaignScoringInputBlocker(project)
    || serverCampaignScoringRouteBlocker(project, scoringRouteFingerprint)
    || !canReuseServerBaseline(project, scoringRouteFingerprint, nowMs)) return false;

  const validation = project.validationRun;
  const matching = project.candidates.filter(candidate => candidate.id === validation.candidateId);
  const candidate = matching.length === 1 ? matching[0] : undefined;
  if (!candidate || candidate.artifactBuildStatus !== "ready"
    || project.experimentRun.status !== "completed"
    || (project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId) !== candidate.id
    || validation.id !== "validation-server-r" + receipt.round
    || !validation.executionArtifactFingerprint
    || !/^[0-9a-f]{64}$/.test(validation.executionArtifactFingerprint)
    || validation.executionEvidenceFingerprint !== serverHoldoutExecutionEvidenceFingerprint(validation)) return false;

  let hiddenSuite: TestCase[];
  try { hiddenSuite = exactServerHoldoutSuite(project); } catch { return false; }
  if (!hasAuthoritativeHiddenRelease(validation, candidate.id, hiddenSuite)
    || validation.baselineContextFingerprint !== serverBaselineFingerprint({ ...project, evalSuite: hiddenSuite }, scoringRouteFingerprint)) return false;

  const visibleObservedAt = Date.parse(project.baselineRun.completedAt ?? "");
  const hiddenObservedAt = validation.baselineObservedAt;
  if (!Number.isFinite(visibleObservedAt) || visibleObservedAt <= 0 || visibleObservedAt > nowMs
    || !Number.isFinite(hiddenObservedAt) || !hiddenObservedAt || hiddenObservedAt <= 0 || hiddenObservedAt > nowMs
    || !campaignLiveObservationFresh(project, new Date(hiddenObservedAt).toISOString(), nowMs)) return false;

  const frozenArtifacts = candidate.artifactSnapshots.flatMap(snapshot => snapshot.frozenArtifact ? [snapshot.frozenArtifact] : []);
  // The hypothetical metadata result is never returned as proof or persisted. Gate F still reads bytes.
  return settleArtifactAcceptanceFromValidation({
    project, candidate, validation, frozenArtifacts, now: new Date(nowMs).toISOString(),
  }).status === "passed";
}
