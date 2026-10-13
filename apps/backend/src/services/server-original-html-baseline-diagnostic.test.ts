// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, SourceArtifactSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { readServerOriginalHtmlBaselineDiagnosticBinding } from "./server-original-html-baseline-diagnostic";
vi.mock("./server-html-artifact-execution", () => ({ serverHtmlArtifactTargetEnabled: (project: EvolveProject) => project.targetConnection.adapter === "artifact" }));
const html = "\uFEFF<!doctype html><html>\r\n<body>完整正文😄<script>globalThis.syntheticDiagnosticExecuted=true;</script></body></html>";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const source = SourceArtifactSchema.parse({ id: "S", name: "source.html", extension: "html", mimeType: "text/html", role: "target", artifactKind: "document",
    inputMode: "upload", storageRef: "actual-blob", size: Buffer.byteLength(html), textContent: "Stale parser index", createdAt: "2026-10-13T00:00:00Z" });
  const integrity = AcceptanceCriterionSchema.parse({ id: "SYS-INTEGRITY", title: "成果完整性",
    requirement: "最终成果必须完整、无截断、无占位符、无未处理 TODO，且不能因进化丢失未授权内容。",
    source: "system-integrity", weight: 8, hardGate: true, judgeType: "integrity", validationMethod: "static-structure", minScore: 95,
    evidenceExpected: ["完整成果", "无 truncation / placeholder / unresolved TODO"], protectedConstraint: true, artifactIds: [], category: "integrity" });
  const testCase = TestCaseSchema.parse({ id: "I", title: "Current integrity", input: "Inspect current source", expected: ["Actual complete file"], hidden: false,
    criterionIds: [integrity.id], executionMode: "static-evidence", evidenceScope: "implementation" });
  const project = { id: "M", version: "V1", sourceArtifacts: [source], protectedItems: ["核心方法"], acceptanceRubric: [integrity], evalSuite: [testCase],
    hiddenEvalSuite: [{ ...testCase, id: "H-I", hidden: true }], campaign: { currentRound: 0 }, candidates: [],
    targetConnection: { adapter: "artifact", connectionId: "artifact", status: "connected", label: "HTML" } } as unknown as EvolveProject;
  const blobs = new Map<string, Blob>([["actual-blob", new Blob([html])]]), getArtifact = vi.fn(async (id: string) => blobs.get(id));
  return { project, testCase, ports: { getArtifact }, blobs, getArtifact };
}
const portArgs = (value: ReturnType<typeof fixture>) => ({ project: value.project, testCase: value.testCase, ports: value.ports });
describe("server-owned initial HTML physical diagnostic binding", () => {
  it("reads exact actual bytes twice with unchanged stored visible paper and no execution/pass claim", async () => {
    const f = fixture(), actual = await readServerOriginalHtmlBaselineDiagnosticBinding(portArgs(f));
    expect(f.getArtifact).toHaveBeenCalledTimes(2);
    expect(actual.binding.original).toEqual(actual.binding.executed);
    expect(actual.binding.executed).toEqual({ sourceArtifactId: "S", sha256: sha(html), byteLength: Buffer.byteLength(html) });
    expect(actual.binding.subject).toEqual({ kind: "current", versionId: "V1" });
    expect(actual).not.toHaveProperty("passed"); expect(actual).not.toHaveProperty("diagnosticReady");
    expect(actual).not.toHaveProperty("originalHtml"); expect((globalThis as Record<string, unknown>).syntheticDiagnosticExecuted).toBeUndefined();
  });
  it.each(["missing-blob", "wrong-size", "invalid-utf8", "same-size-drift"])("refuses %s rather than trusting metadata", async variant => {
    const f = fixture();
    if (variant === "missing-blob") f.blobs.clear();
    if (variant === "wrong-size") f.project.sourceArtifacts[0]!.size++;
    if (variant === "invalid-utf8") { f.blobs.set("actual-blob", new Blob([new Uint8Array([255])])); f.project.sourceArtifacts[0]!.size = 1; }
    if (variant === "same-size-drift") f.getArtifact.mockImplementation(async id => {
      if (f.getArtifact.mock.calls.length === 2) f.blobs.set("actual-blob", new Blob([html.replace("正文", "变化")]));
      return f.blobs.get(id);
    });
    await expect(readServerOriginalHtmlBaselineDiagnosticBinding(portArgs(f))).rejects.toThrow();
  });
  it.each(["changed-paper", "hidden", "duplicate-source", "later-round", "noncanonical", "paste", "foreign-route"])("rejects %s qualification scope", async variant => {
    const f = fixture();
    if (variant === "changed-paper") f.testCase = { ...f.testCase, input: "Client replacement paper" };
    if (variant === "hidden") f.testCase = { ...f.testCase, hidden: true };
    if (variant === "duplicate-source") f.project.sourceArtifacts.push(f.project.sourceArtifacts[0]!);
    if (variant === "later-round") f.project.campaign.currentRound = 1;
    if (variant === "noncanonical") f.project.acceptanceRubric[0]!.requirement = "All functions must work";
    if (variant === "paste") f.project.sourceArtifacts[0]!.inputMode = "paste";
    if (variant === "foreign-route") f.project.targetConnection.adapter = "http";
    await expect(readServerOriginalHtmlBaselineDiagnosticBinding(portArgs(f))).rejects.toThrow();
    expect(f.getArtifact).not.toHaveBeenCalled();
  });
  it("captures input clones and rejects changed caller paper during storage awaits", async () => {
    const f = fixture();
    f.getArtifact.mockImplementation(async id => { f.project.evalSuite[0]!.input = "Changed during I/O"; return f.blobs.get(id); });
    await expect(readServerOriginalHtmlBaselineDiagnosticBinding(portArgs(f))).rejects.toThrow("changed during readback");
  });
  it("refuses arbitrary external qualification fields rather than accepting a Candidate override", async () => {
    const f = fixture();
    await expect(readServerOriginalHtmlBaselineDiagnosticBinding({ ...portArgs(f), candidate: "override" } as Parameters<typeof readServerOriginalHtmlBaselineDiagnosticBinding>[0])).rejects.toThrow();
  });
});
