// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema, SourceArtifactSchema, type EvolveProject } from "@evolution/contracts";
import { materializeServerCandidateArtifacts, serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { repairServerArtifactCandidate } from "./server-artifact-acceptance";

const { blobs, put, ai } = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), put: vi.fn(), ai: vi.fn() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id), put }) }));
vi.mock("./ai-gateway", () => ({ runServerAi: ai }));
const section = (id: string, text = "原有步骤") => '<article class="slide-card" id="' + id + '"><h2>原标题</h2><p>' + text + '</p></article>';
const html = (body: string) => '<html><head></head><body>' + body + '</body></html>';
function fixture(content = html(section("slide-51") + section("slide-52"))) {
  const source = SourceArtifactSchema.parse({ id: "source", name: "tutorial.html", extension: "html", mimeType: "text/html", role: "target", artifactKind: "document", inputMode: "upload", size: Buffer.byteLength(content), textContent: "STALE PARSED INDEX", createdAt: "2026-10-08T00:00:00Z" });
  const candidate = CandidateSchema.parse({ id: "candidate", name: "增加步骤", change: "增加操作示例" });
  const project = { id: "mission", version: "V1", sourceArtifacts: [source], protectedItems: ["保留 slide-51/52 原有标题、内容与结构"], editableItems: [], acceptanceRubric: [], validationRun: { status: "failed" } } as unknown as EvolveProject;
  blobs.set(source.id, new Blob([content], { type: source.mimeType }));
  return { project, candidate, content, source };
}
const outputs = (content: string) => [{ sourceArtifactId: "source", name: "tutorial-evolved.html", mimeType: "text/html", content }];
async function parent(content: string) {
  const sha = await serverArtifactSha256(new TextEncoder().encode(content));
  blobs.set("parent-blob", new Blob([content], { type: "text/html" }));
  return CandidateSchema.parse({ id: "tested", name: "tested", change: "prior", artifactBuildStatus: "ready", artifactSnapshots: [{ id: "snapshot", sourceArtifactId: "source", name: "parent.html", mimeType: "text/html", content, contentHash: sha, createdAt: "2026-10-08T00:00:00Z", frozenArtifact: { sourceArtifactId: "source", snapshotHash: sha, blobId: "parent-blob", name: "parent.html", mimeType: "text/html", sha256: sha, size: Buffer.byteLength(content), verifiedAt: "2026-10-08T00:00:00Z", checks: [], limitations: [] } }] });
}
beforeEach(() => { blobs.clear(); put.mockReset(); ai.mockReset(); put.mockImplementation(async (id: string, blob: Blob) => { blobs.set(id, blob); }); });

describe("server HTML protection before frozen Artifact writes", () => {
  it("uses all 111 actual original slides rather than the inferred 83 or stale index", async () => {
    const body = Array.from({ length: 111 }, (_, i) => section("slide-" + (i + 1))).join("");
    const args = fixture(html(body));
    args.project.protectedItems = ["保留 83 个 slide 章节结构"];
    const result = args.content.replace(section("slide-111"), "");
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(result), "test")).rejects.toThrow(/slide-111/);
    expect(put).not.toHaveBeenCalled();
  });
  it.each(["content", "title", "structure", "root", "missing"])("blocks named protected %s loss in a complete HTML rewrite", async (kind) => {
    const args = fixture();
    const changed = kind === "content" ? section("slide-51").replace("原有步骤", "删除原步骤")
      : kind === "title" ? section("slide-51").replace("原标题", "新标题")
      : kind === "structure" ? section("slide-51").replace(/p>/g, "div>")
      : kind === "root" ? section("slide-51").replace(/article/g, "section")
      : "";
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(html(changed + section("slide-52"))), "test")).rejects.toThrow(/保护章节 slide-51/);
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects destructive exact edits before persisting any bytes", async () => {
    const args = fixture();
    const edit = JSON.stringify({ kind: "text-edits", edits: [{ before: section("slide-51"), after: "" }] });
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(edit), "test")).rejects.toThrow(/slide-51/);
    expect(put).not.toHaveBeenCalled();
  });
  it("blocks new duplicate IDs even without a named protection scope", async () => {
    const args = fixture();
    args.project.protectedItems = [];
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(args.content.replace("</body>", section("slide-51") + "</body>")), "test")).rejects.toThrow(/重复 ID.*slide-51/);
    expect(put).not.toHaveBeenCalled();
  });
  it("keeps the original title, content and structure while freezing additive edits", async () => {
    const args = fixture();
    const changed = args.content.replace("</body>", section("slide-53", "新增操作示例") + "</body>");
    const built = await materializeServerCandidateArtifacts(args.project, args.candidate, outputs(changed), "test");
    const snapshot = built.artifactSnapshots[0]!;
    expect(snapshot.content).toBe(changed);
    expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(changed);
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    expect(snapshot.frozenArtifact!.checks.join(" ")).toContain("HTML 保护");
  });
  it("allows changing an unprotected section when only named slides are protected", async () => {
    const args = fixture(html(section("slide-51") + section("slide-52") + section("slide-53")));
    const built = await materializeServerCandidateArtifacts(args.project, args.candidate, outputs(args.content.replace(section("slide-53"), section("slide-53", "允许修改"))), "test");
    expect(built.artifactBuildStatus).toBe("ready");
  });
  it("checks every Target before writing even when a valid text Target comes first", async () => {
    const args = fixture();
    const other = SourceArtifactSchema.parse({ ...args.source, id: "other", name: "notes.md", extension: "md", mimeType: "text/markdown", size: 3 });
    args.project.sourceArtifacts.unshift(other);
    blobs.set(other.id, new Blob(["old"]));
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, [{ sourceArtifactId: "other", name: "notes.md", mimeType: "text/markdown", content: "new" }, ...outputs(html(section("slide-52")))], "test")).rejects.toThrow(/slide-51/);
    expect(put).not.toHaveBeenCalled();
  });
  it("grounds protected text in the original bytes as well as the tested repair parent", async () => {
    const args = fixture();
    const brokenParent = await parent(args.content.replace("原有步骤", "错误替换"));
    const result = brokenParent.artifactSnapshots[0]!.content.replace("</body>", section("slide-53") + "</body>");
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(result), "repair", brokenParent)).rejects.toThrow(/slide-51/);
    expect(put).not.toHaveBeenCalled();
  });
  it("also retains protected structure introduced in the current tested parent", async () => {
    const args = fixture();
    args.project.protectedItems = ["保留 slide 章节结构"];
    const tested = await parent(args.content.replace("</body>", section("slide-53", "已加入的步骤") + "</body>"));
    const changed = args.content.replace("</body>", section("slide-54", "新的步骤") + "</body>");
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(changed), "repair", tested)).rejects.toThrow(/slide-53/);
    expect(put).not.toHaveBeenCalled();
  });
  it("does not substitute a cached excerpt when the protected original blob is missing", async () => {
    const args = fixture();
    const tested = await parent(args.content);
    args.source.textContent = args.content;
    blobs.delete("source");
    const changed = args.content.replace("</body>", section("slide-53") + "</body>");
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(changed), "repair", tested)).rejects.toThrow(/原文件|父代 Artifact Blob/);
    expect(put).not.toHaveBeenCalled();
  });
  it("applies the same guard to AI Artifact repair without rewriting the tested Candidate", async () => {
    const args = fixture();
    const tested = await parent(args.content);
    ai.mockResolvedValue({ summary: "repair", repairedCriteria: ["CONTENT"], artifacts: outputs(html(section("slide-52"))) });
    await expect(repairServerArtifactCandidate({ project: args.project, candidate: tested, failedCriteria: [AcceptanceCriterionSchema.parse({ id: "CONTENT", title: "内容细化", requirement: "补充步骤", artifactIds: ["source"] })], attempt: 1 })).rejects.toThrow(/slide-51/);
    expect(tested.artifactSnapshots[0]!.content).toBe(args.content);
    expect(put).not.toHaveBeenCalled();
  });
  it("preserves compatibility for legacy callers without a protection list", async () => {
    const args = fixture();
    const legacy = { ...args.project, protectedItems: undefined } as unknown as EvolveProject;
    const built = await materializeServerCandidateArtifacts(legacy, args.candidate, outputs(args.content.replace("</body>", section("slide-53") + "</body>")), "test");
    expect(await verifyServerCandidateFrozenArtifact(built.artifactSnapshots[0]!)).toBe(true);
  });
  it("checks the accepted Search Champion as well as the actual original", async () => {
    const args = fixture();
    args.project.protectedItems = ["保留 slide 章节结构"];
    const accepted = await parent(args.content.replace("</body>", section("slide-53", "已验收步骤") + "</body>"));
    args.project.searchChampion = { id: "champion", candidate: accepted, validation: { status: "completed", candidateId: accepted.id, recommendation: "release" }, artifactAcceptance: { status: "passed", candidateId: accepted.id } } as unknown as EvolveProject["searchChampion"];
    const changed = args.content.replace("</body>", section("slide-54", "新增步骤") + "</body>");
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(changed), "test")).rejects.toThrow(/slide-53/);
    expect(put).not.toHaveBeenCalled();
  });
  it("checks complete pasted HTM files without requiring an uploaded original", async () => {
    const args = fixture();
    Object.assign(args.source, { inputMode: "paste", extension: "htm", name: "tutorial.htm", textContent: args.content });
    blobs.clear();
    await expect(materializeServerCandidateArtifacts(args.project, args.candidate, outputs(html(section("slide-52"))), "test")).rejects.toThrow(/slide-51/);
    expect(put).not.toHaveBeenCalled();
  });

});
