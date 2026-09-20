import type { EvolveProject } from "@evolution/contracts";

export function campaignGoalSatisfied(project: EvolveProject) {
  const champion = project.searchChampion;
  return Boolean(
    champion?.candidate
    && champion.validation?.status === "completed"
    && champion.validation.recommendation === "release"
    && champion.artifactAcceptance?.status === "passed"
    && champion.artifactAcceptance.hardGatePass
    && !(champion.validation.evaluation?.unverifiedCriterionIds?.length),
  );
}
