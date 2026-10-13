// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema, SourceArtifactSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { prepareServerHtmlProtectionCollectionPlan } from "./server-html-protection-collection-plan";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const at = "2026-10-13T00:00:00Z";
const original = '<!doctype html><html><head><style>.slide-card{display:block}</style></head><body><input id="search"><output id="searchCount"></output><section class="chapter" id="chapter"><article class="slide-card" id="card" data-search="alpha"><h2>Original heading</h2><p>Original method</p><button id="copy">Copy</button></article></section><script>const original=true;</script></body></html>';
const changed = original.replace("Original method", "Original method with detailed configuration and beginner examples");
const { blobs } = vi.hoisted(() => ({ blobs: new Map<string, Blob>() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id) }) }));
function fixture() {
  const source = SourceArtifactSchema.parse({ id: "S1", name: "source.html", extension: "html", mimeType: "text/html", role: "target", artifactKind: "document", inputMode: "upload", storageRef: "source-blob", size: Buffer.byteLength(original), textContent: "stale parsed excerpt", createdAt: at });
  const protect = AcceptanceCriterionSchema.parse({ id: "PROTECT-ALL", title: "保护", requirement: "保留方法核心、章节结构、样式和交互", protectedConstraint: true, hardGate: true, artifactIds: [source.id] });
  const refine = AcceptanceCriterionSchema.parse({ id: "DETAIL", title: "细化", requirement: "章节配置细节有效细化、参数说明更完整", hardGate: true, artifactIds: [source.id] });
  const testCase = TestCaseSchema.parse({ id: "H1", title: "保护", input: "Complete Original", expected: ["保留"], hidden: true, criterionIds: [protect.id] });
  const candidate = CandidateSchema.parse({ id: "C1", name: "Changed", change: "Actual refinement", artifactSnapshots: [{ id: "snap", sourceArtifactId: source.id, name: "changed.html", mimeType: "text/html", content: changed, contentHash: sha(changed), createdAt: at, frozenArtifact: { sourceArtifactId: source.id, snapshotHash: sha(changed), blobId: "frozen-blob", name: "changed.html", mimeType: "text/html", sha256: sha(changed), size: Buffer.byteLength(changed), verifiedAt: at, checks: [], limitations: [] } }] });
  const project = { id: "M1", version: "V1", goal: "Not part of the frozen paper", protectedItems: ["核心方法", "交互"], sourceArtifacts: [source], acceptanceRubric: [protect, refine], evalSuite: [], hiddenEvalSuite: [testCase], candidates: [candidate] } as unknown as EvolveProject;
  return { project, candidate, testCase, criterionId: protect.id, execution: { executionId: "E1", jobId: "J1", generation: 1 } };
}
beforeEach(() => { blobs.clear(); blobs.set("source-blob", new Blob([original])); blobs.set("frozen-blob", new Blob([changed])); });
describe("actual-file, frozen-paper HTML collection plan", () => {
  it("binds full actual bytes and full Original registry, choosing declared semantic refinement requirements", async () => {
    const result = await prepareServerHtmlProtectionCollectionPlan(fixture());
    expect(result.binding.original.sha256).toBe(sha(original));
    expect(result.binding.executed.sha256).toBe(sha(changed));
    expect(result.physicalInputs.original.equals(Buffer.from(original))).toBe(true);
    expect(result.physicalInputs.executed.equals(Buffer.from(changed))).toBe(true);
    expect(result.obligationPlan.contentScope?.mode).toBe("semantic-refinement");
    expect(result.runtimePlan.census.cards).toBe(1);
    expect(result.runtimePlan.census.chapters).toBe(1);
    expect(result.searchRegistration?.states.map(state => state.stateKind)).toEqual(["boot", "query-positive", "query-negative", "clear"]);
    expect(result.searchRequests).toHaveLength(8);
    expect(result.searchRequiresStatefulExecution).toBe(true);
    expect(result.bootRequests.length).toBe(result.runtimePlan.bootBatches.length * 2);
    expect(result.bootRequests.every(request => request.binding === result.binding)).toBe(false); // schema owns each cloned binding
    for (const request of result.bootRequests) {
      expect(request.binding).toEqual(result.binding);
      expect(request.planSha256).toBe(result.planSha256);
      expect(request.registry.originalSha256).toBe(sha(original));
      expect(request.documentUrl).toBe("http://127.0.0.1:4173/index.html");
      expect(request.execution).toEqual(fixture().execution);
    }
    for (const key of ["passed", "proof", "evidence", "verificationStatus", "attestation"]) expect(result).not.toHaveProperty(key);
  });
  it("keeps Original/paper expected plan identical across current and Candidate on the same Hidden", async () => {
    const args = fixture(), candidate = await prepareServerHtmlProtectionCollectionPlan(args);
    const current = await prepareServerHtmlProtectionCollectionPlan({ ...args, candidate: undefined, execution: { ...args.execution, executionId: "current-arm" } });
    expect(current.planSha256).toBe(candidate.planSha256);
    expect(current.obligationPlan).toEqual(candidate.obligationPlan);
    expect(current.binding.paperSha256).toBe(candidate.binding.paperSha256);
    expect(current.binding.executed.sha256).toBe(sha(original));
    expect(current.binding.subject).toEqual({ kind: "current", versionId: "V1" });
  });
  it("changes plan identity on frozen requirements, but never reads mutable goal as authority", async () => {
    const args = fixture(), first = await prepareServerHtmlProtectionCollectionPlan(args);
    args.project.goal = "Unfrozen goal override";
    expect((await prepareServerHtmlProtectionCollectionPlan(args)).planSha256).toBe(first.planSha256);
    args.project.acceptanceRubric[1]!.requirement = "正文逐字保持不变";
    const next = await prepareServerHtmlProtectionCollectionPlan(args);
    expect(next.planSha256).not.toBe(first.planSha256);
    expect(next.obligationPlan.contentScope?.mode).toBe("literal-retention");
  });
  it("rejects an argument with the same Candidate ID but different stored contents", async () => {
    const args = fixture(); args.candidate = { ...args.candidate, change: "forged proposal" };
    await expect(prepareServerHtmlProtectionCollectionPlan(args)).rejects.toThrow("differs from the unique stored");
  });
  it("captures paper/subject/execution before storage awaits", async () => {
    const args = fixture(); let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const result = prepareServerHtmlProtectionCollectionPlan({ ...args, ports: { getArtifact: async id => { await paused; return blobs.get(id); } } });
    args.project.acceptanceRubric[1]!.requirement = "正文逐字不变";
    args.execution.generation = 99; args.candidate.change = "mutated while pending";
    release();
    const plan = await result;
    expect(plan.obligationPlan.contentScope?.mode).toBe("semantic-refinement");
    expect(plan.bootRequests.every(request => request.execution.generation === 1)).toBe(true);
  });
  it("retains missing/ambiguous runtime scope and actual-file errors without inventing collection results", async () => {
    const args = fixture(); blobs.delete("frozen-blob");
    await expect(prepareServerHtmlProtectionCollectionPlan(args)).rejects.toThrow("unavailable");
    const sourceOnly = await prepareServerHtmlProtectionCollectionPlan({ ...args, candidate: undefined });
    expect(sourceOnly.runtimePlan.gaps.some(gap => gap.code === "coarse-runtime-unresolved")).toBe(true);
    expect(sourceOnly.obligationPlan.requiredObligations.filter(item => item.kind === "unknown-runtime").every(item => item.support === "unresolved")).toBe(true);
  });
});
