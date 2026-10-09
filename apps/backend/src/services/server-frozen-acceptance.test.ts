// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, SourceArtifactSchema, type EvolveProject } from "@evolution/contracts";
import { verifyServerFrozenCandidateArtifacts } from "./server-artifact-acceptance";
import { materializeServerCandidateArtifacts, serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
const { blobs, put } = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), put: vi.fn() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id), put }) }));
const content = '<html><body>TESTED REAL CANDIDATE</body></html>';
async function fixture() {
  const source = SourceArtifactSchema.parse({ id: "source", name: "original.html", extension: "html", mimeType: "text/html", artifactKind: "document", role: "target", size: 1, inputMode: "upload", parseStatus: "ready", createdAt: "2026-10-08T00:00:00.000Z" });
  const sha256 = await serverArtifactSha256(new TextEncoder().encode(content));
  const receipt = { sourceArtifactId: source.id, snapshotHash: sha256, blobId: "tested-blob", name: "evolved.html", mimeType: "text/html", sha256, size: Buffer.byteLength(content), verifiedAt: source.createdAt, checks: [], limitations: [] };
  blobs.set(receipt.blobId, new Blob([content], { type: receipt.mimeType }));
  const candidate = CandidateSchema.parse({ id: "tested", name: "Tested Candidate", change: "improve", artifactSnapshots: [{ id: "snapshot", sourceArtifactId: source.id, name: receipt.name, mimeType: receipt.mimeType, content, contentHash: sha256, createdAt: source.createdAt, frozenArtifact: receipt }] });
  const project = { id: "mission", sourceArtifacts: [source] } as unknown as EvolveProject;
  return { project, candidate };
}
beforeEach(() => { blobs.clear(); put.mockReset(); });
describe("server Gate F exact frozen Candidate verification", () => {
  it("accepts a renamed evolved file with complete consistent identity", async () => {
    const args = await fixture();
    const checked = await verifyServerFrozenCandidateArtifacts(args);
    expect(checked.verified).toEqual([args.candidate.artifactSnapshots[0]!.frozenArtifact]);
    expect(checked.failed).toEqual([]);
    expect(checked.unavailable).toEqual([]);
    expect(put).not.toHaveBeenCalled();
  });
  it.each(["candidate.zip", "candidate.md", "candidate"])("rejects a jointly wrong Snapshot/receipt suffix %s", async (name) => {
    const args = await fixture();
    const file = args.candidate.artifactSnapshots[0]!;
    file.name = name;
    file.frozenArtifact!.name = name;
    expect(await verifyServerCandidateFrozenArtifact(file,args.project.sourceArtifacts[0]!)).toBe(false);
    const checked = await verifyServerFrozenCandidateArtifacts(args);
    expect(checked.verified).toEqual([]);
    expect(checked.failed).toHaveLength(1);
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects a historical HTML whose Snapshot and receipt share a wrong ZIP name and MIME", async () => {
    const args = await fixture();
    const file = args.candidate.artifactSnapshots[0]!;
    file.name = file.frozenArtifact!.name = "candidate.zip";
    file.mimeType = file.frozenArtifact!.mimeType = "application/zip";
    expect(await verifyServerCandidateFrozenArtifact(file,args.project.sourceArtifacts[0]!)).toBe(false);
    expect((await verifyServerFrozenCandidateArtifacts(args)).failed).toHaveLength(1);
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects a legal AI HTML artifact with a ZIP name before freezing any bytes", async () => {
    const args = await fixture();
    const source = args.project.sourceArtifacts[0]!;
    const original = '<html><body>ORIGINAL INPUT</body></html>';
    source.size = Buffer.byteLength(original);
    blobs.set(source.id,new Blob([original],{type:source.mimeType}));
    await expect(materializeServerCandidateArtifacts(args.project,args.candidate,[{
      sourceArtifactId:source.id,name:"candidate.zip",mimeType:"text/html",content,
    }],"changed HTML")).rejects.toThrow("不符合原文本格式");
    expect(put).not.toHaveBeenCalled();
  });
  it.each(["renamed.HTML", "renamed.htm"])("freezes same-format %s with exact Snapshot/receipt name and bytes", async (name) => {
    const args = await fixture();
    const source = args.project.sourceArtifacts[0]!;
    const original = '<html><body>ORIGINAL INPUT</body></html>';
    source.size = Buffer.byteLength(original);
    blobs.set(source.id,new Blob([original],{type:source.mimeType}));
    put.mockImplementation(async (id:string,blob:Blob) => {blobs.set(id,blob);});
    const built = await materializeServerCandidateArtifacts(args.project,args.candidate,[{
      sourceArtifactId:source.id,name,mimeType:"text/html",content,
    }],"changed HTML");
    const file = built.artifactSnapshots[0]!;
    expect(file.name).toBe(name);
    expect(file.frozenArtifact!.name).toBe(file.name);
    expect(await blobs.get(file.frozenArtifact!.blobId)!.text()).toBe(content);
    expect(await verifyServerCandidateFrozenArtifact(file,source)).toBe(true);
    expect((await verifyServerFrozenCandidateArtifacts({project:args.project,candidate:built})).verified).toEqual([file.frozenArtifact]);
    expect(put).toHaveBeenCalledOnce();
  });
  it.each(["name", "MIME", "Snapshot-content", "snapshot-hash"])("refuses inconsistent %s even when stored file bytes still match the receipt", async (kind) => {
    const args = await fixture();
    const file = args.candidate.artifactSnapshots[0]!;
    if (kind === "name") file.frozenArtifact!.name = "another.html";
    if (kind === "MIME") file.frozenArtifact!.mimeType = "text/plain";
    if (kind === "Snapshot-content") {
      file.content = '<html><body>UNTESTED DIFFERENT SNAPSHOT</body></html>';
      file.contentHash = await serverArtifactSha256(new TextEncoder().encode(file.content));
      file.frozenArtifact!.snapshotHash = file.contentHash;
    }
    if (kind === "snapshot-hash") { file.content = "changed after test"; file.contentHash = undefined; }
    const checked = await verifyServerFrozenCandidateArtifacts(args);
    expect(checked.verified).toEqual([]);
    expect(checked.failed.length).toBe(1);
    expect(put).not.toHaveBeenCalled();
  });
  it("reports missing frozen bytes as unavailable", async () => {
    const args = await fixture();
    blobs.clear();
    const checked = await verifyServerFrozenCandidateArtifacts(args);
    expect(checked.unavailable.length).toBe(1);
    expect(checked.failed).toEqual([]);
    expect(checked.verified).toEqual([]);
  });
  it("refuses duplicate Snapshot source bindings", async () => {
    const args = await fixture();
    args.candidate.artifactSnapshots.push({ ...args.candidate.artifactSnapshots[0]!, id: "duplicate" });
    const checked = await verifyServerFrozenCandidateArtifacts(args);
    expect(checked.unavailable.length).toBe(1);
    expect(checked.verified).toEqual([]);
  });
});
