import type { Candidate, EvolveProject, SourceArtifact } from "@evolution/contracts";
import { retrieveTextContext, trustedServerBaselineChampion } from "@evolution/harness";

export const SERVER_TEXT_FAMILY = /^(txt|md|markdown|mdx|csv|tsv|json|yaml|yml|css|js|jsx|ts|tsx|html|htm|xml|svg)$/i;

export function isServerTextEditBlueprint(content: string) {
  try { return (JSON.parse(content) as { kind?: unknown })?.kind === "text-edits"; }
  catch { return false; }
}

function compactStructured(artifact: SourceArtifact, candidate: Candidate) {
  const data = artifact.structuredContent as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const query = [
    ...(candidate.designRationale?.sourceEvidence ?? []),
    ...candidate.patches.map((patch) => `${patch.target} ${patch.rationale}`),
  ].join(" ").toLowerCase();
  const entries = Array.isArray(data.entries) ? data.entries as Array<Record<string, unknown>> : [];
  const ranked = entries.map((entry) => {
    const path = String(entry.path ?? "");
    const content = String(entry.content ?? "");
    const haystack = `${path}\n${content}`.toLowerCase();
    const score = query.split(/\s+/).filter((token) => token.length >= 3 && haystack.includes(token)).length;
    return { path, content: content.slice(0, 5000), score };
  }).filter((entry) => entry.path || entry.content)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
  return {
    kind: data.kind,
    manifest: Array.isArray(data.manifest) ? data.manifest.slice(0, 240) : artifact.structure.slice(0, 240),
    relevantEntries: ranked,
  };
}

export async function buildServerCandidateTargetContext(project: EvolveProject, candidate: Candidate, readCurrentText: (source: SourceArtifact) => Promise<string>) {
  const champion = trustedServerBaselineChampion(project);
  const championBySource = new Map((champion?.artifactSnapshots ?? []).map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
  let remaining = 72_000;
  const result = [];
  for (const artifact of project.sourceArtifacts.filter((artifact) => artifact.role === "target")) {
    const parent = championBySource.get(artifact.id);
    const textTarget = SERVER_TEXT_FAMILY.test(artifact.extension);
    const source = textTarget ? await readCurrentText(artifact) : parent?.content || artifact.textContent || artifact.textExcerpt || "";
    const allowance = Math.max(0, Math.min(22_000, remaining));
    const query = [project.goal, project.evolutionCommand, candidate.title, candidate.change, candidate.hypothesis, ...(candidate.designRationale?.sourceEvidence ?? []), ...candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === artifact.id).map((patch) => `${patch.target} ${patch.rationale}`)].join(" ");
    const content = textTarget ? retrieveTextContext(source, query, { maxChars: allowance, maxChunks: 6 }) : source.slice(0, allowance);
    remaining = Math.max(0, remaining - content.length);
    result.push({
      id: artifact.id,
      name: artifact.name,
      mimeType: artifact.mimeType,
      extension: artifact.extension,
      artifactKind: artifact.artifactKind,
      descriptor: artifact.artifactDescriptor,
      structure: artifact.structure.slice(0, 120),
      currentVersion: parent ? (project.searchChampion?.versionLabel ?? champion?.id) : project.version,
      currentSnapshotHash: parent?.contentHash,
      content,
      originalChars: source.length,
      truncated: content.length < source.length,
      mutationMode: textTarget && content.length < source.length ? "text-edits" : "full",
      structuredContext: compactStructured(artifact, candidate),
    });
  }
  return result;
}

