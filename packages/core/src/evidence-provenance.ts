import type { EvidenceRef, EvolveProject } from "@evolution/contracts";

function rawFastHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tokens(value: string) {
  const normalized = value.toLowerCase();
  const latin = normalized.match(/[a-z0-9._/-]{3,}/g) ?? [];
  const han = (normalized.match(/\p{Script=Han}+/gu) ?? []).flatMap((segment) => {
    if (segment.length <= 4) return [segment];
    const grams: string[] = [];
    for (let size = 4; size >= 2; size -= 1) for (let index = 0; index <= segment.length - size; index += 1) grams.push(segment.slice(index, index + size));
    return grams;
  });
  return [...new Set([...latin, ...han].filter((item) => !["当前", "问题", "用户", "系统", "内容", "需要", "没有", "已经"].includes(item)))];
}

function overlap(claim: string, text: string) {
  const source = text.toLowerCase();
  // A single generic two-character overlap (for example “存在”) is too weak to turn
  // an AI-written claim into verified evidence. Weight matches by token length so one
  // precise 4-char phrase / filename or multiple shorter overlaps are required.
  return tokens(claim).reduce((score, token) => score + (source.includes(token) ? Math.min(8, token.length) : 0), 0);
}

function evidenceMatch(score: number) {
  return score >= 4;
}

function excerptAround(text: string, claim: string) {
  const token = tokens(claim).sort((a, b) => b.length - a.length).find((item) => text.toLowerCase().includes(item));
  const at = token ? text.toLowerCase().indexOf(token) : 0;
  return text.slice(Math.max(0, at - 90), Math.min(text.length, at + 260)).trim();
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function structuredEvidence(artifact: EvolveProject["sourceArtifacts"][number]) {
  const data = artifact.structuredContent as Record<string, unknown> | undefined;
  if (!data) return [] as Array<{ text: string; path?: string }>;
  const candidates: Array<{ text: string; path?: string }> = [];
  const add = (text: unknown, path?: unknown) => {
    if (typeof text !== "string" || !text.trim()) return;
    candidates.push({ text: text.slice(0, 50_000), path: typeof path === "string" && path ? path : undefined });
  };
  const evolutionBase = data.evolutionBaseSnapshot as Record<string, unknown> | undefined;
  for (const file of records(evolutionBase?.files).slice(0, 200)) add(file.content, file.path);
  for (const entry of records(data.entries).slice(0, 800)) add(entry.content, entry.path);
  for (const slide of records(data.slides).slice(0, 120)) {
    const text = records(slide.textRuns).map((run) => String(run.text ?? "")).filter(Boolean).join("\n");
    add(text, slide.path ?? (slide.number !== undefined ? `slide:${slide.number}` : undefined));
  }
  for (const part of records(data.parts).slice(0, 160)) {
    const text = records(part.textRuns).map((run) => String(run.text ?? "")).filter(Boolean).join("\n");
    add(text, part.path);
  }
  for (const sheet of records(data.sheets).slice(0, 40)) {
    const cells = records(sheet.cells).slice(0, 1500).map((cell) => `${cell.address ?? ""}=${cell.formula ?? cell.value ?? ""}`).join("\n");
    add([typeof sheet.csv === "string" ? sheet.csv.slice(0, 30_000) : "", cells].filter(Boolean).join("\n"), sheet.name !== undefined ? `sheet:${String(sheet.name)}` : undefined);
  }
  return candidates;
}

/** Resolve model-written evidence into machine-checkable project locations. */
export function resolveEvidenceRefs(project: EvolveProject, claims: string[]): EvidenceRef[] {
  return claims.map((claim, index) => {
    const runCandidates = project.baselineRun.runs.flatMap((run) => [
      { run, text: run.output, traceId: undefined as string | undefined },
      ...run.trace.map((trace) => ({ run, text: `${trace.summary} ${trace.detail ?? ""}`, traceId: trace.id })),
    ]).map((candidate) => ({ ...candidate, score: overlap(claim, candidate.text) })).sort((a, b) => b.score - a.score);
    const bestRun = runCandidates[0];
    if (bestRun && evidenceMatch(bestRun.score)) {
      const excerpt = excerptAround(bestRun.text, claim);
      return { id: `evidence-${index}-${rawFastHash(claim)}`, claim, kind: bestRun.traceId ? "trace" as const : "test" as const, verified: true, testCaseId: bestRun.run.testCaseId, traceId: bestRun.traceId, excerpt, contentHash: rawFastHash(excerpt) };
    }

    const championSnapshots = project.searchChampion?.candidate?.artifactSnapshots ?? [];
    const sourceCandidates = project.sourceArtifacts.flatMap((artifact) => {
      const champion = championSnapshots.find((snapshot) => snapshot.sourceArtifactId === artifact.id);
      const text = [champion?.content, artifact.textContent, artifact.textExcerpt, artifact.summary].filter(Boolean).join("\n");
      const direct = { artifact, text, path: champion ? `search-champion:${project.searchChampion?.versionLabel ?? project.searchChampion?.id}` : undefined as string | undefined, score: overlap(claim, text) };
      const structures = artifact.structure.map((path) => ({ artifact, text: path, path, score: overlap(claim, path) }));
      const native = structuredEvidence(artifact).map((item) => ({ artifact, text: item.text, path: item.path, score: overlap(claim, item.text) + (item.path ? overlap(claim, item.path) : 0) }));
      return [direct, ...native, ...structures];
    }).sort((a, b) => b.score - a.score);
    const bestSource = sourceCandidates[0];
    if (bestSource && evidenceMatch(bestSource.score)) {
      const excerpt = excerptAround(bestSource.text, claim);
      return { id: `evidence-${index}-${rawFastHash(claim)}`, claim, kind: bestSource.path ? "structure" as const : "source" as const, verified: true, artifactId: bestSource.artifact.id, path: bestSource.path, excerpt, contentHash: rawFastHash(excerpt) };
    }
    return { id: `evidence-${index}-${rawFastHash(claim)}`, claim, kind: "unresolved" as const, verified: false };
  });
}

export function evidenceRefSummary(refs: EvidenceRef[]) {
  const verified = refs.filter((ref) => ref.verified).length;
  return { verified, total: refs.length, coverage: refs.length ? Math.round(verified / refs.length * 100) : 0 };
}
