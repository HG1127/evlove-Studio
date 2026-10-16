import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ArtifactStorePort } from "@evolution/contracts";
import { getServerArtifactStore } from "./artifact-runtime";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const PART_BYTES = 4 * 1024 * 1024, RECORD_BYTES = 32 * 1024 * 1024;
const Part = z.object({ blobId: z.string().min(1).max(200), sha256: digest,
  byteLength: z.number().int().positive().max(PART_BYTES) }).strict();
const StoredRecord = z.object({ schemaVersion: z.literal("html-protection-stored-native-record-v1"),
  missionId: z.string().min(1), jobId: z.string().min(1), role: z.enum(["original", "executed"]),
  recordId: z.string().min(1).max(512), sha256: digest, byteLength: z.number().int().positive().max(RECORD_BYTES),
  parts: z.array(Part).min(1).max(8),
}).strict().refine(value => value.parts.reduce((sum, part) => sum + part.byteLength, 0) === value.byteLength, "Incomplete stored native record");
export type ServerHtmlProtectionStoredNativeRecord = z.infer<typeof StoredRecord>;
async function assertMetadata(store: ArtifactStorePort, blobId: string, expected: { missionId: string; jobId: string; kind: string; sha256: string; byteLength: number }) {
  if (!store.getMetadata) throw Error("html-protection-artifact-metadata-unavailable");
  const metadata = await store.getMetadata(blobId);
  if (!metadata || metadata.id !== blobId || metadata.missionId !== expected.missionId || metadata.jobId !== expected.jobId
    || metadata.kind !== expected.kind || metadata.sha256 !== expected.sha256 || metadata.sizeBytes !== expected.byteLength) throw Error("html-protection-artifact-metadata-mismatch");
}
async function readVerified(store: ArtifactStorePort, blobId: string, expected: { missionId: string; jobId: string; kind: string; sha256: string; byteLength: number }) {
  await assertMetadata(store, blobId, expected);
  const blob = await store.get(blobId);
  if (!blob || blob.size !== expected.byteLength || blob.size > RECORD_BYTES) throw Error("html-protection-artifact-bytes-unavailable");
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.byteLength !== expected.byteLength || sha(bytes) !== expected.sha256) throw Error("html-protection-artifact-bytes-mismatch");
  return bytes;
}
export async function writeVerifiedServerHtmlProtectionBlob(args: { missionId: string; jobId: string; kind: string; bytes: Uint8Array;
  store?: ArtifactStorePort }) {
  const bytes = Buffer.from(args.bytes), store = args.store ?? getServerArtifactStore();
  if (!bytes.byteLength || bytes.byteLength > 20 * 1024 * 1024) throw Error("html-protection-artifact-byte-capacity");
  const blobId = "html-protection-" + randomUUID(), expected = { missionId: args.missionId, jobId: args.jobId,
    kind: args.kind, sha256: sha(bytes), byteLength: bytes.byteLength };
  await store.put(blobId, new Blob([new Uint8Array(bytes).buffer], { type: args.kind === "html-protection-native-part" ? "application/octet-stream" : "application/json" }), {
    missionId: args.missionId, jobId: args.jobId, kind: args.kind });
  const readback = await readVerified(store, blobId, expected);
  if (!readback.equals(bytes)) throw Error("html-protection-artifact-readback-drift");
  return { blobId, sha256: expected.sha256, byteLength: expected.byteLength };
}
/** Trusted sink: repackage large native record bytes into bounded private artifacts, then actually GET every byte. */
export function createServerHtmlProtectionNativeRecordSink(args: { missionId: string; jobId: string; store?: ArtifactStorePort }) {
  const store = args.store ?? getServerArtifactStore();
  return async (role: "original" | "executed", record: { recordId: string; sha256: string; byteLength: number }, input: Uint8Array) => {
    const bytes = Buffer.from(input);
    if (!bytes.byteLength || bytes.byteLength > RECORD_BYTES || bytes.byteLength !== record.byteLength || sha(bytes) !== record.sha256) throw Error("html-protection-native-record-input-mismatch");
    const parts: z.infer<typeof Part>[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += PART_BYTES) {
      parts.push(await writeVerifiedServerHtmlProtectionBlob({ ...args, store, kind: "html-protection-native-part", bytes: bytes.subarray(offset, Math.min(offset + PART_BYTES, bytes.byteLength)) }));
    }
    const material = StoredRecord.parse({ schemaVersion: "html-protection-stored-native-record-v1", missionId: args.missionId,
      jobId: args.jobId, role, recordId: record.recordId, sha256: record.sha256, byteLength: record.byteLength, parts });
    const saved = await writeVerifiedServerHtmlProtectionBlob({ ...args, store, kind: "html-protection-native-record", bytes: Buffer.from(htmlProtectionCanonicalJson(material)) });
    const reloaded = await readStoredServerHtmlProtectionNativeRecord({ ...args, role, artifactId: saved.blobId,
      record, store });
    if (!reloaded.bytes.equals(bytes)) throw Error("html-protection-native-record-readback-drift");
    return { artifactId: saved.blobId, sha256: record.sha256, byteLength: record.byteLength };
  };
}
/** Metadata references never replace the independently read multipart content or its canonical full-record digest. */
export async function readStoredServerHtmlProtectionNativeRecord(args: { missionId: string; jobId: string; role: "original" | "executed";
  artifactId: string; record: { recordId: string; sha256: string; byteLength: number }; store?: ArtifactStorePort }) {
  const store = args.store ?? getServerArtifactStore(), metadata = await store.getMetadata?.(args.artifactId);
  if (!metadata) throw Error("html-protection-native-record-metadata-unavailable");
  const materialBytes = await readVerified(store, args.artifactId, { missionId: args.missionId, jobId: args.jobId,
    kind: "html-protection-native-record", sha256: metadata.sha256, byteLength: metadata.sizeBytes });
  const stored = StoredRecord.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(materialBytes)));
  if (stored.missionId !== args.missionId || stored.jobId !== args.jobId || stored.role !== args.role
    || stored.recordId !== args.record.recordId || stored.sha256 !== args.record.sha256 || stored.byteLength !== args.record.byteLength
    || new Set(stored.parts.map(part => part.blobId)).size !== stored.parts.length) throw Error("html-protection-native-record-binding-mismatch");
  const parts = [];
  for (const part of stored.parts) parts.push(await readVerified(store, part.blobId, { missionId: args.missionId, jobId: args.jobId,
    kind: "html-protection-native-part", sha256: part.sha256, byteLength: part.byteLength }));
  const bytes = Buffer.concat(parts, stored.byteLength);
  if (bytes.byteLength !== stored.byteLength || sha(bytes) !== stored.sha256) throw Error("html-protection-native-record-bytes-mismatch");
  return { bytes, material: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
}
export async function readVerifiedServerHtmlProtectionBlob(args: { blobId: string; sha256: string; byteLength: number;
  missionId: string; jobId: string; kind: string; store?: ArtifactStorePort }) {
  return readVerified(args.store ?? getServerArtifactStore(), args.blobId, args);
}
