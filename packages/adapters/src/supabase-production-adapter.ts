import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  MissionEnvelopeSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  SupabaseBackendConfigSchema,
  missionEnvelope,
  type EvolveProject,
  type EvolutionEvent,
  type EvolutionJob,
  type ProductionRuntimePorts,
  type SupabaseBackendConfig,
} from "@evolution/contracts";

type JsonRecord = Record<string, unknown>;

export type SupabaseBackendHealth = {
  configured: true;
  database: boolean;
  storage: boolean;
  tables: { missions: boolean; jobs: boolean; events: boolean; artifacts: boolean };
  checkedAt: string;
  message: string;
};

export function createSupabaseBackendClient(configInput: SupabaseBackendConfig) {
  const config = SupabaseBackendConfigSchema.parse(configInput);
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function missionToSupabaseRow(project: EvolveProject) {
  const envelope = missionEnvelope(project);
  return {
    id: envelope.missionId,
    schema_version: envelope.schemaVersion,
    stage: project.stage,
    status: project.campaign.status,
    payload: envelope.payload as unknown as JsonRecord,
    created_at: envelope.createdAt,
    updated_at: envelope.updatedAt,
  };
}

export function supabaseRowToMission(row: JsonRecord): EvolveProject {
  return MissionEnvelopeSchema.parse({
    schemaVersion: row.schema_version,
    missionId: row.id,
    revision: Number(row.revision ?? 0),
    payload: row.payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }).payload;
}

export function jobToSupabaseRow(job: EvolutionJob) {
  const value = EvolutionJobSchema.parse(job);
  return {
    id: value.id,
    mission_id: value.missionId ?? null,
    schema_version: value.schemaVersion,
    type: value.type,
    status: value.status,
    label: value.label,
    idempotency_key: value.idempotencyKey,
    generation: value.generation,
    attempts: value.attempts,
    priority: value.priority,
    checkpoint_id: value.checkpointId ?? null,
    input_ref: value.inputRef ?? null,
    output_ref: value.outputRef ?? null,
    metadata: value.metadata ?? {},
    progress: value.progress ?? null,
    error: value.error ?? null,
    created_at: value.createdAt,
    started_at: value.startedAt ?? null,
    heartbeat_at: value.heartbeatAt ?? null,
    finished_at: value.finishedAt ?? null,
    updated_at: value.updatedAt,
  };
}

export function supabaseRowToJob(row: JsonRecord): EvolutionJob {
  return EvolutionJobSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    missionId: row.mission_id ?? undefined,
    type: row.type,
    status: row.status,
    label: row.label,
    idempotencyKey: row.idempotency_key,
    generation: row.generation,
    attempts: row.attempts,
    priority: row.priority,
    checkpointId: row.checkpoint_id ?? undefined,
    inputRef: row.input_ref ?? undefined,
    outputRef: row.output_ref ?? undefined,
    metadata: row.metadata ?? undefined,
    progress: row.progress ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    heartbeatAt: row.heartbeat_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    updatedAt: row.updated_at,
  });
}

export function eventToSupabaseRow(event: EvolutionEvent) {
  const value = EvolutionEventSchema.parse(event);
  return {
    id: value.id,
    mission_id: value.missionId ?? null,
    schema_version: value.schemaVersion,
    type: value.type,
    source: value.source,
    job_id: value.jobId ?? null,
    checkpoint_id: value.checkpointId ?? null,
    causation_id: value.causationId ?? null,
    correlation_id: value.correlationId ?? null,
    payload: value.payload,
    at: value.at,
  };
}

export function supabaseRowToEvent(row: JsonRecord): EvolutionEvent {
  return EvolutionEventSchema.parse({
    schemaVersion: row.schema_version,
    id: row.id,
    missionId: row.mission_id ?? undefined,
    type: row.type,
    source: row.source,
    jobId: row.job_id ?? undefined,
    checkpointId: row.checkpoint_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    payload: row.payload ?? {},
    at: row.at,
  });
}

function objectPath(id: string) {
  return `artifacts/${encodeURIComponent(id)}`;
}

async function blobSha256(blob: Blob) {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function throwIfError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export function createSupabaseProductionPorts(
  configInput: SupabaseBackendConfig,
  suppliedClient?: SupabaseClient,
): ProductionRuntimePorts {
  const config = SupabaseBackendConfigSchema.parse(configInput);
  const client = suppliedClient ?? createSupabaseBackendClient(config);

  return {
    missions: {
      initialize: async () => undefined,
      list: async () => {
        const { data, error } = await client.from("missions").select("*").order("updated_at", { ascending: false });
        throwIfError(error, "Supabase missions list");
        return (data ?? []).map((row) => supabaseRowToMission(row as JsonRecord));
      },
      get: async (id) => {
        const { data, error } = await client.from("missions").select("*").eq("id", id).maybeSingle();
        throwIfError(error, "Supabase mission get");
        return data ? supabaseRowToMission(data as JsonRecord) : undefined;
      },
      save: async (project) => {
        const { error } = await client.from("missions").upsert(missionToSupabaseRow(project), { onConflict: "id" });
        throwIfError(error, "Supabase mission save");
      },
      delete: async (id) => {
        const { error } = await client.from("missions").delete().eq("id", id);
        throwIfError(error, "Supabase mission delete");
      },
      flush: async () => undefined,
    },
    jobs: {
      list: async (missionId) => {
        let query = client.from("jobs").select("*").order("updated_at", { ascending: false });
        if (missionId) query = query.eq("mission_id", missionId);
        const { data, error } = await query;
        throwIfError(error, "Supabase jobs list");
        return (data ?? []).map((row) => supabaseRowToJob(row as JsonRecord));
      },
      get: async (id) => {
        const { data, error } = await client.from("jobs").select("*").eq("id", id).maybeSingle();
        throwIfError(error, "Supabase job get");
        return data ? supabaseRowToJob(data as JsonRecord) : undefined;
      },
      put: async (job) => {
        const { error } = await client.from("jobs").upsert(jobToSupabaseRow(job), { onConflict: "id" });
        throwIfError(error, "Supabase job save");
      },
      cancel: async (id) => {
        const at = new Date().toISOString();
        const { error } = await client.from("jobs").update({ status: "cancelled", finished_at: at, updated_at: at }).eq("id", id);
        throwIfError(error, "Supabase job cancel");
      },
    },
    events: {
      append: async (event) => {
        const { error } = await client.from("events").upsert(eventToSupabaseRow(event), { onConflict: "id", ignoreDuplicates: true });
        throwIfError(error, "Supabase event append");
      },
      list: async (missionId, limit = 200) => {
        let query = client.from("events").select("*").order("at", { ascending: false }).limit(limit);
        if (missionId) query = query.eq("mission_id", missionId);
        const { data, error } = await query;
        throwIfError(error, "Supabase events list");
        return (data ?? []).map((row) => supabaseRowToEvent(row as JsonRecord));
      },
    },
    artifacts: {
      put: async (id, blob) => {
        const path = objectPath(id);
        const { error: uploadError } = await client.storage.from(config.artifactBucket).upload(path, blob, {
          upsert: true,
          contentType: blob.type || "application/octet-stream",
        });
        throwIfError(uploadError, "Supabase artifact upload");
        const metadata = {
          id,
          schema_version: PRODUCTION_SCHEMA_VERSIONS.artifact,
          bucket: config.artifactBucket,
          object_path: path,
          mime_type: blob.type || "application/octet-stream",
          size_bytes: blob.size,
          sha256: await blobSha256(blob),
          updated_at: new Date().toISOString(),
        };
        const { error } = await client.from("artifacts").upsert(metadata, { onConflict: "id" });
        if (error) {
          await client.storage.from(config.artifactBucket).remove([path]).catch(() => undefined);
          throwIfError(error, "Supabase artifact metadata save");
        }
      },
      get: async (id) => {
        const { data: metadata, error: metadataError } = await client.from("artifacts").select("bucket,object_path").eq("id", id).maybeSingle();
        throwIfError(metadataError, "Supabase artifact metadata get");
        if (!metadata) return undefined;
        const { data, error } = await client.storage.from(String(metadata.bucket)).download(String(metadata.object_path));
        throwIfError(error, "Supabase artifact download");
        return data ?? undefined;
      },
      delete: async (id) => {
        const { data: metadata, error: metadataError } = await client.from("artifacts").select("bucket,object_path").eq("id", id).maybeSingle();
        throwIfError(metadataError, "Supabase artifact metadata get");
        if (metadata) {
          const { error: removeError } = await client.storage.from(String(metadata.bucket)).remove([String(metadata.object_path)]);
          throwIfError(removeError, "Supabase artifact delete");
        }
        const { error } = await client.from("artifacts").delete().eq("id", id);
        throwIfError(error, "Supabase artifact metadata delete");
      },
    },
  };
}

export async function checkSupabaseBackendHealth(configInput: SupabaseBackendConfig): Promise<SupabaseBackendHealth> {
  const config = SupabaseBackendConfigSchema.parse(configInput);
  const client = createSupabaseBackendClient(config);
  const tables = { missions: false, jobs: false, events: false, artifacts: false };

  for (const table of Object.keys(tables) as Array<keyof typeof tables>) {
    const { error } = await client.from(table).select("id").limit(1);
    tables[table] = !error;
  }

  const { error: storageError } = await client.storage.from(config.artifactBucket).list("", { limit: 1 });
  const storage = !storageError;
  const database = Object.values(tables).every(Boolean);
  return {
    configured: true,
    database,
    storage,
    tables,
    checkedAt: new Date().toISOString(),
    message: database && storage
      ? "Supabase 数据库与 Artifact Storage 已就绪"
      : `Supabase 尚未完全就绪：DB ${database ? "READY" : "MISSING"} · Storage ${storage ? "READY" : "MISSING"}`,
  };
}
