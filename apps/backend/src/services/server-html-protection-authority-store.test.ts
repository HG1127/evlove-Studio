import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ArtifactMetadata, ArtifactStorePort } from "@evolution/contracts";
import { createServerHtmlProtectionNativeRecordSink, readStoredServerHtmlProtectionNativeRecord, writeVerifiedServerHtmlProtectionBlob } from "./server-html-protection-authority-store";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const blobs = new Map<string, Blob>(), metadata = new Map<string, ArtifactMetadata>();
  const store: ArtifactStorePort = { put: async (id, blob, binding) => {
    blobs.set(id, blob); metadata.set(id, { id, schemaVersion: "artifact-v1", ...binding, bucket: "private", objectPath: id,
      mimeType: blob.type, sizeBytes: blob.size, sha256: sha(new Uint8Array(await blob.arrayBuffer())),
      createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z" });
  }, get: async id => blobs.get(id), getMetadata: async id => metadata.get(id), delete: async () => { throw Error("Deletion is not part of evidence collection"); } };
  const input = { missionId: "synthetic-mission", jobId: "synthetic-job", store };
  return { store, blobs, metadata, input };
}
describe("whole protection private native record custody", () => {
  it("persists and independently rereads every complete bounded native part", async () => {
    const f = fixture(), bytes = Buffer.from(JSON.stringify({ actual: "native body", payload: "A".repeat(4 * 1024 * 1024) }));
    const record = { recordId: "native:1", sha256: sha(bytes), byteLength: bytes.byteLength };
    const receipt = await createServerHtmlProtectionNativeRecordSink(f.input)("original", record, bytes);
    const restored = await readStoredServerHtmlProtectionNativeRecord({ ...f.input, role: "original", artifactId: receipt.artifactId, record });
    expect(restored.bytes.equals(bytes)).toBe(true);
    expect([...f.metadata.values()].filter(item => item.kind === "html-protection-native-part")).toHaveLength(2);
    expect([...f.metadata.values()].every(item => item.sizeBytes <= 4 * 1024 * 1024)).toBe(true);
  });
  it.each(["mission", "job", "role", "record", "sha", "size"] as const)("rejects %s subject mutation", async kind => {
    const f = fixture(), bytes = Buffer.from('{"actual":"native"}'), record = { recordId: "native:1", sha256: sha(bytes), byteLength: bytes.byteLength };
    const saved = await createServerHtmlProtectionNativeRecordSink(f.input)("original", record, bytes);
    const args = { ...f.input, role: "original" as "original" | "executed", artifactId: saved.artifactId, record: { ...record } };
    if (kind === "mission") args.missionId = "foreign";
    if (kind === "job") args.jobId = "foreign";
    if (kind === "role") args.role = "executed";
    if (kind === "record") args.record.recordId = "foreign";
    if (kind === "sha") args.record.sha256 = "a".repeat(64);
    if (kind === "size") args.record.byteLength--;
    await expect(readStoredServerHtmlProtectionNativeRecord(args)).rejects.toThrow(/html-protection-/);
  });
  it("detects physical part tampering after a successful receipt", async () => {
    const f = fixture(), bytes = Buffer.from('{"actual":"native"}'), record = { recordId: "native:1", sha256: sha(bytes), byteLength: bytes.byteLength };
    const saved = await createServerHtmlProtectionNativeRecordSink(f.input)("original", record, bytes);
    const part = [...f.metadata.values()].find(item => item.kind === "html-protection-native-part")!;
    f.blobs.set(part.id, new Blob(['{"actual":"fake!!"}']));
    await expect(readStoredServerHtmlProtectionNativeRecord({ ...f.input, role: "original", artifactId: saved.artifactId, record })).rejects.toThrow(/bytes-mismatch|bytes-unavailable/);
  });
  it("cannot return a receipt when the actual post-write GET is absent", async () => {
    const f = fixture(); f.store.get = async () => undefined;
    await expect(writeVerifiedServerHtmlProtectionBlob({ ...f.input, kind: "html-protection-native-part", bytes: Buffer.from("native") })).rejects.toThrow("bytes-unavailable");
  });
  it("requires independently stored metadata scope and byte identity", async () => {
    const f = fixture(); f.store.getMetadata = async () => undefined;
    await expect(writeVerifiedServerHtmlProtectionBlob({ ...f.input, kind: "html-protection-native-part", bytes: Buffer.from("native") })).rejects.toThrow("metadata-mismatch");
  });
  it("does not delete or silently truncate an oversized record", async () => {
    const f = fixture(); await expect(createServerHtmlProtectionNativeRecordSink(f.input)("original",
      { recordId: "large", sha256: "a".repeat(64), byteLength: 33 * 1024 * 1024 }, new Uint8Array(33 * 1024 * 1024))).rejects.toThrow("input-mismatch");
    expect(f.blobs.size).toBe(0);
  });
});
