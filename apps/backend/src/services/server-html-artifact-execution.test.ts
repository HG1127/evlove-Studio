// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, SourceArtifactSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { runServerHtmlArtifactBatch, serverHtmlArtifactTargetEnabled } from "./server-html-artifact-execution";
import { executeServerBaselineExternal } from "./server-baseline";
import { serverArtifactSha256 } from "./server-experiment-artifacts";
const { blobs, run, visual } = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), run: vi.fn(), visual: vi.fn() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id) }) }));
vi.mock("@evolution/adapters/sandbox", async (importOriginal) => ({ ...await importOriginal<typeof import("@evolution/adapters/sandbox")>(), ...await (() => ({ runVercelSandboxHtmlValidation: run, runVercelSandboxCodebaseValidation: vi.fn() }))() }));
vi.mock("./server-http-target-execution", async (importOriginal) => ({ ...await importOriginal<typeof import("./server-http-target-execution")>(), runServerHttpTargetBatch: vi.fn() }));
vi.mock("./connector-target-source", () => ({ serverConnectorTargetEnabled: () => false }));
vi.mock("./server-visual-evidence", () => ({ attachServerVisualEvidence: visual }));
const original = '<html><body><p id="actual">完整原文件</p></body></html>';
const evolved = '<html><body><p id="actual">真实候选改进</p></body></html>';
const testCase = TestCaseSchema.parse({ id: "H1", title: "保护实际内容", input: "inspect actual", expected: ["实际"], hidden: true, criterionIds: ["HTML"], executionMode: "external-runner", evidenceScope: "product-behavior", browserSteps: [{ action: "visible", selector: "#actual" }] });
function fixture() {
  const source = SourceArtifactSchema.parse({ id: "source", name: "original.html", extension: "html", mimeType: "text/html", artifactKind: "document", role: "target", size: Buffer.byteLength(original), inputMode: "upload", parseStatus: "ready", textContent: "STALE TRUNCATED INDEX", warnings: ["进入 AI 上下文的部分已截断"], createdAt: "2026-10-08T00:00:00.000Z" });
  const project = { id: "html-mission", name: "实际 HTML", version: "V1", goal: "保留文件", targetConnection: { adapter: "artifact" }, sourceArtifacts: [source], acceptanceRubric: [{ id: "HTML", artifactIds: [source.id] }] } as unknown as EvolveProject;
  blobs.set(source.id, new Blob([original], { type: source.mimeType }));
  return project;
}
async function candidate(project: EvolveProject) {
  const source = project.sourceArtifacts[0]!;
  const sha256 = await serverArtifactSha256(new TextEncoder().encode(evolved));
  const blobId = `frozen:${sha256}`;
  blobs.set(blobId, new Blob([evolved], { type: source.mimeType }));
  return CandidateSchema.parse({ id: "evolved", name: "Current Candidate", change: "真实改进", artifactSnapshots: [{ id: "snapshot", sourceArtifactId: source.id, name: "evolved.html", mimeType: source.mimeType, content: evolved, contentHash: sha256, createdAt: source.createdAt, frozenArtifact: { sourceArtifactId: source.id, snapshotHash: sha256, blobId, name: "evolved.html", mimeType: source.mimeType, sha256, size: Buffer.byteLength(evolved), verifiedAt: source.createdAt, checks: [], limitations: [] } }] });
}
beforeEach(() => {
  vi.stubEnv("EVOLUTION_TARGET_RUN_URL", ""); vi.stubEnv("EVOLVE_TARGET_RUN_URL", "");
  blobs.clear(); run.mockReset(); visual.mockReset();
  visual.mockImplementation(async (_project: EvolveProject, _cases: unknown, runs: unknown) => runs);
  run.mockImplementation(async (args: { expectedSha256: string; testCases: Array<{ id: string }> }) => ({ artifactHash: args.expectedSha256, scriptsRun: [], results: args.testCases.map((testCase) => ({ testCaseId: testCase.id, output: "actual browser assertions", latencyMs: 1, cost: 0, artifactHash: args.expectedSha256, verificationStatus: "verified", trace: [] })) }));
});
describe("server standalone HTML browser composition", () => {
  it("wires Baseline to the original stored bytes without requiring a Target Proxy", async () => {
    const project = fixture();
    const result = await executeServerBaselineExternal(project, [testCase]);
    expect(result[0]!.verificationStatus).toBe("verified");
    expect(new TextDecoder().decode(run.mock.calls[0]![0].html)).toBe(original);
    expect(result[0]!.artifactHash).toBe(await serverArtifactSha256(new TextEncoder().encode(original)));
    expect(visual).toHaveBeenCalledOnce();
  });
  it("runs the renamed frozen Candidate instead of stale parsed text or original Source", async () => {
    const project = fixture();
    const current = await candidate(project);
    const result = await runServerHtmlArtifactBatch(project, [testCase], current);
    expect(result[0]!.verificationStatus).toBe("verified");
    expect(new TextDecoder().decode(run.mock.calls[0]![0].html)).toBe(evolved);
    expect(result[0]!.artifactHash).toBe(current.artifactSnapshots[0]!.frozenArtifact!.sha256);
  });
  it.each(["missing-original", "explicit-missing-ref", "missing-candidate", "tampered-candidate", "untrusted-champion"])("blocks %s without Source fallback", async (kind) => {
    const project = fixture();
    const current = kind.includes("candidate") ? await candidate(project) : undefined;
    if (kind === "missing-original") blobs.clear();
    if (kind === "explicit-missing-ref") project.sourceArtifacts[0]!.storageRef = "missing-explicit-binding";
    if (kind === "missing-candidate") blobs.delete(current!.artifactSnapshots[0]!.frozenArtifact!.blobId);
    if (kind === "tampered-candidate") current!.artifactSnapshots[0]!.frozenArtifact!.sha256 = "a".repeat(64);
    if (kind === "untrusted-champion") project.searchChampion = { candidate: await candidate(project) } as NonNullable<EvolveProject["searchChampion"]>;
    const result = await runServerHtmlArtifactBatch(project, [testCase], current);
    expect(result[0]!.verificationStatus).toBe("unverified");
    expect(run).not.toHaveBeenCalled();
  });
  it("does not apply standalone HTML fallback to live HTTP targets", () => {
    const project = fixture();
    expect(serverHtmlArtifactTargetEnabled(project)).toBe(true);
    project.targetConnection.adapter = "http";
    expect(serverHtmlArtifactTargetEnabled(project)).toBe(false);
  });
  it("keeps each test on its uniquely scoped HTML target and blocks ambiguous tests", async () => {
    const project = fixture();
    project.sourceArtifacts.push({ ...project.sourceArtifacts[0]!, id: "second", name: "second.html" });
    blobs.set("second", new Blob([original], { type: "text/html" }));
    project.acceptanceRubric.push({ ...project.acceptanceRubric[0]!, id: "SECOND", artifactIds: ["second"] });
    const second = { ...testCase, id: "H2", criterionIds: ["SECOND"] };
    const ambiguous = { ...testCase, id: "H3", criterionIds: [] };
    const result = await runServerHtmlArtifactBatch(project, [testCase, second, ambiguous]);
    expect(result.map((run) => run.verificationStatus)).toEqual(["verified", "verified", "unverified"]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map((call) => call[0].testCases.map((testCase: { id: string }) => testCase.id))).toEqual([["H1"], ["H2"]]);
  });
  it.each(["missing", "duplicate", "wrong-hash"])("keeps %s runtime evidence unverified", async (kind) => {
    run.mockImplementationOnce(async (args: { expectedSha256: string }) => {
      const row = { testCaseId: "H1", output: "runtime", latencyMs: 1, cost: 0, artifactHash: args.expectedSha256, verificationStatus: "verified", trace: [] };
      return { artifactHash: kind === "wrong-hash" ? "a".repeat(64) : args.expectedSha256, scriptsRun: [], results: kind === "missing" ? [] : kind === "duplicate" ? [row, row] : [row] };
    });
    const result = await runServerHtmlArtifactBatch(fixture(), [testCase]);
    expect(result[0]!.verificationStatus).toBe("unverified");
  });
});


it("runs stored HTML from a historical runner-gateway connection when the server proxy is unconfigured",async()=>{
  const project=fixture();
  project.targetConnection={adapter:"http",status:"connected",connectionId:"runner-gateway",label:"Server Target Proxy"};
  const result=await executeServerBaselineExternal(project,[testCase]);
  expect(result[0]?.verificationStatus).toBe("verified");
  expect(new TextDecoder().decode(run.mock.calls[0]![0].html)).toBe(original);
  expect(project.targetConnection.adapter).toBe("http");
});
it("does not change a configured proxy or a nonhistorical HTTP connection",()=>{
  const project=fixture();project.targetConnection={adapter:"http",status:"connected",connectionId:"runner-gateway",label:"Proxy"};
  expect(serverHtmlArtifactTargetEnabled(project,{httpRunConfigured:false})).toBe(true);
  expect(serverHtmlArtifactTargetEnabled(project,{httpRunConfigured:true})).toBe(false);
  project.targetConnection.connectionId="customer-live-api";
  expect(serverHtmlArtifactTargetEnabled(project,{httpRunConfigured:false})).toBe(false);
  project.targetConnection.connectionId="runner-gateway";project.targetConnection.status="not-configured";
  expect(serverHtmlArtifactTargetEnabled(project,{httpRunConfigured:false})).toBe(false);
  project.targetConnection.status="connected";project.sourceArtifacts[0]!.extension="zip";
  expect(serverHtmlArtifactTargetEnabled(project,{httpRunConfigured:false})).toBe(false);
});
