import type { EvolveProject } from "@evolution/contracts";
import { campaignRepairLimitStopReason, evidenceFingerprint, hasFullHiddenMeasurement, independentFinalReadiness, verifiedValidationFailures } from "@evolution/core";
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

/** Continue actionable negative evidence without resolving an unrelated evidence request. */
export function hasServerFrozenVerifiedRejection(project:EvolveProject){
  if(!["idle","running"].includes(project.campaign.status)||campaignRepairLimitStopReason(project)
    ||!hasServerFrozenValidationCheckpoint(project)||project.validationRun.evaluation?.safety==="FAIL")return false;
  const id=project.experimentRun.winnerId??project.experimentRun.pendingEvidenceCandidateId;
  const candidate=project.candidates.find(item=>item.id===id);
  return Boolean(candidate&&project.validationRun.candidateId===id
    &&project.validationRun.evidenceFingerprint===evidenceFingerprint(project,candidate)
    &&hasFullHiddenMeasurement(project.validationRun,id!,project.hiddenEvalSuite)
    &&verifiedValidationFailures(project,project.validationRun).some(criterion=>criterion.hardGate)
    &&!independentFinalReadiness(project,candidate,project.validationRun).failed);
}
