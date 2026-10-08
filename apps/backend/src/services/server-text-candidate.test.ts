// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, SourceArtifactSchema, type EvolveProject } from "@evolution/contracts";
import { buildServerExperimentCandidate, materializeServerCandidateArtifacts, serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";

const {blobs, ai} = vi.hoisted(() => ({blobs: new Map<string, Blob>(), ai: vi.fn()}));
vi.mock("./artifact-runtime", () => ({getServerArtifactStore: () => ({get: async (id: string) => blobs.get(id), put: async (id: string, blob: Blob) => {blobs.set(id, blob);}})}));
vi.mock("./ai-gateway", () => ({runServerAi: ai}));
const before = '<p id="refund-approval">主管确认退款后才进入执行。</p>';
const after = '<p id="refund-approval">主管确认退款后才进入执行，并记录审批编号。</p>';
const original = '<html><head><meta charset="utf-8"></head><body>' + '<p>保留每个章节和原有说明。</p>'.repeat(10000) + before + '</body></html>';
function fixture() {
  const source = SourceArtifactSchema.parse({id: "source", name: "large.html", extension: "html", mimeType: "text/html", artifactKind: "document", role: "target", size: Buffer.byteLength(original), inputMode: "upload", parseStatus: "ready", textContent: "STALE INDEX", createdAt: "2026-10-08T00:00:00.000Z"});
  const candidate = CandidateSchema.parse({id: "child", name: "补充退款审批编号", change: "主管确认退款后记录审批编号", patches: [{id: "patch", component: "code", operation: "update", target: before, artifactId: source.id, content: after, rationale: "在现有退款审批说明中增加编号"}]});
  const project = {id: "text-mission", name: "实际长 HTML", version: "V1", sourceArtifacts: [source], goal: "完整保留文件，并细化退款审批", evolutionCommand: "主管确认退款后记录审批编号", protectedItems: [], editableItems: [], acceptanceRubric: []} as unknown as EvolveProject;
  blobs.set(source.id, new Blob([original], {type: source.mimeType}));
  return {project, candidate, source};
}
function output(content: string) {
  return {summary: "局部变异", artifacts: [{sourceArtifactId: "source", name: "large-evolved.html", mimeType: "text/html", content, buildMode: "ai-full" as const, notes: []}]};
}
const edits = (beforeText = before, afterText = after) => JSON.stringify({kind: "text-edits", edits: [{before: beforeText, after: afterText}]});
beforeEach(() => {blobs.clear(); ai.mockReset();});

describe("server full text Candidate construction", () => {
  it("retrieves late source evidence and applies the model edit to the complete uploaded bytes", async () => {
    const {project, candidate} = fixture();
    ai.mockImplementation(async (_operation: string, payload: {project: {currentTargets: Array<{content: string; originalChars: number; mutationMode: string}>}}) => {
      const context = payload.project.currentTargets[0]!;
      expect(context.content).toContain(before);
      expect(context.content).not.toContain("STALE INDEX");
      expect(context.content.length).toBeLessThanOrEqual(22000);
      expect(context.originalChars).toBe(original.length);
      expect(context.mutationMode).toBe("text-edits");
      return output(edits());
    });
    const built = await buildServerExperimentCandidate(project, candidate);
    const snapshot = built.artifactSnapshots[0]!;
    expect(snapshot.content).toBe(original.replace(before, after));
    expect(snapshot.content.length).toBeGreaterThan(180000);
    expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(snapshot.content);
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    expect(ai).toHaveBeenCalledOnce();
  });
  it("refuses a full rewrite generated from incomplete context before freezing bytes", async () => {
    const {project, candidate} = fixture();
    ai.mockResolvedValue(output("<html><body>short replacement</body></html>"));
    await expect(buildServerExperimentCandidate(project, candidate)).rejects.toThrow("必须返回 text-edits");
    expect([...blobs.keys()]).toEqual(["source"]);
  });
  it("does not send a parsed upload index to AI when its actual file is missing", async () => {
    const {project, candidate} = fixture();
    blobs.delete("source");
    await expect(buildServerExperimentCandidate(project, candidate)).rejects.toThrow("父代 Artifact Blob");
    expect(ai).not.toHaveBeenCalled();
  });
  it("allows a canonical pasted source without inventing an uploaded Blob", async () => {
    const {project, candidate, source} = fixture();
    source.inputMode = "paste";
    source.textContent = original;
    blobs.clear();
    ai.mockResolvedValue(output(edits()));
    const built = await buildServerExperimentCandidate(project, candidate);
    expect(built.artifactSnapshots[0]!.content).toBe(original.replace(before, after));
    expect([...blobs.keys()]).toHaveLength(1);
  });
  it.each([edits(before, before), edits("invented source anchor", after)])("refuses no-op or ungrounded text edits", async (content) => {
    const {project, candidate} = fixture();
    await expect(materializeServerCandidateArtifacts(project, candidate, output(content).artifacts, "test")).rejects.toThrow();
    expect([...blobs.keys()]).toEqual(["source"]);
  });
  it("applies child edits to exact accepted Champion bytes, retaining the parent's improvements", async () => {
    const {project, candidate, source} = fixture();
    const content = original.replace("<body>", "<body><p>已通过的父代改进</p>");
    const sha256 = await serverArtifactSha256(new TextEncoder().encode(content));
    const parent = CandidateSchema.parse({id: "parent", name: "parent", change: "prior", artifactSnapshots: [{id: "parent-snapshot", sourceArtifactId: source.id, name: "parent.html", mimeType: source.mimeType, content, contentHash: sha256, createdAt: "2026-10-08T00:00:00.000Z", frozenArtifact: {sourceArtifactId: source.id, snapshotHash: sha256, blobId: "parent-blob", name: "parent.html", mimeType: source.mimeType, sha256, size: Buffer.byteLength(content), verifiedAt: "2026-10-08T00:00:00.000Z", checks: [], limitations: []}}]});
    project.searchChampion = {id: "champion", versionLabel: "S1", candidate: parent, validation: {status: "completed", candidateId: parent.id, recommendation: "release"}, artifactAcceptance: {status: "passed", candidateId: parent.id}} as unknown as EvolveProject["searchChampion"];
    blobs.set("parent-blob", new Blob([content], {type: source.mimeType}));
    blobs.delete("source");
    ai.mockResolvedValue(output(edits()));
    const built = await buildServerExperimentCandidate(project, candidate);
    expect(built.artifactSnapshots[0]!.content).toBe(content.replace(before, after));
    expect(built.artifactSnapshots[0]!.content).toContain("已通过的父代改进");
    expect(await verifyServerCandidateFrozenArtifact(built.artifactSnapshots[0]!)).toBe(true);
    const frozen = parent.artifactSnapshots[0]!.frozenArtifact!;
    parent.artifactSnapshots[0]!.frozenArtifact = {...frozen, sha256: "0".repeat(64)};
    await expect(buildServerExperimentCandidate(project, candidate)).rejects.toThrow("冻结文件");
    expect(ai).toHaveBeenCalledOnce();
  });
});
