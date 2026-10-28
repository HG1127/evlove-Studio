import type { EvolveProject, OriginalArtifactReferenceProof } from "@evolution/contracts";
import {
  assertIndependentFinalPaper, baselineReadiness, candidateFailureContextBlocker, finalHoldoutContractFingerprint, finalHoldoutPaperHash,
} from "@evolution/core";
import { serverBaselineFingerprint } from "./server-baseline-evidence";

const blocked = "[server-campaign-planned-baseline-refresh-pending] 已有 Candidate 规划，但其输入、终验或审批绑定不完整；保留原规划并停止，不自动重新生成。";

/** Refresh observations for an existing hypothesis without spending another planning slot. */
export function plannedBaselineRefresh(project: EvolveProject, routeFingerprint?: string) {
  const checkpoint = project.campaign.checkpoint;
  if (checkpoint?.completedPhase !== "plan") return undefined;
  const selected = project.selectedCandidateIds;
  const paper = project.finalHoldout;
  if (project.stage !== "plan" || checkpoint.round !== project.campaign.currentRound + 1
    || !baselineReadiness(project).ready
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
  return { checkpoint };
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
