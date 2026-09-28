import type { EvolveProject } from "../schemas";
import { assertDeliverablePackageIdentity } from "@evolution/core";
import { saveLocalProject } from "./local-store";

const KEY = "evolve-studio:mission-review:v1";
export const MISSION_REVIEW_CHANGED_EVENT = "evolve-mission-review-changed";

type ReviewRecord = { fingerprint: string; acceptedAt: string };
type ReviewStore = Record<string, ReviewRecord>;

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
  return (value >>> 0).toString(16);
}

function read(): ReviewStore {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as ReviewStore : {};
  } catch { return {}; }
}

function legacyRecord(project: EvolveProject): ReviewRecord | undefined {
  const record = read()[project.id];
  return record && record.fingerprint === missionArtifactFingerprint(project) ? record : undefined;
}

export function missionArtifactFingerprint(project: EvolveProject) {
  const packageRows = project.outputArtifacts
    .map((artifact) => [artifact.id, artifact.kind, artifact.projectId, artifact.candidateId ?? "",
      artifact.versionLabel, artifact.sourceArtifactIds.join(","), artifact.isChampion, artifact.accepted,
      artifact.frozenArtifact?.blobId ?? "", artifact.frozenArtifact?.sha256 ?? "",
      artifact.createdAt, hash(artifact.content ?? "")].join(":"))
    .sort();
  return hash(JSON.stringify([project.id, packageRows]));
}

export function isMissionUserAccepted(project: EvolveProject) {
  try { assertDeliverablePackageIdentity(project); } catch { return false; }
  const fingerprint = missionArtifactFingerprint(project);
  const record = project.userAcceptance ?? legacyRecord(project);
  return Boolean(record && record.fingerprint === fingerprint);
}

export function acceptMissionOutputs(project: EvolveProject) {
  assertDeliverablePackageIdentity(project);
  const acceptedAt = new Date().toISOString();
  const record = { fingerprint: missionArtifactFingerprint(project), acceptedAt };
  const updated: EvolveProject = { ...project, userAcceptance: record, updatedAt: acceptedAt };
  saveLocalProject(updated);
  if (typeof window !== "undefined") {
    try {
      const store = read();
      if (store[project.id]) {
        delete store[project.id];
        window.localStorage.setItem(KEY, JSON.stringify(store));
      }
      window.dispatchEvent(new CustomEvent(MISSION_REVIEW_CHANGED_EVENT));
    } catch { /* durable Mission payload is authoritative; legacy cleanup is best effort */ }
  }
  return record;
}

export function missionAcceptedAt(project: EvolveProject) {
  try { assertDeliverablePackageIdentity(project); } catch { return undefined; }
  const fingerprint = missionArtifactFingerprint(project);
  const record = project.userAcceptance ?? legacyRecord(project);
  return record && record.fingerprint === fingerprint ? record.acceptedAt : undefined;
}
