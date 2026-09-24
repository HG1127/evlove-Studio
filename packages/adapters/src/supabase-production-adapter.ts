import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  ArtifactMetadataSchema,
  ArtifactBindingSchema,
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
  artifactCleanup: boolean;
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

function objectPath(id: string,digest:string) {
  return `artifacts/${encodeURIComponent(id)}/${digest}/${crypto.randomUUID()}`;
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
      put: async (id, blob, binding) => {
        const safeBinding=ArtifactBindingSchema.parse(binding??{});
        const digest=await blobSha256(blob);
        const {data:existing,error:existingError}=await client.from("artifacts").select("*").eq("id",id).maybeSingle();
        throwIfError(existingError,"Supabase artifact metadata get before upload");
        if(existing&&!existing.sha256)throw new Error(`Artifact id ${id} has no verified SHA-256 and cannot be overwritten`);
        if(existing?.sha256&&existing.sha256!==digest){
          throw new Error(`Artifact id ${id} is immutable; content hash differs from its registered SHA-256`);
        }
        const mimeType=blob.type||"application/octet-stream";
        if(existing?.mime_type&&existing.mime_type!==mimeType){
          throw new Error(`Artifact id ${id} is already registered with another content type`);
        }
        if(existing?.mission_id&&safeBinding.missionId&&existing.mission_id!==safeBinding.missionId){
          throw new Error(`Artifact id ${id} is already bound to another Mission`);
        }
        const existingMetadata=existing?.metadata&&typeof existing.metadata==="object"?existing.metadata as JsonRecord:{};
        if(existingMetadata.jobId&&safeBinding.jobId&&existingMetadata.jobId!==safeBinding.jobId){
          throw new Error(`Artifact id ${id} is already bound to another Job`);
        }
        if(existingMetadata.kind&&safeBinding.kind&&existingMetadata.kind!==safeBinding.kind){
          throw new Error(`Artifact id ${id} is already registered with another kind`);
        }
        const path=existing?.object_path?String(existing.object_path):objectPath(id,digest);
        const bucket=existing?.bucket?String(existing.bucket):config.artifactBucket;
        const { error: uploadError } = await client.storage.from(bucket).upload(path, blob, {
          upsert: true,
          contentType: mimeType,
        });
        throwIfError(uploadError, "Supabase artifact upload");
        const updatedAt=new Date().toISOString();
        const metadata = {
          id,
          schema_version: PRODUCTION_SCHEMA_VERSIONS.artifact,
          mission_id:safeBinding.missionId??existing?.mission_id??null,
          bucket,
          object_path: path,
          mime_type: mimeType,
          size_bytes: blob.size,
          sha256: digest,
          metadata:{...existingMetadata,...(safeBinding.jobId?{jobId:safeBinding.jobId}:{}),...(safeBinding.kind?{kind:safeBinding.kind}:{})},
          created_at:existing?.created_at??updatedAt,
          updated_at: updatedAt,
        };
        // A newly created path is never reused. Existing rows are updated only if the
        // row still points to the path read above; a concurrent delete cannot revive it.
        const {data:saved,error}=existing
          ? await client.from("artifacts").update(metadata)
              .eq("id",id).eq("object_path",path).select("id").maybeSingle()
          : await client.from("artifacts").insert(metadata);
        if (error) {
          // The object path may already belong to an accepted Artifact. Leave it available
          // for reconciliation instead of deleting verified bytes after a metadata failure.
          throwIfError(error, "Supabase artifact metadata save");
        }
        if(existing&&!saved)throw new Error(`Artifact id ${id} changed during upload; retry registration`);
      },
      get: async (id) => {
        const { data: metadata, error: metadataError } = await client.from("artifacts").select("bucket,object_path").eq("id", id).maybeSingle();
        throwIfError(metadataError, "Supabase artifact metadata get");
        if (!metadata) return undefined;
        const { data, error } = await client.storage.from(String(metadata.bucket)).download(String(metadata.object_path));
        throwIfError(error, "Supabase artifact download");
        return data ?? undefined;
      },
      getMetadata:async(id)=>{
        const {data,error}=await client.from("artifacts").select("*").eq("id",id).maybeSingle();
        throwIfError(error,"Supabase artifact metadata get");
        if(!data)return undefined;
        const row=data as JsonRecord;
        const extra=row.metadata&&typeof row.metadata==="object"?row.metadata as JsonRecord:{};
        return ArtifactMetadataSchema.parse({
          id:row.id,schemaVersion:row.schema_version,missionId:row.mission_id??undefined,
          jobId:extra.jobId,kind:extra.kind,bucket:row.bucket,objectPath:row.object_path,
          mimeType:row.mime_type,sizeBytes:Number(row.size_bytes),sha256:row.sha256,
          createdAt:row.created_at,updatedAt:row.updated_at,
        });
      },
      delete: async (id) => {
        const { data: metadata, error: metadataError } = await client.from("artifacts").select("bucket,object_path,mission_id").eq("id", id).maybeSingle();
        throwIfError(metadataError, "Supabase artifact metadata get");
        if (metadata) {
          if(metadata.mission_id)throw new Error(`Artifact ${id} is Mission-bound and cannot be deleted`);
          const {data:references,error:referenceError}=await client.from("evidence_ledger")
            .select("id").contains("artifact_refs",[id]).limit(1);
          throwIfError(referenceError,"Supabase artifact evidence reference check");
          if(references?.length)throw new Error(`Artifact ${id} is referenced by immutable Evidence and cannot be deleted`);
          // Delete metadata first so the database retention trigger can veto removal
          // while the blob is still intact. A storage failure leaves a scratch orphan.
          const {data:deleted,error:deleteError}=await client.from("artifacts").delete()
            .eq("id",id).eq("object_path",String(metadata.object_path)).select("id").maybeSingle();
          throwIfError(deleteError,"Supabase artifact metadata delete");
          if(!deleted)return;
          const { error: removeError } = await client.storage.from(String(metadata.bucket)).remove([String(metadata.object_path)]);
          throwIfError(removeError, "Supabase artifact delete");
        }
      },
    },
  };
}

export async function checkSupabaseBackendHealth(
  configInput: SupabaseBackendConfig,suppliedClient?:SupabaseClient,
): Promise<SupabaseBackendHealth> {
  const config = SupabaseBackendConfigSchema.parse(configInput);
  const client = suppliedClient??createSupabaseBackendClient(config);
  const tables = { missions: false, jobs: false, events: false, artifacts: false };

  for (const table of Object.keys(tables) as Array<keyof typeof tables>) {
    const { error } = await client.from(table).select("id").limit(1);
    tables[table] = !error;
  }

  const { error: storageError } = await client.storage.from(config.artifactBucket).list("", { limit: 1 });
  const storage = !storageError;
  const {error:cleanupError}=await client.from("artifact_retention_tombstones")
    .select("artifact_id,blob_deleted_at").eq("bucket",config.artifactBucket).limit(1);
  const artifactCleanup=!cleanupError;
  const database = Object.values(tables).every(Boolean);
  return {
    configured: true,
    database,
    storage,
    artifactCleanup,
    tables,
    checkedAt: new Date().toISOString(),
    message: database && storage && artifactCleanup
      ? "Supabase 数据库、Artifact Storage 与 blob 清理已就绪"
      : `Supabase 尚未完全就绪：DB ${database ? "READY" : "MISSING"} · Storage ${storage ? "READY" : "MISSING"} · Artifact cleanup ${artifactCleanup ? "READY" : "MISSING"}`,
  };
}
