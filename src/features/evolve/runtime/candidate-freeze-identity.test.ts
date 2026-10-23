import { beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { CandidateSchema } from "@evolution/contracts";
import { demoProject } from "../data/mock-project";
import { buildCandidateArtifacts } from "./artifact-quality";
import {putArtifactBlob} from "./artifact-blob-store";
import { prepareBrowserHttpRunHtml } from "../target/http-run-file";

const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.mock("./artifact-blob-store", () => ({
  getArtifactBlob: async (id: string) => blobs.get(id),
  putArtifactBlob: vi.fn(async (id: string, blob: Blob) => { blobs.set(id, blob); }),
}));
beforeEach(() => { vi.clearAllMocks();blobs.clear(); vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("crypto", webcrypto); });

describe("Candidate frozen file identity", () => {
  it("binds the built HTML snapshot to its frozen receipt before the real Runner reads it", async () => {
    const original = "<html><body><main id=\"guide\">Original instructions</main></body></html>";
    const evolved = "<html><body><main id=\"guide\">Clear step by step instructions</main></body></html>";
    const source = { ...demoProject.sourceArtifacts[0]!, id: "html", name: "sop.html", extension: "html",
      mimeType: "text/html", artifactKind: "document" as const, textContent: original, size: original.length };
    const project = { ...demoProject, sourceArtifacts: [source] };
    const candidate = CandidateSchema.parse({ id: "C1", name: "SOP", change: "Clarify steps", artifactBuildStatus: "ready",
      artifactSnapshots: [{ id: "S1", sourceArtifactId: "html", name: "sop.html", mimeType: "text/html",
        content: evolved, contentHash: "provisional-fnv", buildMode: "deterministic", createdAt: "2026-09-28T00:00:00.000Z" }] });
    const built = await buildCandidateArtifacts(project, candidate);
    const snapshot = built.artifactSnapshots[0]!;
    expect(snapshot).toMatchObject({ name: "sop-evolved.html", mimeType: "text/html",
      contentHash: snapshot.frozenArtifact?.snapshotHash });
    const savedCount=vi.mocked(putArtifactBlob).mock.calls.length;
    const reused=await buildCandidateArtifacts(project,built);
    expect(vi.mocked(putArtifactBlob)).toHaveBeenCalledTimes(savedCount);
    expect(reused.artifactSnapshots[0]?.frozenArtifact).toEqual(snapshot.frozenArtifact);
    const result = await prepareBrowserHttpRunHtml(source, built);
    expect(result.artifact).toEqual({ name: "sop-evolved.html", content: evolved });
    expect(result.sha256).toBe(snapshot.frozenArtifact?.sha256);
  });
});