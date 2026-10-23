import type { EvolveProject } from "@evolution/contracts";
import { evidenceFingerprint, hasFullHiddenMeasurement, verifiedValidationFailures } from "@evolution/core";
import { hasCompleteServerExperimentFrozenSet, serverFrozenRepairCandidate } from "./server-experiment-recovery";

/** Structural routing only. Holdout/Gate F still re-read the exact physical files. */
export function hasServerFrozenValidationCheckpoint(project: EvolveProject) {
  if (serverFrozenRepairCandidate(project)) return true;
  const checkpoint = project.campaign.checkpoint;
  if (project.targetConnection.adapter !== "artifact"
    || checkpoint?.round !== project.campaign.currentRound + 1
    || project.experimentRun.status !== "completed") return false;
  const id = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
  const candidates = project.candidates.filter(candidate => candidate.id === id);
  if (candidates.length !== 1 || !hasCompleteServerExperimentFrozenSet(project, candidates[0]!)) return false;
  if (checkpoint.completedPhase === "experiment") return true;
  // An old failure is actionable, never a fresh success or a basis for delivery.
  return checkpoint.completedPhase === "validation"
    && project.validationRun.evidenceFingerprint === evidenceFingerprint(project, candidates[0]!)
    && hasFullHiddenMeasurement(project.validationRun, id!, project.hiddenEvalSuite)
    && verifiedValidationFailures(project, project.validationRun).length > 0;
}
