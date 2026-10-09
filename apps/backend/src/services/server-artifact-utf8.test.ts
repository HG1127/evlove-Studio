// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, SourceArtifactSchema, type ArtifactStorePort, type EvolveProject, type TestCase } from "@evolution/contracts";
import { buildServerExperimentCandidate, readServerCandidateParentText, serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { runServerCurrentStoredEvidence } from "./server-current-stored-evidence";
import { verifyServerFrozenCandidateArtifacts } from "./server-artifact-acceptance";
import { renderSnapshot, verifyRendered } from "./server-artifact-renderer";

const { blobs, ai } = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), ai: vi.fn() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id), put: async (id: string, blob: Blob) => { blobs.set(id, blob); } }) }));
vi.mock("./ai-gateway", () => ({ runServerAi: ai }));
const before = "原始审批规则";
const after = "原始审批规则，保留审批编号";
function fixture(extension = "html", pasted = false) {
  const content = extension === "json" ? '\ufeff{\r\n  "rule": "原始审批规则"\r\n}\r\n' : '\ufeff<!doctype html>\r\n<html><head><meta charset="utf-8"></head><body><p>原始审批规则</p>\r\n<p>保留原文 😀 é</p></body></html>\r\n';
  const source = SourceArtifactSchema.parse({ id: "source", name: `original.${extension}`, extension, mimeType: extension === "json" ? "application/json" : "text/html", artifactKind: "document", role: "target", size: Buffer.byteLength(content), inputMode: pasted ? "paste" : "upload", textContent: pasted ? content : "STALE INDEX", parseStatus: "ready", createdAt: "2026-10-09T00:00:00.000Z" });
  const candidate = CandidateSchema.parse({ id: "candidate", name: "补齐审批编号", change: "保留原文并记录审批编号", patches: [{ id: "edit", component: "code", operation: "update", target: before, artifactId: source.id, content: after, rationale: "补齐规则" }] });
  const project = { id: "bom-mission", name: "BOM 原文", version: "V1", sourceArtifacts: [source], goal: "保留原文并记录审批编号", evolutionCommand: "记录审批编号", protectedItems: [], editableItems: [], acceptanceRubric: [] } as unknown as EvolveProject;
  if (!pasted) blobs.set(source.id, new Blob([content], { type: source.mimeType }));
  return { project, source, candidate, content };
}
beforeEach(() => { blobs.clear(); ai.mockReset(); });
describe("exact UTF-8 BOM Artifact flow", () => {
  it.each(["html", "json"])("retains uploaded %s bytes through construction, frozen readback and Gate F file verification", async (extension) => {
    const { project, source, candidate, content } = fixture(extension);
    expect(await readServerCandidateParentText(project, source)).toBe(content);
    const originalHash = await serverArtifactSha256(await blobs.get(source.id)!.arrayBuffer());
    const built = await buildServerExperimentCandidate(project, candidate);
    const snapshot = built.artifactSnapshots[0]!;
    const expected = new TextEncoder().encode(content.replace(before, after));
    const frozen = blobs.get(snapshot.frozenArtifact!.blobId)!;
    expect(new Uint8Array(await frozen.arrayBuffer())).toEqual(expected);
    expect(snapshot.content).toBe(content.replace(before, after));
    expect(snapshot.frozenArtifact!.sha256).not.toBe(originalHash);
    expect(snapshot.frozenArtifact!.sha256).toBe(await serverArtifactSha256(expected));
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    const verified = await verifyServerFrozenCandidateArtifacts({ project, candidate: built });
    expect(verified.failed).toEqual([]);
    expect(verified.unavailable).toEqual([]);
    expect(verified.verified).toEqual([snapshot.frozenArtifact]);
    expect(await readServerCandidateParentText(project, source, built)).toBe(snapshot.content);
    expect(ai).not.toHaveBeenCalled();
  });
  it("preserves a canonical pasted BOM rather than failing materialization", async () => {
    const { project, candidate, content } = fixture("html", true);
    const built = await buildServerExperimentCandidate(project, candidate);
    expect(built.artifactSnapshots[0]!.content).toBe(content.replace(before, after));
    expect(await verifyServerCandidateFrozenArtifact(built.artifactSnapshots[0]!)).toBe(true);
  });
  it("verifies the actual uploaded current-version BOM roundtrip", async () => {
    const { project, source } = fixture();
    const testCase = { id: "roundtrip", executionMode: "roundtrip", criterionIds: [], evidenceScope: "implementation" } as unknown as TestCase;
    const result = await runServerCurrentStoredEvidence({ project, testCase });
    expect(result.verificationStatus, result.output).toBe("verified");
    expect(result.artifactHash).toBe(await serverArtifactSha256(await blobs.get(source.id)!.arrayBuffer()));
  });
  it("reopens server-rendered exact text with its original BOM and line endings", async () => {
    const { source, candidate, content } = fixture();
    const snapshot = { id: "rendered", sourceArtifactId: source.id, name: "evolved.html", mimeType: source.mimeType, content: content.replace(before, after), createdAt: source.createdAt, buildMode: "deterministic" as const, notes: [] };
    const store: ArtifactStorePort = { get: async (id) => blobs.get(id), put: async (id, blob) => { blobs.set(id, blob); }, delete: async (id) => { blobs.delete(id); } };
    const rendered = await renderSnapshot(source, snapshot, store);
    await expect(verifyRendered(source, snapshot, rendered.blob, store)).resolves.toMatchObject({ checks: expect.arrayContaining(["生成文本与 Candidate Snapshot 逐字一致"]) });
    expect(new Uint8Array(await rendered.blob.arrayBuffer())).toEqual(new TextEncoder().encode(snapshot.content));
    expect(candidate.id).toBe("candidate");
  });
  it("still refuses malformed uploaded UTF-8 before any model or freeze", async () => {
    const { project, source, candidate } = fixture();
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0x28]);
    source.size = bytes.byteLength;
    blobs.set(source.id, new Blob([bytes]));
    await expect(buildServerExperimentCandidate(project, candidate)).rejects.toThrow();
    expect(ai).not.toHaveBeenCalled();
    expect([...blobs.keys()]).toEqual([source.id]);
  });
  it("still refuses BOM removal or content replacement after freezing", async () => {
    const { project, candidate } = fixture();
    const built = await buildServerExperimentCandidate(project, candidate);
    const snapshot = built.artifactSnapshots[0]!;
    const receipt = snapshot.frozenArtifact!;
    blobs.set(receipt.blobId, new Blob([snapshot.content.slice(1)], { type: snapshot.mimeType }));
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
    receipt.size = blobs.get(receipt.blobId)!.size;
    receipt.sha256 = await serverArtifactSha256(await blobs.get(receipt.blobId)!.arrayBuffer());
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
  });
});