// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema, SourceArtifactSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { readServerHtmlProtectionInputs } from "./server-html-protection-input";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const original = "\uFEFF<html>\r\n<body><article class='slide-card' id='slide-1'>原始内容</article><script>window.fixture = true;</script></body></html>";
const changed = original.replace("原始内容", "原始内容及可验证改进");
const at = "2026-10-12T00:00:00.000Z";
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Blob>() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id) }) }));
function fixture() {
  const source = SourceArtifactSchema.parse({ id: "S1", name: "source.html", extension: "html", mimeType: "text/html", role: "target", artifactKind: "document", inputMode: "upload", storageRef: "source-blob", size: Buffer.byteLength(original), textContent: "stale parser index", createdAt: at });
  const criterion = AcceptanceCriterionSchema.parse({ id: "PROTECT-ALL", title: "保护", requirement: "原始内容和交互", protectedConstraint: true, hardGate: true, artifactIds: ["S1"] });
  const testCase = TestCaseSchema.parse({ id: "H1", title: "保护", input: "inspect whole source", expected: ["保持内容"], hidden: true, criterionIds: ["PROTECT-ALL"] });
  const project = { id: "M1", version: "V1", protectedItems: ["全部原卡片", "交互"], sourceArtifacts: [source], acceptanceRubric: [criterion], evalSuite: [], hiddenEvalSuite: [testCase] } as unknown as EvolveProject;
  const candidate = CandidateSchema.parse({ id: "C1", name: "改进", change: "实际变异", artifactSnapshots: [{ id: "snap", sourceArtifactId: "S1", name: "changed.html", mimeType: "text/html", content: changed, contentHash: sha(changed), createdAt: at, frozenArtifact: { sourceArtifactId: "S1", snapshotHash: sha(changed), blobId: "frozen-blob", name: "changed.html", mimeType: "text/html", sha256: sha(changed), size: Buffer.byteLength(changed), verifiedAt: at, checks: [], limitations: [] } }] });
  project.candidates = [candidate];
  return { project, testCase, candidate, criterionId: "PROTECT-ALL" };
}
beforeEach(() => { blobs.clear(); blobs.set("source-blob", new Blob([original])); blobs.set("frozen-blob", new Blob([changed])); });
describe("HTML protection physical input boundary", () => {
  it("pins both exact physical files, preserving BOM/CRLF/Unicode and no acceptance claims", async () => {
    const args = fixture(), result = await readServerHtmlProtectionInputs(args);
    expect(result.originalHtml).toBe(original); expect(result.executedHtml).toBe(changed);
    expect(result.binding.original).toMatchObject({ sha256: sha(original), byteLength: Buffer.byteLength(original) });
    expect(result.binding.executed.sha256).toBe(sha(changed)); expect(result.binding.subject).toEqual({ kind: "candidate", candidateId: "C1" });
    expect(result).not.toHaveProperty("verificationStatus");
    expect((globalThis as Record<string, unknown>).fixture).toBeUndefined();
  });
  it("uses original bytes as the current arm and the same stored Hidden paper as Candidate", async () => {
    const args = fixture(), current = await readServerHtmlProtectionInputs({ ...args, candidate: undefined });
    const candidate = await readServerHtmlProtectionInputs(args);
    expect(current.binding.original).toEqual(current.binding.executed);
    expect(current.binding.subject).toEqual({ kind: "current", versionId: "V1" });
    expect(current.binding.paperSha256).toBe(candidate.binding.paperSha256);
  });
  it("pins an accepted Champion as current while preserving original baseline", async () => {
    const args = fixture(); args.project.searchChampion = { candidate: args.candidate, validation: { status: "completed", recommendation: "release" }, artifactAcceptance: { status: "passed", candidateId: args.candidate.id } } as EvolveProject["searchChampion"];
    const result = await readServerHtmlProtectionInputs({ ...args, candidate: undefined });
    expect(result.binding.subject).toEqual({ kind: "current", versionId: "C1" });
    expect(result.binding.original.sha256).toBe(sha(original)); expect(result.binding.executed.sha256).toBe(sha(changed));
  });
  it("never falls back to Source for an untrusted Champion or missing frozen bytes", async () => {
    const args = fixture(); args.project.searchChampion = { candidate: args.candidate } as EvolveProject["searchChampion"];
    await expect(readServerHtmlProtectionInputs({ ...args, candidate: undefined })).rejects.toThrow("trusted Champion");
    blobs.delete("frozen-blob");
    await expect(readServerHtmlProtectionInputs(args)).rejects.toThrow("unavailable");
  });
  it.each(["snapshot", "hash", "name", "source", "mime", "snapshot-hash", "format"])("rejects %s receipt drift", async kind => {
    const args = fixture(), snapshot = args.candidate.artifactSnapshots[0]!, frozen = snapshot.frozenArtifact!;
    if (kind === "snapshot") snapshot.content += "tampered";
    if (kind === "hash") frozen.sha256 = "a".repeat(64);
    if (kind === "name") frozen.name = "another.html";
    if (kind === "source") frozen.sourceArtifactId = "foreign";
    if (kind === "mime") frozen.mimeType = "text/plain";
    if (kind === "snapshot-hash") snapshot.contentHash = "a".repeat(64);
    if (kind === "format") { snapshot.name = "candidate.zip"; frozen.name = snapshot.name; }
    await expect(readServerHtmlProtectionInputs(args)).rejects.toThrow();
  });
  it("observes same-size source changes from bytes independently of stale parsed text", async () => {
    const args = fixture(), first = await readServerHtmlProtectionInputs(args);
    blobs.set("source-blob", new Blob([original.replace("原始", "变更")]));
    const second = await readServerHtmlProtectionInputs(args);
    expect(second.binding.original.sha256).not.toBe(first.binding.original.sha256);
    expect(second.binding.paperSha256).toBe(first.binding.paperSha256);
  });
  it.each(["missing-source", "wrong-source-size", "missing-frozen", "invalid-utf8", "duplicate-snapshot"])("rejects %s physical input", async kind => {
    const args = fixture();
    if (kind === "missing-source") blobs.delete("source-blob");
    if (kind === "wrong-source-size") args.project.sourceArtifacts[0]!.size++;
    if (kind === "missing-frozen") blobs.delete("frozen-blob");
    if (kind === "invalid-utf8") { blobs.set("source-blob", new Blob([new Uint8Array([255])])); args.project.sourceArtifacts[0]!.size = 1; }
    if (kind === "duplicate-snapshot") args.candidate.artifactSnapshots.push(args.candidate.artifactSnapshots[0]!);
    await expect(readServerHtmlProtectionInputs(args)).rejects.toThrow();
  });
  it.each(["changed-case", "foreign-case", "duplicate-case", "foreign-scope", "duplicate-source", "unmapped-criterion", "non-hard", "foreign-candidate", "duplicate-candidate"])("rejects %s paper/scope", async kind => {
    const args = fixture();
    if (kind === "changed-case") args.testCase = { ...args.testCase, expected: ["invented assertion"] };
    if (kind === "foreign-case") args.testCase = { ...args.testCase, id: "another" };
    if (kind === "duplicate-case") args.project.hiddenEvalSuite.push(args.testCase);
    if (kind === "foreign-scope") args.project.acceptanceRubric[0]!.artifactIds.push("foreign");
    if (kind === "duplicate-source") args.project.sourceArtifacts.push(args.project.sourceArtifacts[0]!);
    if (kind === "unmapped-criterion") args.testCase.criterionIds = [];
    if (kind === "non-hard") args.project.acceptanceRubric[0]!.hardGate = false;
    if (kind === "foreign-candidate") args.project.candidates = [];
    if (kind === "duplicate-candidate") args.project.candidates.push(args.candidate);
    await expect(readServerHtmlProtectionInputs(args)).rejects.toThrow();
  });
  it("changes the paper identity on stored expectation, protected intent or rubric changes", async () => {
    const args = fixture(), first = await readServerHtmlProtectionInputs(args);
    args.project.protectedItems.push("新的明确保护项");
    const intent = await readServerHtmlProtectionInputs(args);
    expect(intent.binding.paperSha256).not.toBe(first.binding.paperSha256);
    args.project.acceptanceRubric[0]!.minScore++;
    const rubric = await readServerHtmlProtectionInputs(args);
    expect(rubric.binding.paperSha256).not.toBe(intent.binding.paperSha256);
    args.testCase.expected.push("另一项真实断言");
    expect((await readServerHtmlProtectionInputs(args)).binding.paperSha256).not.toBe(rubric.binding.paperSha256);
  });
  it("reads complete pasted HTML only when there is no explicit storage binding", async () => {
    const args = fixture(), source = args.project.sourceArtifacts[0]!;
    source.inputMode = "paste"; source.storageRef = undefined; source.textContent = original;
    blobs.delete("source-blob");
    expect((await readServerHtmlProtectionInputs(args)).originalHtml).toBe(original);
    source.storageRef = "missing-explicit";
    await expect(readServerHtmlProtectionInputs(args)).rejects.toThrow("Original physical");
  });
});
