import type { AcceptanceCriterion, EvolveProject } from "@evolution/contracts";

const LOCAL_SNAPSHOT_TEXT_EXTENSION = /^(txt|md|markdown|mdx|html|htm)$/i;
const LOCAL_SNAPSHOT_ARTIFACT_KINDS = new Set(["document", "knowledge", "generic"]);

function readableDocumentSource(artifact: EvolveProject["sourceArtifacts"][number]) {
  if (!LOCAL_SNAPSHOT_ARTIFACT_KINDS.has(artifact.artifactKind) || !(artifact.textContent || artifact.textExcerpt)) return false;
  if (LOCAL_SNAPSHOT_TEXT_EXTENSION.test(artifact.extension)) return true;
  if (artifact.extension.toLowerCase() !== "docx" || (artifact.artifactDescriptor && artifact.artifactDescriptor.adapterId !== "document-docx-ooxml")) return false;
  const structured = artifact.structuredContent as { parts?: unknown } | undefined;
  return Array.isArray(structured?.parts) && structured.parts.length > 0;
}

/** A local document evaluator can inspect the exact Candidate text or DOCX run blueprint. */
export function projectSupportsLocalDocumentSnapshot(project: Pick<EvolveProject, "sourceArtifacts">) {
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  return targets.length > 0 && targets.every(readableDocumentSource);
}

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
  return targets.every(readableDocumentSource);
}


/** Full static document text can be observed separately from software source/runtime. */
export function projectSupportsStaticDocumentText(project: EvolveProject) {
  return !isCodebaseProject(project) && projectSupportsLocalDocumentSnapshot(project);
}
