import type { Candidate, EvolveProject, SourceArtifact } from "@evolution/contracts";
import { buildExactCandidateTextEdits } from "@evolution/core";
import { CandidateConstructionOutputError, retrieveTextContext, trustedServerBaselineChampion, verifiedCandidateTextAnchors } from "@evolution/harness";

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

export async function buildServerCandidateTargetContext(project: EvolveProject, candidate: Candidate, readCurrentText: (source: SourceArtifact) => Promise<string>, parentCandidate?: Candidate) {
  const champion = parentCandidate ?? trustedServerBaselineChampion(project);
  const championBySource = new Map((champion?.artifactSnapshots ?? []).map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
  let remaining = 72_000;
  const result = [];
  for (const artifact of project.sourceArtifacts.filter((artifact) => artifact.role === "target")) {
    const parent = championBySource.get(artifact.id);
    const textTarget = SERVER_TEXT_FAMILY.test(artifact.extension);
    const source = textTarget ? await readCurrentText(artifact) : parent?.content || artifact.textContent || artifact.textExcerpt || "";
    const allowance = Math.max(0, Math.min(22_000, remaining));
    const query = [project.goal, project.evolutionCommand, candidate.title, candidate.change, candidate.hypothesis, ...(candidate.designRationale?.sourceEvidence ?? []), ...candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === artifact.id).map((patch) => `${patch.target} ${patch.rationale}`)].join(" ");
    const verifiedAnchors=textTarget?verifiedCandidateTextAnchors(source,[...(candidate.designRationale?.sourceEvidence??[]),...candidate.patches.filter(patch=>!patch.artifactId||patch.artifactId===artifact.id).map(patch=>patch.target)],{maxChars:Math.min(2000,allowance)}):[];
    const anchorChars=verifiedAnchors.reduce((sum,anchor)=>sum+anchor.text.length,0);
    const content = textTarget ? retrieveTextContext(source, query, { maxChars: allowance-anchorChars, maxChunks: 6 }) : source.slice(0, allowance);
    remaining = Math.max(0, remaining - content.length - anchorChars);
    result.push({
      id: artifact.id,
      name: parent?.name ?? artifact.name,
      mimeType: parent?.mimeType ?? artifact.mimeType,
      extension: artifact.extension,
      artifactKind: artifact.artifactKind,
      descriptor: artifact.artifactDescriptor,
      structure: artifact.structure.slice(0, 120),
      currentVersion: parentCandidate?.id ?? (parent ? (project.searchChampion?.versionLabel ?? champion?.id) : project.version),
      currentSnapshotHash: parent?.contentHash,
      content,
      verifiedAnchors,
      originalChars: source.length,
      truncated: content.length < source.length,
      mutationMode: textTarget && content.length < source.length ? "text-edits" : "full",
      structuredContext: compactStructured(artifact, candidate),
    });
  }
  return result;
}

export function requireServerCandidateOutputModes(contexts: Array<{id: string; name: string; mutationMode: string}>, artifacts: Array<{sourceArtifactId: string; content: string}>) {
  for (const context of contexts) {
    const output = artifacts.find((artifact) => artifact.sourceArtifactId === context.id);
    if (context.mutationMode === "text-edits" && output && !isServerTextEditBlueprint(output.content)) {
      throw new CandidateConstructionOutputError("output-mode", `${context.name} 的 AI 上下文只是原文件片段，必须返回 text-edits；禁止用片段重写完整成果。`);
    }
  }
}


/** Build all Target edits before freezing any file; otherwise retain the normal AI builder. */
export async function buildServerExactCandidateArtifacts(
  project: EvolveProject,
  candidate: Candidate,
  readCurrentText: (source: SourceArtifact) => Promise<string>,
) {
  const targets = project.sourceArtifacts.filter((source) => source.role === "target");
  const ids = new Set(targets.map((source) => source.id));
  if (!targets.length || ids.size !== targets.length || !candidate.patches.length
    || new Set(candidate.patches.map((patch) => patch.id)).size !== candidate.patches.length
    || targets.some((source) => !SERVER_TEXT_FAMILY.test(source.extension)
      || source.artifactKind === "codebase" || ["codebase", "package"].includes(source.artifactDescriptor?.family ?? ""))
    || candidate.patches.some((patch) => patch.artifactId ? !ids.has(patch.artifactId) : targets.length !== 1)) return undefined;
  const artifacts = [];
  const champion = trustedServerBaselineChampion(project);
  for (const source of targets) {
    const patches = candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === source.id);
    const current = await readCurrentText(source);
    const content = patches.length ? buildExactCandidateTextEdits(current, patches) : current;
    if (!content) return undefined;
    const parent = champion?.artifactSnapshots.find((snapshot) => snapshot.sourceArtifactId === source.id);
    artifacts.push({sourceArtifactId: source.id, name: parent?.name ?? source.name, mimeType: parent?.mimeType ?? source.mimeType, content,
      buildMode: "deterministic" as const, notes: [patches.length ? "完整父代文件上的精确方案修改；无需再次生成文件内容。" : "该 Target 不在本次修改范围；保留完整父代文件。"]});
  }
  return artifacts;
}
