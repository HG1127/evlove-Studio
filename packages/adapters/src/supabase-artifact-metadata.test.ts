import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArtifactMetadataSchema } from "@evolution/contracts";
import { createSupabaseProductionPorts } from "./supabase-production-adapter";

const original = {
  id: "artifact-1", schema_version: "artifact-v1", mission_id: "mission-1",
  bucket: "evolution-artifacts", object_path: "artifacts/existing-original",
  mime_type: "text/html", size_bytes: 264173, sha256: "6".repeat(64),
  metadata: { jobId: "job-1", kind: "source" },
  created_at: "2026-10-15T00:40:52.123456Z",
  updated_at: "2026-10-15T00:40:53.654321Z",
};

function fixture(overrides: Record<string, unknown> = {}) {
  const row = { ...original, ...overrides };
  const maybeSingle = vi.fn(async () => ({ data: row as Record<string, unknown> | null, error: null }));
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle };
  const storage = { from: vi.fn() };
  const client = { from: vi.fn(() => query), storage } as unknown as SupabaseClient;
  const ports = createSupabaseProductionPorts({ url: "https://example.supabase.co",
    anonKey: "sb_publishable_test_fixture_0000000000000000", artifactBucket: "evolution-artifacts" }, client);
  return { row, ports, query, maybeSingle, storage };
}

describe("Supabase Artifact metadata timestamps", () => {
  it.each([
    ["2026-10-15T00:40:52.123456+00:00", "2026-10-15T00:40:52.123456Z"],
    ["2026-10-15T00:40:52.12+00:00", "2026-10-15T00:40:52.12Z"],
    ["2026-10-15T00:40:52+00:00", "2026-10-15T00:40:52Z"],
    ["2026-10-15T00:10:52.123456+08:00", "2026-10-14T16:10:52.123456Z"],
    ["2026-10-15T23:50:52.999999-03:30", "2026-10-16T03:20:52.999999Z"],
    ["2026-10-15T00:40:52.123456Z", "2026-10-15T00:40:52.123456Z"],
  ])("reads database timestamp %s without losing precision", async (input, expected) => {
    const f = fixture({ created_at: input, updated_at: input });
    const metadata = await f.ports.artifacts.getMetadata!("artifact-1");
    expect(metadata).toEqual({ id: original.id, schemaVersion: original.schema_version,
      missionId: original.mission_id, jobId: "job-1", kind: "source", bucket: original.bucket,
      objectPath: original.object_path, mimeType: original.mime_type, sizeBytes: original.size_bytes,
      sha256: original.sha256, createdAt: expected, updatedAt: expected });
    expect(ArtifactMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(f.row.created_at).toBe(input);
    expect(f.row.updated_at).toBe(input);
    expect(f.query.eq).toHaveBeenCalledWith("id", "artifact-1");
    expect(f.storage.from).not.toHaveBeenCalled();
  });

  it.each(["created_at", "updated_at"])("rejects missing, invalid or unzoned %s", async (field) => {
    for (const value of [undefined, null, 1792030000000, "", "tomorrow", "2026-10-15",
      "2026-10-15T00:40:52", "2026-02-30T00:40:52+00:00", "2026-10-15T00:40:52+25:00"]) {
      const f = fixture({ [field]: value });
      await expect(f.ports.artifacts.getMetadata!("artifact-1")).rejects.toThrow();
      expect(f.storage.from).not.toHaveBeenCalled();
    }
  });

  it("keeps non-time metadata validation after converting valid database times", async () => {
    for (const overrides of [{ sha256: "invalid" }, { size_bytes: -1 }, { schema_version: "artifact-other" }]) {
      const f = fixture({ created_at: "2026-10-15T00:40:52.123456+00:00", ...overrides });
      await expect(f.ports.artifacts.getMetadata!("artifact-1")).rejects.toThrow();
    }
  });

  it("keeps the absent Artifact and upstream failure behavior", async () => {
    const f = fixture();
    f.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(f.ports.artifacts.getMetadata!("artifact-1")).resolves.toBeUndefined();
    f.maybeSingle.mockRejectedValueOnce(new Error("database read failed"));
    await expect(f.ports.artifacts.getMetadata!("artifact-1")).rejects.toThrow("database read failed");
    expect(f.storage.from).not.toHaveBeenCalled();
  });
});
