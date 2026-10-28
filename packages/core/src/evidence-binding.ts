import type { Candidate, EvolveProject } from "@evolution/contracts";
import { fastHash } from "./stable-hash";

/** Bind proof to actual content, not a mutable candidate ID or caller-supplied hash. */
export function evidenceFingerprint(project: EvolveProject, candidate: Candidate) {
  return fastHash(JSON.stringify([
    candidate.finalHoldoutPaperHash?"artifact-proof-v2":"artifact-proof-v1", candidate.id,
    ...(project.failureObservationSources?.length?[{failureObservationSources:project.failureObservationSources}]:[]),
    ...(candidate.planningFailureObservationUse?[{planningFailureObservationUse:candidate.planningFailureObservationUse}]:[]),
    ...(candidate.finalHoldoutPaperHash?[candidate.finalHoldoutPaperHash]:[]),
    candidate.artifactSnapshots.map((item) => [item.sourceArtifactId, item.name, item.mimeType, item.content]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    project.sourceArtifacts.map((item) => [item.id, item.role, item.textContent, item.structuredContent]),
    project.goal, project.evolutionCommand, project.protectedItems, project.acceptanceRubric,
    project.hiddenEvalSuite, project.metrics.map(({ key, target, direction }) => ({ key, target, direction })),
    ...(project.experimentPolicy?.winnerGoalScope?[{winnerGoalScope:project.experimentPolicy.winnerGoalScope}]:[]),
    ...(project.experimentPolicy?.judgeFileMetadata?[{judgeFileMetadata:project.experimentPolicy.judgeFileMetadata,
      sourceMetadata:project.sourceArtifacts.filter(s=>s.role==="target").map(s=>[s.id,s.name,s.mimeType]),
      originalReferences:project.baselineRun.originalReferences,
      frozenMetadata:candidate.artifactSnapshots.map(s=>s.frozenArtifact&&[s.sourceArtifactId,s.frozenArtifact.sha256,s.frozenArtifact.name,s.frozenArtifact.mimeType,s.frozenArtifact.size]),
    }]:[]),
  ]));
}
