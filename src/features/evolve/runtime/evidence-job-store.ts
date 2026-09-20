import type { TargetRunResult } from "../schemas";

const DB_NAME = "evolve-studio-evidence-jobs";
const STORE = "jobs";
const VERSION = 1;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const memoryJobs = new Map<string, EvidenceJobRecord>();

export const EVIDENCE_JOB_EVENT = "evolve-evidence-job-changed";
export type EvidenceJobKind = "runner-discovery" | "build" | "browser-smoke" | "e2e" | "screenshot" | "visual-judge";
export type EvidenceJobStatus = "queued" | "running" | "ready" | "partial" | "unavailable" | "failed";

export type EvidenceJobRecord = {
  id: string;
  projectId: string;
  kind: EvidenceJobKind;
  scope: string;
  label: string;
  fingerprint: string;
  status: EvidenceJobStatus;
  generation: number;
  attempts: number;
  verificationStatus?: TargetRunResult["verificationStatus"];
  artifactHash?: string;
  summary?: string;
  error?: string;
  trace?: TargetRunResult["trace"];
  createdAt: string;
  updatedAt: string;
};

function timestamp() { return new Date().toISOString(); }
function jobId(projectId: string, kind: EvidenceJobKind, scope: string) {
  return `${projectId}:${kind}:${scope}`;
}
function emit(projectId: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVIDENCE_JOB_EVENT, { detail: { projectId } }));
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

async function write(record: EvidenceJobRecord) {
  memoryJobs.set(record.id, structuredClone(record));
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    if (db) await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, record.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("证据任务保存已中止"));
    });
  } catch {
    // Persistence is best-effort. The in-memory scheduler remains usable.
  } finally {
    db?.close();
  }
  emit(record.projectId);
  return structuredClone(record);
}

export async function getEvidenceJob(id: string): Promise<EvidenceJobRecord | undefined> {
  const memory = memoryJobs.get(id);
  if (memory) return structuredClone(memory);
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    if (!db) return undefined;
    const record = await new Promise<EvidenceJobRecord | undefined>((resolve, reject) => {
      const request = db!.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result as EvidenceJobRecord | undefined);
      request.onerror = () => reject(request.error);
    });
    if (record) memoryJobs.set(record.id, structuredClone(record));
    return record ? structuredClone(record) : undefined;
  } catch {
    return memoryJobs.get(id);
  } finally {
    db?.close();
  }
}

export async function listEvidenceJobs(projectId: string): Promise<EvidenceJobRecord[]> {
  let db: IDBDatabase | undefined;
  let records: EvidenceJobRecord[];
  try {
    db = await openDb();
    if (!db) records = [...memoryJobs.values()];
    else records = await new Promise<EvidenceJobRecord[]>((resolve, reject) => {
      const request = db!.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as EvidenceJobRecord[]);
      request.onerror = () => reject(request.error);
    });
  } catch {
    records = [...memoryJobs.values()];
  } finally {
    db?.close();
  }
  const stale = records.filter((record) => Date.now() - Date.parse(record.updatedAt) > TTL_MS);
  await Promise.all(stale.map((record) => deleteEvidenceJob(record.id)));
  for (const record of records) memoryJobs.set(record.id, structuredClone(record));
  return records
    .filter((record) => record.projectId === projectId && !stale.some((item) => item.id === record.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function ensureEvidenceJob(args: {
  projectId: string;
  kind: EvidenceJobKind;
  scope: string;
  label: string;
  fingerprint: string;
}) {
  const id = jobId(args.projectId, args.kind, args.scope);
  const existing = await getEvidenceJob(id);
  if (existing?.fingerprint === args.fingerprint) return existing;
  const now = timestamp();
  return write({
    id,
    projectId: args.projectId,
    kind: args.kind,
    scope: args.scope,
    label: args.label,
    fingerprint: args.fingerprint,
    status: "queued",
    generation: existing ? existing.generation + 1 : 0,
    attempts: 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export async function beginEvidenceJob(id: string) {
  const current = await getEvidenceJob(id);
  if (!current) return undefined;
  return write({
    ...current,
    status: "running",
    generation: current.generation + 1,
    attempts: current.attempts + 1,
    error: undefined,
    updatedAt: timestamp(),
  });
}

export async function finishEvidenceJob(
  id: string,
  generation: number,
  outcome: {
    status: Extract<EvidenceJobStatus, "ready" | "partial" | "unavailable" | "failed">;
    verificationStatus?: TargetRunResult["verificationStatus"];
    artifactHash?: string;
    summary?: string;
    error?: string;
    trace?: TargetRunResult["trace"];
  },
) {
  const current = await getEvidenceJob(id);
  if (!current || current.generation !== generation) return false;
  await write({ ...current, ...outcome, updatedAt: timestamp() });
  return true;
}

export async function retryEvidenceJob(id: string) {
  const current = await getEvidenceJob(id);
  if (!current) return undefined;
  return write({ ...current, status: "queued", error: undefined, updatedAt: timestamp() });
}

export async function deleteEvidenceJob(id: string) {
  const existing = memoryJobs.get(id);
  memoryJobs.delete(id);
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    if (db) await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("证据任务删除已中止"));
    });
  } catch {
    // best-effort cleanup
  } finally {
    db?.close();
  }
  if (existing) emit(existing.projectId);
}

export async function clearEvidenceJobs(projectId: string) {
  const jobs = await listEvidenceJobs(projectId);
  await Promise.all(jobs.map((job) => deleteEvidenceJob(job.id)));
}

export function evidenceJobOutcome(result: TargetRunResult): {
  status: Extract<EvidenceJobStatus, "ready" | "partial" | "unavailable" | "failed">;
  verificationStatus: TargetRunResult["verificationStatus"];
  artifactHash?: string;
  summary: string;
  error?: string;
  trace: TargetRunResult["trace"];
} {
  const status = result.verificationStatus === "verified" ? "ready"
    : result.verificationStatus === "partial" ? "partial"
    : result.verificationStatus === "failed" ? "failed"
    : "unavailable";
  let summary: string;
  try {
    const parsed = JSON.parse(result.output) as { scope?: string; log?: string; limitations?: string[] };
    summary = [parsed.scope, parsed.log?.slice(-1200), ...(parsed.limitations ?? []).slice(0, 2)].filter(Boolean).join("；") || result.output;
  } catch {
    summary = result.output;
  }
  return {
    status,
    verificationStatus: result.verificationStatus,
    artifactHash: result.artifactHash,
    summary: summary.slice(0, 1800),
    error: result.error,
    trace: result.trace.slice(0, 16),
  };
}
