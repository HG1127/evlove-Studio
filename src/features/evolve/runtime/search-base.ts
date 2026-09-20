import type { Candidate, CandidateArtifactSnapshot, EvolveProject, SourceArtifact } from "../schemas";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.flatMap((item) => record(item) ? [record(item)!] : []) : [];
}

function parseRecord(text: string): JsonRecord | undefined {
  try { return record(JSON.parse(text)); } catch { return undefined; }
}

function fingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

function runIndex(run: unknown, fallback: number) {
  const item = record(run);
  return item && Number.isInteger(item.index) ? Number(item.index) : fallback;
}

function mergeRuns(baseValue: unknown, patchValue: unknown) {
  const base = Array.isArray(baseValue) ? baseValue : [];
  const patch = Array.isArray(patchValue) ? patchValue : [];
  const merged = new Map<number, unknown>();
  base.forEach((item, index) => merged.set(runIndex(item, index), item));
  patch.forEach((item, index) => merged.set(runIndex(item, index), item));
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
}

function mergeByKey(baseValue: unknown, patchValue: unknown, key: string, merge: (base: JsonRecord | undefined, patch: JsonRecord) => JsonRecord) {
  const base = records(baseValue);
  const patch = records(patchValue);
  const order: string[] = [];
  const byKey = new Map<string, JsonRecord>();
  for (const item of base) {
    const value = String(item[key] ?? "");
    if (!value) continue;
    order.push(value);
    byKey.set(value, item);
  }
  for (const item of patch) {
    const value = String(item[key] ?? "");
    if (!value) continue;
    if (!byKey.has(value)) order.push(value);
    byKey.set(value, merge(byKey.get(value), item));
  }
  return order.flatMap((value) => byKey.get(value) ? [byKey.get(value)!] : []);
}

function mergePresentation(base: JsonRecord, patch: JsonRecord) {
  return {
    ...base,
    ...patch,
    slides: mergeByKey(base.slides, patch.slides, "number", (prior, next) => ({
      ...(prior ?? {}), ...next,
      textRuns: mergeRuns(prior?.textRuns, next.textRuns),
    })),
  };
}

function mergeDocument(base: JsonRecord, patch: JsonRecord) {
  return {
    ...base,
    ...patch,
    parts: mergeByKey(base.parts, patch.parts, "path", (prior, next) => ({
      ...(prior ?? {}), ...next,
      textRuns: mergeRuns(prior?.textRuns, next.textRuns),
    })),
  };
}

function mergeSpreadsheet(base: JsonRecord, patch: JsonRecord) {
  return {
    ...base,
    ...patch,
    sheets: mergeByKey(base.sheets, patch.sheets, "name", (prior, next) => ({
      ...(prior ?? {}), ...next,
      rows: next.rows ?? prior?.rows,
      cells: mergeByKey(prior?.cells, next.cells, "address", (oldCell, newCell) => ({ ...(oldCell ?? {}), ...newCell })),
    })),
  };
}

function mergePackageBlueprint(base: JsonRecord, patch: JsonRecord) {
  return {
    ...base,
    ...patch,
    overlay: true,
    files: mergeByKey(base.files, patch.files, "path", (_prior, next) => next),
  };
}

function mergedStructuredContent(source: SourceArtifact, snapshotContent: string) {
  const patch = parseRecord(snapshotContent);
  const base = record(source.structuredContent);
  if (!patch) return source.structuredContent;
  const descriptor = source.artifactDescriptor;
  if (source.artifactKind === "presentation" || descriptor?.adapterId === "presentation-pptx-ooxml") return mergePresentation(base ?? {}, patch);
  if (descriptor?.adapterId === "document-docx-ooxml") return mergeDocument(base ?? {}, patch);
  if (source.artifactKind === "spreadsheet" || descriptor?.family === "spreadsheet") return mergeSpreadsheet(base ?? {}, patch);
  if (source.artifactKind === "codebase" || descriptor?.family === "codebase" || descriptor?.family === "package") {
    const files = records(patch.files);
    const fileByPath = new Map(files.map((item) => [String(item.path ?? ""), item]));
    const entries = records(base?.entries).map((entry) => {
      const file = fileByPath.get(String(entry.path ?? ""));
      return file && typeof file.content === "string" ? { ...entry, content: file.content } : entry;
    });
    return {
      ...(base ?? {}),
      ...(entries.length ? { entries } : {}),
      evolutionBaseSnapshot: { kind: patch.kind, files },
    };
  }
  return patch;
}

/** A Search Champion is a usable parent only after the exact snapshot passed Hidden Validation + Gate F. */
export function searchBaseCandidate(project: EvolveProject): Candidate | undefined {
  const champion = project.searchChampion;
  const candidate = champion?.candidate;
  if (!candidate?.artifactSnapshots.length) return undefined;
  if (champion?.validation?.status !== "completed" || champion.validation.recommendation !== "release") return undefined;
  if (champion.artifactAcceptance?.status !== "passed" || champion.artifactAcceptance.candidateId !== candidate.id) return undefined;
  return candidate;
}

/**
 * Present the accepted Search Champion as the current working source without destroying the immutable
 * original source. Diagnostics and planning therefore inspect the version that will actually be mutated,
 * while final acceptance can still compare the cumulative child with the original upload.
 */
export function projectAtSearchChampion(project: EvolveProject): EvolveProject {
  const candidate = searchBaseCandidate(project);
  if (!candidate) return project;
  const snapshotBySource = new Map(candidate.artifactSnapshots.map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
  const versionLabel = project.searchChampion?.versionLabel ?? "Search Champion";
  return {
    ...project,
    sourceArtifacts: project.sourceArtifacts.map((source) => {
      if (source.role !== "target") return source;
      const snapshot = snapshotBySource.get(source.id);
      if (!snapshot) return source;
      const structuredContent = mergedStructuredContent(source, snapshot.content);
      const structuredFamily = source.artifactKind === "presentation" || source.artifactKind === "spreadsheet" || source.artifactKind === "codebase"
        || source.artifactDescriptor?.adapterId === "document-docx-ooxml" || source.artifactDescriptor?.family === "package";
      return {
        ...source,
        textContent: structuredFamily ? source.textContent : snapshot.content,
        textExcerpt: structuredFamily ? `${source.textExcerpt ?? ""}\n\n[当前 ${versionLabel} 变更快照]\n${snapshot.content.slice(0, 4000)}`.trim() : snapshot.content.slice(0, 4000),
        structuredContent,
        summary: `${source.summary ?? source.name} · 当前进化基底：${versionLabel}`,
      };
    }),
  };
}

function mergeSnapshotContent(source: SourceArtifact | undefined, parentContent: string, childContent: string) {
  if (!source) return childContent;
  const parent = parseRecord(parentContent);
  const child = parseRecord(childContent);
  if (!parent || !child) return childContent;
  const descriptor = source.artifactDescriptor;
  if (source.artifactKind === "presentation" || descriptor?.adapterId === "presentation-pptx-ooxml") return JSON.stringify(mergePresentation(parent, child), null, 2);
  if (descriptor?.adapterId === "document-docx-ooxml") return JSON.stringify(mergeDocument(parent, child), null, 2);
  if (source.artifactKind === "spreadsheet" || descriptor?.family === "spreadsheet") return JSON.stringify(mergeSpreadsheet(parent, child), null, 2);
  if (source.artifactKind === "codebase" || descriptor?.family === "codebase" || descriptor?.family === "package") return JSON.stringify(mergePackageBlueprint(parent, child), null, 2);
  return childContent;
}

/** Compose a child delta with the accepted parent snapshot so every evaluated child is cumulative. */
export function composeCandidateOnSearchChampion(project: EvolveProject, candidate: Candidate): Candidate {
  const parent = searchBaseCandidate(project);
  if (!parent) return candidate;
  const parentBySource = new Map(parent.artifactSnapshots.map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
  const sourceById = new Map(project.sourceArtifacts.map((source) => [source.id, source]));
  const baseLabel = project.searchChampion?.versionLabel ?? parent.id;
  const artifactSnapshots: CandidateArtifactSnapshot[] = candidate.artifactSnapshots.map((snapshot) => {
    const parentSnapshot = parentBySource.get(snapshot.sourceArtifactId);
    if (!parentSnapshot) return snapshot;
    const content = mergeSnapshotContent(sourceById.get(snapshot.sourceArtifactId), parentSnapshot.content, snapshot.content);
    return {
      ...snapshot,
      content,
      contentHash: fingerprint(content),
      notes: [...new Set([...snapshot.notes, `累积进化：本成果以已验收 ${baseLabel} 为父代继续变异。`])],
    };
  });
  return {
    ...candidate,
    artifactSnapshots,
    artifactBuildSummary: `${candidate.artifactBuildSummary ?? "Candidate 已构造"}；父代 ${baseLabel} 的已验收改动已并入当前完整快照。`,
  };
}
