import { describe, expect, it, vi } from "vitest";
import type { Candidate, EvolveProject, FrozenArtifact } from "@evolution/contracts";
import { demoProject } from "../data/mock-project";
import { repairLegacyFrozenCandidateIdentities } from "./legacy-frozen-identity";

const content = "<html><body><p>Revised SOP</p></body></html>";
function legacyFingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}
const receipt = { sourceArtifactId: "html", snapshotHash: "verified-text-sha256", blobId: "verified-file:sha256",
  name: "sop-evolved.html", mimeType: "text/html", sha256: "blob-sha256", size: content.length,
  verifiedAt: "2026-09-28T00:00:00.000Z", checks: ["readback"], limitations: [] } as FrozenArtifact;
function project(snapshotOverrides = {}) {
  const candidate = { id: "C1", artifactSnapshots: [{ id: "S1", sourceArtifactId: "html", name: "sop.html",
    mimeType: "text/html", content, contentHash: legacyFingerprint(content), frozenArtifact: receipt,
    ...snapshotOverrides }] } as Candidate;
  return { ...demoProject, candidates: [candidate] } as EvolveProject;
}

describe("legacy Candidate frozen identity recovery", () => {
  it("migrates only after the exact frozen bytes have been read and verified", async () => {
    const read = vi.fn(async () => new Blob([content]));
    const result = await repairLegacyFrozenCandidateIdentities(project(), read);
    expect(read).toHaveBeenCalledWith(receipt, content);
    expect(result.candidates[0]?.artifactSnapshots[0]).toMatchObject({
      contentHash: receipt.snapshotHash, name: receipt.name, mimeType: receipt.mimeType, frozenArtifact: receipt,
    });
  });
  it("keeps a missing blob or changed Candidate content blocked", async () => {
    const missing = await repairLegacyFrozenCandidateIdentities(project(), async () => { throw new Error("missing"); });
    expect(missing.candidates[0]?.artifactSnapshots[0]?.contentHash).toBe(legacyFingerprint(content));
    const read = vi.fn(async () => new Blob([content]));
    const tampered = await repairLegacyFrozenCandidateIdentities(project({ contentHash: "unrelated" }), read);
    expect(read).not.toHaveBeenCalled();
    expect(tampered.candidates[0]?.artifactSnapshots[0]?.name).toBe("sop.html");
  });
});