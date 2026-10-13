// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, ArtifactMetadataSchema, CandidateSchema, SourceArtifactSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { collectServerHtmlCompleteSourceRetention } from "./server-html-complete-source-retention";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const at = "2026-10-13T00:00:00.000Z";
const original = '\uFEFF<!doctype html><html><head><title>Original</title><!-- retain head --></head><body><article class="slide-card" id="old"><h2>Old</h2><p>Original Ω 😀</p></article><footer>Outside content</footer></body></html>\r\n';
const changed = original.replace('</body>', '<article class="slide-card" id="new"><h2>Detail</h2><p>Added explanation</p></article></body>');
const { blobs, rows } = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), rows: new Map<string, ReturnType<typeof ArtifactMetadataSchema.parse>>() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id), getMetadata: async (id: string) => rows.get(id) }) }));
function fixture() {
  const source = SourceArtifactSchema.parse({ id: "S1", name: "source.html", extension: "html", mimeType: "text/html", role: "target", inputMode: "upload", storageRef: "source-blob", size: Buffer.byteLength(original), textContent: "stale parser excerpt", createdAt: at });
  const criterion = AcceptanceCriterionSchema.parse({ id: "PROTECT-ALL", title: "Protect Original", requirement: "Preserve original content", protectedConstraint: true, hardGate: true, artifactIds: [source.id] });
  const testCase = TestCaseSchema.parse({ id: "H1", title: "Protection", input: "Complete source", expected: ["Preserve"], hidden: true, criterionIds: [criterion.id] });
  const candidate = CandidateSchema.parse({ id: "C1", name: "Changed", change: "Actual explanation", artifactSnapshots: [{ id: "snap", sourceArtifactId: source.id, name: "changed.html", mimeType: "text/html", content: changed, contentHash: sha(changed), createdAt: at, frozenArtifact: { sourceArtifactId: source.id, snapshotHash: sha(changed), blobId: "frozen-blob", name: "changed.html", mimeType: "text/html", sha256: sha(changed), size: Buffer.byteLength(changed), verifiedAt: at, checks: [], limitations: [] } }] });
  const project = { id: "M1", version: "V1", sourceArtifacts: [source], protectedItems: ["Original content"], acceptanceRubric: [criterion], evalSuite: [], hiddenEvalSuite: [testCase], candidates: [candidate] } as unknown as EvolveProject;
  return { project, candidate, testCase, criterionId: criterion.id };
}
function ports() { return { getArtifact: async (id: string) => blobs.get(id), getMetadata: async (id: string) => rows.get(id) }; }
beforeEach(() => {
  blobs.clear(); rows.clear();
  for (const [id, text] of [["source-blob", original], ["frozen-blob", changed]]) {
    blobs.set(id!, new Blob([text!]));
    rows.set(id!, ArtifactMetadataSchema.parse({ id, schemaVersion: "artifact-v1", missionId: "M1", bucket: "fixture", objectPath: id, mimeType: "text/html", sizeBytes: Buffer.byteLength(text!), sha256: sha(text!), createdAt: at, updatedAt: at }));
  }
});
describe("metadata-anchored full physical source facts", () => {
  it("double-reads original and frozen bytes against stored anchors, retaining only facts", async () => {
    const args = fixture(), injected = ports();
    const read = vi.spyOn(injected, "getArtifact"), metadata = vi.spyOn(injected, "getMetadata");
    const result = await collectServerHtmlCompleteSourceRetention({ ...args, ports: injected });
    expect(read.mock.calls.map(call => call[0])).toEqual(["source-blob", "frozen-blob", "source-blob", "frozen-blob"]);
    expect(metadata.mock.calls.map(call => call[0])).toEqual(["source-blob", "frozen-blob", "source-blob", "frozen-blob"]);
    expect(result.binding.original.sha256).toBe(sha(original)); expect(result.binding.executed.sha256).toBe(sha(changed));
    expect(result.comparison.reconstruction).toMatchObject({ available: true, literalEqual: true, utf8Equal: true });
    expect(result.comparison.additionalCards).toHaveLength(1);
    for (const key of ["passed", "authorized", "verificationStatus", "proof", "attestation", "originalHtml", "executedHtml"]) expect(result).not.toHaveProperty(key);
    expect(result.limitations.join(" ")).toContain("Gate F");
  });
  it("uses the existing server store and keeps current's original arm identical", async () => {
    const args = fixture(), current = await collectServerHtmlCompleteSourceRetention({ ...args, candidate: undefined });
    expect(current.binding.original).toEqual(current.binding.executed);
    expect(current.storedAnchors.original).toEqual(current.storedAnchors.executed);
    expect(current.comparison.nodeErasureRanges).toEqual([]);
  });
  it("rejects same-size physical Original replacement despite a computable new hash", async () => {
    blobs.set("source-blob", new Blob([original.replace("Original", "Replaced")]));
    await expect(collectServerHtmlCompleteSourceRetention(fixture())).rejects.toThrow("metadata anchor");
  });
  it.each(["missing", "foreign-id", "foreign-mission", "size", "hash"])("rejects %s original metadata", async kind => {
    const row = rows.get("source-blob")!;
    if (kind === "missing") rows.delete("source-blob");
    if (kind === "foreign-id") row.id = "another";
    if (kind === "foreign-mission") row.missionId = "other-mission";
    if (kind === "size") row.sizeBytes++;
    if (kind === "hash") row.sha256 = "a".repeat(64);
    await expect(collectServerHtmlCompleteSourceRetention(fixture())).rejects.toThrow("metadata anchor");
  });
  it("rejects unanchored physical reads and never turns pasted text into a stored receipt", async () => {
    const args = fixture();
    await expect(collectServerHtmlCompleteSourceRetention({ ...args, ports: { getArtifact: ports().getArtifact } as ReturnType<typeof ports> })).rejects.toThrow("unavailable");
    const source = args.project.sourceArtifacts[0]!; source.inputMode = "paste"; source.storageRef = undefined; source.textContent = original;
    await expect(collectServerHtmlCompleteSourceRetention({ ...args, candidate: undefined })).rejects.toThrow("physical Original receipt");
  });
  it("rejects frozen metadata that conflicts with the exact Candidate receipt", async () => {
    rows.get("frozen-blob")!.sha256 = "a".repeat(64);
    await expect(collectServerHtmlCompleteSourceRetention(fixture())).rejects.toThrow("metadata anchor");
  });
  it("rejects metadata changes between the physical observations", async () => {
    let observations = 0;
    const injected = { ...ports(), getMetadata: async (id: string) => {
      if (++observations === 3) rows.get("source-blob")!.updatedAt = "2026-10-13T00:00:01.000Z";
      return rows.get(id);
    } };
    await expect(collectServerHtmlCompleteSourceRetention({ ...fixture(), ports: injected })).rejects.toThrow("changed during collection");
  });
  it("rejects a same-ID forged Candidate and caller paper changes while storage awaits", async () => {
    const forged = fixture(); forged.candidate = { ...forged.candidate, change: "not stored" };
    await expect(collectServerHtmlCompleteSourceRetention(forged)).rejects.toThrow("stored Mission");
    const args = fixture(); let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const pending = collectServerHtmlCompleteSourceRetention({ ...args, ports: { ...ports(), getArtifact: async id => { await paused; return blobs.get(id); } } });
    args.project.protectedItems.push("new frozen condition"); release();
    await expect(pending).rejects.toThrow("changed during collection");
  });
  it("reports actual source changes as differences without a product failure verdict", async () => {
    const args = fixture(), snapshot = args.candidate.artifactSnapshots[0]!, frozen = snapshot.frozenArtifact!;
    const actual = changed.replace("Outside content", "Actual modified footer");
    snapshot.content = actual; snapshot.contentHash = sha(actual); frozen.snapshotHash = sha(actual); frozen.sha256 = sha(actual); frozen.size = Buffer.byteLength(actual);
    blobs.set("frozen-blob", new Blob([actual])); const row = rows.get("frozen-blob")!; row.sha256 = sha(actual); row.sizeBytes = Buffer.byteLength(actual);
    const result = await collectServerHtmlCompleteSourceRetention(args);
    expect(result.comparison.reconstruction.available).toBe(false);
    expect(result.comparison.gaps.some(gap => gap.code === "source-outside-additions-changed")).toBe(true);
    expect(result).not.toHaveProperty("failed");
  });
});
