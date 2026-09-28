import type { EvolveProject } from "@evolution/contracts";
import { hasExactFrozenArtifactSet } from "./artifact-identity";
import { evidenceFingerprint } from "./evidence-binding";
import { hasAuthoritativeHiddenRelease } from "./hidden-validation-evidence";

export function campaignGoalSatisfied(project: EvolveProject) {
  const champion = project.searchChampion;
  if (!champion?.candidate || !champion.validation || !champion.artifactAcceptance) return false;
  const binding = evidenceFingerprint(project, champion.candidate);
  return Boolean(
    hasAuthoritativeHiddenRelease(champion.validation, champion.candidate.id)
    && champion.validation.evidenceFingerprint === binding
    && champion.artifactAcceptance.evidenceFingerprint === binding
    && hasExactFrozenArtifactSet(project, champion.candidate, champion.artifactAcceptance)
    && champion.artifactAcceptance.status === "passed"
    && champion.artifactAcceptance.hardGatePass
    && champion.artifactAcceptance.candidateId === champion.candidate.id,
  );
}
