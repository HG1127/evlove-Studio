import type { AcceptanceCriterion, EvolveProject } from "@evolution/contracts";

const LOCAL_SNAPSHOT_TEXT_EXTENSION = /^(txt|md|markdown|mdx)$/i;
const LOCAL_SNAPSHOT_ARTIFACT_KINDS = new Set(["document", "knowledge", "generic"]);

function isCodebaseProject(project: EvolveProject) {
  return project.sourceArtifacts.some((artifact) => artifact.role === "target" && artifact.artifactKind === "codebase")
    || project.objectType === "codebase"
    || project.semanticEvolution?.semanticObject.typeId === "software-system";
}

export function criterionCanUseLocalSnapshotEvidence(project: EvolveProject, criterion: AcceptanceCriterion) {
  if (["format-roundtrip", "static-structure", "cross-artifact", "semantic-judge"].includes(criterion.validationMethod)) return true;
  if (criterion.validationMethod !== "user-scenario" || isCodebaseProject(project)) return false;
  const targets = criterion.artifactIds.length
    ? project.sourceArtifacts.filter((artifact) => criterion.artifactIds.includes(artifact.id))
    : project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  if (!targets.length) return false;
  return targets.every((artifact) => LOCAL_SNAPSHOT_ARTIFACT_KINDS.has(artifact.artifactKind)
    && LOCAL_SNAPSHOT_TEXT_EXTENSION.test(artifact.extension)
    && Boolean(artifact.textContent || artifact.textExcerpt));
}
