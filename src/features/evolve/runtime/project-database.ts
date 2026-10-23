import {parseStoredEvolveProjects} from "@evolution/adapters";
import { z } from "zod";
import { type EvolveProject } from "../schemas";
import { repairLegacyFrozenCandidateIdentities } from "./legacy-frozen-identity";

const MissionSyncJournalSchema = z.object({
  knownRemoteIds: z.array(z.string().min(1)),
  pendingDeleteIds: z.array(z.string().min(1)),
});
type MissionSyncJournal = z.infer<typeof MissionSyncJournalSchema>;
const JOURNAL_KEY = "evolve-studio:mission-sync-journal:v1";

let database: IDBDatabase | undefined;
let cache: EvolveProject[] | undefined;
let journal: MissionSyncJournal | undefined;
let pending = Promise.resolve();
let latest: { projects: EvolveProject[]; journal: MissionSyncJournal } | undefined;
let writing = false;
let unsaved = false;
export const PROJECT_SAVE_EVENT = "evolve-project-save-status";
function invalidCandidateDeltas(projects:EvolveProject[]){
  return projects.some(project=>{
    const candidates=[...project.candidates,...project.evolutionArchive.map(entry=>entry.candidate),...(project.searchChampion?.candidate?[project.searchChampion.candidate]:[])];
    return candidates.some(candidate=>!Number.isFinite(candidate.costDelta)||!Number.isFinite(candidate.speedDelta));
  });
}
export function databaseProjects() {
  // HMR can leave an older in-memory projection alive; repair it once before the next sync.
  if(cache&&invalidCandidateDeltas(cache))saveDatabaseProjects(cache);
  return cache;
}

function readLegacyJournal(): MissionSyncJournal {
  if (typeof window === "undefined") return { knownRemoteIds: [], pendingDeleteIds: [] };
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    return raw ? MissionSyncJournalSchema.parse(JSON.parse(raw)) : { knownRemoteIds: [], pendingDeleteIds: [] };
  } catch {
    return { knownRemoteIds: [], pendingDeleteIds: [] };
  }
}

export function missionSyncJournal(): MissionSyncJournal {
  const current = database ? journal ?? readLegacyJournal() : readLegacyJournal();
  return { knownRemoteIds: [...current.knownRemoteIds], pendingDeleteIds: [...current.pendingDeleteIds] };
}

function writeDatabase(projects: EvolveProject[], syncJournal: MissionSyncJournal) {
  return new Promise<void>((resolve, reject) => {
    const tx = database!.transaction("state", "readwrite");
    const state = tx.objectStore("state");
    state.put(projects, "projects");
    state.put(syncJournal, "mission-sync-journal");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("保存已中止"));
  });
}

function queueDatabaseWrite(projects: EvolveProject[]) {
  latest = { projects: structuredClone(projects), journal: missionSyncJournal() };
  unsaved = true;
  window.dispatchEvent(new CustomEvent(PROJECT_SAVE_EVENT, { detail: { state: "saving" } }));
  if (writing) return;
  writing = true;
  pending = (async () => {
    try {
      while (latest) {
        const snapshot = latest;
        latest = undefined;
        await writeDatabase(snapshot.projects, snapshot.journal);
      }
      unsaved = false;
      window.dispatchEvent(new CustomEvent(PROJECT_SAVE_EVENT, { detail: { state: "saved" } }));
    } finally {
      writing = false;
    }
  })();
  void pending.catch(error => window.dispatchEvent(new CustomEvent(PROJECT_SAVE_EVENT, { detail: { state: "error", message: String(error) } })));
}

export function updateMissionSyncJournal(update: (current: MissionSyncJournal) => MissionSyncJournal) {
  const next = MissionSyncJournalSchema.parse(update(missionSyncJournal()));
  const current = missionSyncJournal();
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  journal = next;
  if (database) {
    queueDatabaseWrite(cache ?? []);
  } else if (typeof window !== "undefined") {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(next));
  }
}

export async function initializeProjectDatabase(legacy: EvolveProject[]) {
  if (typeof indexedDB === "undefined") return;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("evolve-studio-projects", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const state = db.transaction("state").objectStore("state");
  const read = <T>(key: string) => new Promise<T | undefined>((resolve, reject) => {
    const request = state.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const [stored, storedJournal] = await Promise.all([
    read<EvolveProject[]>("projects"),
    read<unknown>("mission-sync-journal"),
  ]);
  database = db;
  cache = await Promise.all(parseStoredEvolveProjects(stored ?? legacy).map((project) => repairLegacyFrozenCandidateIdentities(project)));
  journal = storedJournal === undefined ? readLegacyJournal() : MissionSyncJournalSchema.parse(storedJournal);
  // Persist both together so a delete intent cannot be separated from the browser projection.
  await writeDatabase(cache, journal);
  window.addEventListener("beforeunload", event => { if (unsaved) { event.preventDefault(); event.returnValue = ""; } });
}

export function saveDatabaseProjects(projects: EvolveProject[]) {
  cache = invalidCandidateDeltas(projects)?parseStoredEvolveProjects(projects):projects;
  queueDatabaseWrite(cache);
}

export function flushProjectDatabase() { return pending; }
