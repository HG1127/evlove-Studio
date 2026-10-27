import type { Candidate, EvolveProject } from "@evolution/contracts";
import { fastHash } from "./stable-hash";

/** Bind proof to actual content, not a mutable candidate ID or caller-supplied hash. */
export function evidenceFingerprint(project: EvolveProject, candidate: Candidate) {
  return fastHash(JSON.stringify([
    candidate.finalHoldoutPaperHash?"artifact-proof-v2":"artifact-proof-v1", candidate.id,
    ...(candidate.finalHoldoutPaperHash?[candidate.finalHoldoutPaperHash]:[]),
    candidate.artifactSnapshots.map((item) => [item.sourceArtifactId, item.name, item.mimeType, item.content]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    project.sourceArtifacts.map((item) => [item.id, item.role, item.textContent, item.structuredContent]),
    project.goal, project.evolutionCommand, project.protectedItems, project.acceptanceRubric,
    project.hiddenEvalSuite, project.metrics.map(({ key, target, direction }) => ({ key, target, direction })),
    ...(project.experimentPolicy?.winnerGoalScope?[{winnerGoalScope:project.experimentPolicy.winnerGoalScope}]:[]),
  ]));
}
