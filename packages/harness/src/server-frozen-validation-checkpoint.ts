import type { EvolveProject } from "@evolution/contracts";
import { campaignRepairLimitStopReason, evidenceFingerprint, hasFullHiddenMeasurement, htmlNativeCaseSource, independentFinalReadiness, verifiedValidationFailures } from "@evolution/core";
import { hasCompleteServerExperimentFrozenSet, serverFrozenRepairCandidate } from "./server-experiment-recovery";
import {hasServerPendingVisibleRepair} from "./server-visible-repair";

/** Structural routing only. Holdout/Gate F still re-read the exact physical files. */
export function hasServerFrozenValidationCheckpoint(project: EvolveProject) {
  if(hasServerPendingVisibleRepair(project))return true;
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
  if(hasServerPendingVisibleRepair(project))return true;
  const id=project.experimentRun.winnerId??project.experimentRun.pendingEvidenceCandidateId;
  const candidate=project.candidates.find(item=>item.id===id);
  return Boolean(candidate&&project.validationRun.candidateId===id
    &&project.validationRun.evidenceFingerprint===evidenceFingerprint(project,candidate)
    &&hasFullHiddenMeasurement(project.validationRun,id!,project.hiddenEvalSuite)
    &&verifiedValidationFailures(project,project.validationRun).some(criterion=>criterion.hardGate)
    &&!independentFinalReadiness(project,candidate,project.validationRun).failed);
}

/** One explicit resume may remeasure native evidence on the same frozen file. A new pause still stops it. */
export function hasServerNativeHtmlHoldoutRetry(project:EvolveProject){
  if(project.campaign.status!=="idle"||campaignRepairLimitStopReason(project)
    ||project.campaign.checkpoint?.completedPhase!=="experiment"||!hasServerFrozenValidationCheckpoint(project)
    ||project.validationRun.status!=="completed"||project.validationRun.evaluation?.safety==="FAIL"
    ||project.release.status!=="idle"||project.validationRun.independentFinal)return false;
  const id=project.experimentRun.winnerId??project.experimentRun.pendingEvidenceCandidateId;
  const candidate=project.candidates.find(item=>item.id===id),suite=project.hiddenEvalSuite,runs=project.validationRun.runs;
  if(!candidate||project.validationRun.candidateId!==id||project.validationRun.evidenceFingerprint!==evidenceFingerprint(project,candidate)
    ||!suite.length||runs.length!==suite.length||new Set(suite.map(test=>test.id)).size!==suite.length
    ||new Set(runs.map(run=>run.testCaseId)).size!==runs.length)return false;
  let nativeMissing=false;
  return suite.every(test=>{
    const run=runs.find(item=>item.testCaseId===test.id);
    if(run?.verificationStatus==="verified"&&!run.error)return true;
    if(run?.verificationStatus!=="unverified"||!/^NATIVE_HTML_(?:EVIDENCE_INVALID|EXECUTION_UNAVAILABLE)$/.test(run.error??"")
      ||!htmlNativeCaseSource(project,test))return false;
    nativeMissing=true;return true;
  })&&nativeMissing;
}
