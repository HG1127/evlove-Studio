import { htmlCandidateProtection } from "@evolution/core";
import type { CandidateArtifactSnapshot, EvolveProject } from "../schemas";

/** Compatibility shim: shared pure protection rules also run on the durable server path. */
export function htmlCandidateGuard(project: EvolveProject, snapshots: CandidateArtifactSnapshot[]) {
  return snapshots.flatMap((snapshot) => {
    const source = project.sourceArtifacts.find((artifact) => artifact.id === snapshot.sourceArtifactId);
    if (!source || !(/^(html|htm)$/i.test(source.extension) || /^text\/html(?:;|$)/i.test(source.mimeType))) return [];
    return [htmlCandidateProtection({
      sourceArtifactId: source.id, originalHtml: source.textContent ?? "",
      candidateHtml: snapshot.content, protectedItems: project.protectedItems,
    })];
  });
}
