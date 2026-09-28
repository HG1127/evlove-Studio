import type { EvolveProject } from "@evolution/contracts";
import { hasAuthoritativeHiddenRelease } from "./hidden-validation-evidence";

export function campaignGoalSatisfied(project: EvolveProject) {
  const champion = project.searchChampion;
  return Boolean(
    champion?.candidate
    && champion.validation
    && hasAuthoritativeHiddenRelease(champion.validation, champion.candidate.id)
    && champion.artifactAcceptance?.status === "passed"
    && champion.artifactAcceptance.hardGatePass
    && champion.artifactAcceptance.candidateId === champion.candidate.id,
  );
}
