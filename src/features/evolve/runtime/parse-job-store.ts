import { ArtifactRoleSchema, SourceArtifactSchema, type ArtifactRole, type SourceArtifact } from "../schemas";
import { deleteArtifactBlob, getArtifactBlob, putArtifactBlob } from "./artifact-blob-store";

const DB_NAME = "evolve-studio-parse-jobs";
const STORE = "jobs";
const VERSION = 1;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memoryJobs = new Map<string, ParseJobRecord>();
export const PARSE_JOB_EVENT = "evolve-parse-job-changed";

export type ParseJobStatus = "queued" | "parsing" | "ready" | "error";

export type ParseJobRecord = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  role: ArtifactRole;
  status: ParseJobStatus;
  generation: number;
  attempts: number;
  artifact?: SourceArtifact;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export function parseJobBlobId(id: string) {
  return `parse-job-source:${id}`;
}

function now() {
  return new Date().toISOString();
}

function normalize(value: ParseJobRecord): ParseJobRecord {
  return {
    ...value,
    role: ArtifactRoleSchema.catch("target").parse(value.role),
    artifact: value.artifact ? SourceArtifactSchema.parse(value.artifact) : undefined,
  };
}

async function openDb(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeJob(record: ParseJobRecord) {
  const normalized = normalize(record);
  memoryJobs.set(record.id, normalized);
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    if (!db) return normalized;
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(normalized, normalized.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("解析任务保存已中止"));
    });
  } catch {
    // Persistence is an enhancement. Keep the in-memory job usable if IndexedDB is unavailable
    // or the browser quota is temporarily exhausted.
  } finally {
    db?.close();
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PARSE_JOB_EVENT, { detail: { jobId: record.id } }));
  return normalized;
}

export async function getParseJob(id: string): Promise<ParseJobRecord | undefined> {
  const memory = memoryJobs.get(id);
  if (memory) return normalize(memory);
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    if (!db) return undefined;
    const value = await new Promise<ParseJobRecord | undefined>((resolve, reject) => {
      const request = db!.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result as ParseJobRecord | undefined);
      request.onerror = () => reject(request.error);
    });
    if (!value) return undefined;
    const normalized = normalize(value);
    memoryJobs.set(id, normalized);
    return normalized;
  } catch {
    return memoryJobs.get(id);
  } finally {
    db?.close();
  }
}

export async function listParseJobs(): Promise<ParseJobRecord[]> {
  let db: IDBDatabase | undefined;
  let records: ParseJobRecord[];
  try {
    db = await openDb();
    if (!db) records = [...memoryJobs.values()].map(normalize);
    else records = await new Promise<ParseJobRecord[]>((resolve, reject) => {
      const request = db!.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as ParseJobRecord[]).map(normalize));
      request.onerror = () => reject(request.error);
    });
  } catch {
    records = [...memoryJobs.values()].map(normalize);
  } finally {
    db?.close();
  }
  for (const record of records) memoryJobs.set(record.id, record);
  const stale = records.filter((record) => Date.now() - Date.parse(record.updatedAt) > TTL_MS);
  await Promise.all(stale.map((record) => discardParseJob(record.id, { deleteArtifact: true })));
  return records.filter((record) => !stale.some((item) => item.id === record.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createParseJob(args: { id: string; file: File; role: ArtifactRole }) {
  const timestamp = now();
  const record: ParseJobRecord = {
    id: args.id,
    name: args.file.name,
    mimeType: args.file.type || "application/octet-stream",
    size: args.file.size,
    lastModified: args.file.lastModified,
    role: args.role,
    status: "queued",
    generation: 0,
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await putArtifactBlob(parseJobBlobId(record.id), args.file).catch(() => undefined);
  return writeJob(record);
}

export async function beginParseJob(id: string): Promise<ParseJobRecord | undefined> {
  const current = await getParseJob(id);
  if (!current) return undefined;
  return writeJob({
    ...current,
    status: "parsing",
    generation: current.generation + 1,
    attempts: current.attempts + 1,
    error: undefined,
    updatedAt: now(),
  });
}

export async function completeParseJob(id: string, generation: number, artifact: SourceArtifact): Promise<boolean> {
  const current = await getParseJob(id);
  if (!current || current.generation !== generation) return false;
  await writeJob({ ...current, status: "ready", artifact, error: undefined, updatedAt: now() });
  await deleteArtifactBlob(parseJobBlobId(id)).catch(() => undefined);
  return true;
}

export async function failParseJob(id: string, generation: number, error: string): Promise<boolean> {
  const current = await getParseJob(id);
  if (!current || current.generation !== generation) return false;
  await writeJob({ ...current, status: "error", error, updatedAt: now() });
  return true;
}

export async function updateParseJobRole(id: string, role: ArtifactRole) {
  const current = await getParseJob(id);
  if (!current) return;
  const artifact = current.artifact ? { ...current.artifact, role } : undefined;
  await writeJob({ ...current, role, artifact, updatedAt: now() });
}

export async function getParseJobBlob(record: ParseJobRecord): Promise<Blob | undefined> {
  if (record.artifact) {
    const parsedBlob = await getArtifactBlob(record.artifact.id);
    if (parsedBlob) return parsedBlob;
  }
  return getArtifactBlob(parseJobBlobId(record.id));
}

export async function discardParseJob(id: string, options: { deleteArtifact?: boolean } = {}) {
  const current = await getParseJob(id);
  memoryJobs.delete(id);
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("解析任务删除已中止"));
      });
    } finally {
      db.close();
    }
  }
  await deleteArtifactBlob(parseJobBlobId(id)).catch(() => undefined);
  if (options.deleteArtifact && current?.artifact?.id) await deleteArtifactBlob(current.artifact.id).catch(() => undefined);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PARSE_JOB_EVENT, { detail: { jobId: id } }));
}

export async function clearParseJobs() {
  const records = await listParseJobs().catch(() => [...memoryJobs.values()]);
  memoryJobs.clear();
  const db = await openDb();
  if (db) {
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("解析任务清理已中止"));
      });
    } finally {
      db.close();
    }
  }
  await Promise.all(records.map((record) => deleteArtifactBlob(parseJobBlobId(record.id)).catch(() => undefined)));
}
