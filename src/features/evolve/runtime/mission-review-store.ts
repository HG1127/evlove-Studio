import type { EvolveProject } from "../schemas";

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

function write(store: ReviewStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(MISSION_REVIEW_CHANGED_EVENT));
  } catch { /* user review is a convenience layer; never break the validated artifact */ }
}

export function missionArtifactFingerprint(project: EvolveProject) {
  const primary = project.outputArtifacts
    .filter((artifact) => artifact.kind === "primary" && artifact.accepted)
    .map((artifact) => `${artifact.id}:${artifact.versionLabel}:${artifact.candidateId ?? ""}:${artifact.createdAt}:${hash(artifact.content ?? "")}`)
    .sort();
  return hash(primary.join("|"));
}

export function isMissionUserAccepted(project: EvolveProject) {
  const primary = project.outputArtifacts.some((artifact) => artifact.kind === "primary" && artifact.accepted);
  if (!primary) return false;
  const record = read()[project.id];
  return Boolean(record && record.fingerprint === missionArtifactFingerprint(project));
}

export function acceptMissionOutputs(project: EvolveProject) {
  const primary = project.outputArtifacts.some((artifact) => artifact.kind === "primary" && artifact.accepted);
  if (!primary) throw new Error("当前没有已通过系统验收的正式成果，无法确认用户验收");
  const store = read();
  store[project.id] = { fingerprint: missionArtifactFingerprint(project), acceptedAt: new Date().toISOString() };
  write(store);
  return store[project.id]!;
}

export function missionAcceptedAt(project: EvolveProject) {
  const record = read()[project.id];
  return record && record.fingerprint === missionArtifactFingerprint(project) ? record.acceptedAt : undefined;
}
