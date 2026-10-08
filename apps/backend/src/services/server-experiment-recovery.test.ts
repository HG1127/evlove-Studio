// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolveProjectSchema, type Candidate, type EvolveProject, type EvaluateAiResult, type TestCase } from "@evolution/contracts";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { runServerMissionExperiment } from "./server-experiment";
const m = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), get: vi.fn(), put: vi.fn(), ai: vi.fn(), browser: vi.fn() }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: m.get, put: m.put }) }));
vi.mock("./ai-gateway", () => ({ runServerAi: m.ai, serverAiScoringRouteFingerprint: () => "b".repeat(64) }));
vi.mock("./server-html-artifact-execution", () => ({ serverHtmlArtifactTargetEnabled: () => true, runServerHtmlArtifactBatch: m.browser }));
vi.mock("./connector-target-source", () => ({ serverConnectorTargetEnabled: () => false }));
vi.mock("./server-http-target-execution", () => ({ serverHttpTargetEnabled: () => false }));
function mission() {
  const x = experimentRecoveryFixture();
  for (const [id, blob] of x.blobs) m.blobs.set(id, blob);
  x.project.candidates[0]!.patches = [{ id: "edit", component: "code", operation: "update", target: "original input", artifactId: "source", content: "improved actual content", rationale: "complete exact edit" }];
  return x.project;
}
const assessment: EvaluateAiResult = { accuracy: 92, evidence: 92, riskCoverage: 92, completeness: 92, safety: "PASS", notes: [], failures: [], cases: [{ testCaseId: "V1", accuracy: 92, evidence: 92, completeness: 92, reason: "improved" }], criteria: [{ criterionId: "CONTENT", score: 92, pass: true, evidence: ["improved actual content"], gaps: [], testCaseIds: ["V1"] }] };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(at));
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "experiment-recovery-version-1");
  m.blobs.clear();
  m.get.mockReset().mockImplementation(async (id: string) => m.blobs.get(id));
  m.put.mockReset().mockImplementation(async (id: string, blob: Blob) => { m.blobs.set(id, blob); });
  m.ai.mockReset().mockRejectedValueOnce(new Error("independent model timeout")).mockResolvedValue(assessment);
  m.browser.mockReset().mockImplementation(async (_project: EvolveProject, tests: TestCase[], candidate: Candidate) => tests.map(test => ({ testCaseId: test.id, output: "improved actual content", artifactHash: candidate.artifactSnapshots[0]!.frozenArtifact!.sha256, verificationStatus: "verified", cost: 0, latencyMs: 1, trace: [] })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
function saved(project: EvolveProject) { return EvolveProjectSchema.parse(JSON.parse(JSON.stringify(project))); }
describe("production Experiment composition recovery with real exact materialization", () => {
  it("reopens identical physical files after stored JSON recovery and only retries the independent model", async () => {
    const first = await runServerMissionExperiment(mission());
    expect(first.reason).toContain("experiment-judge-pending");
    const frozen = first.project.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!;
    const original = await m.blobs.get("source")!.text();
    const firstBytes = new Uint8Array(await m.blobs.get(frozen.blobId)!.arrayBuffer());
    expect(createHash("sha256").update(firstBytes).digest("hex")).toBe(frozen.sha256);
    expect(new TextDecoder().decode(firstBytes)).toBe(original.replace("original input", "improved actual content"));
    vi.setSystemTime(new Date("2026-10-09T02:01:00.000Z"));
    const resumed = await runServerMissionExperiment(saved(first.project));
    expect(resumed.readyForHoldout).toBe(true);
    expect(resumed.project.candidates[0]!.artifactSnapshots).toEqual(first.project.candidates[0]!.artifactSnapshots);
    expect(await m.blobs.get(frozen.blobId)!.text()).toBe(new TextDecoder().decode(firstBytes));
    expect(await m.blobs.get("source")!.text()).toBe(original);
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.browser).toHaveBeenCalledTimes(1);
    expect(m.ai.mock.calls.map(c => c[0])).toEqual(["evaluate", "evaluate"]);
  });
  it("retains exact files through an actual Artifact Store read failure", async () => {
    const first = await runServerMissionExperiment(mission());
    vi.setSystemTime(new Date("2026-10-09T02:01:00.000Z"));
    m.get.mockRejectedValueOnce(new Error("storage timeout"));
    const waiting = await runServerMissionExperiment(saved(first.project));
    expect(waiting.control).toBe("stop");
    expect(waiting.project.candidates[0]!.artifactBuildStatus).toBe("ready");
    expect(m.put).toHaveBeenCalledTimes(1);
    const restored = await runServerMissionExperiment(saved(waiting.project));
    expect(restored.readyForHoldout).toBe(true);
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.browser).toHaveBeenCalledTimes(1);
  });
  it("reruns observations after a deployment change without regenerating the file", async () => {
    const first = await runServerMissionExperiment(mission());
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "experiment-recovery-version-2");
    vi.setSystemTime(new Date("2026-10-09T02:01:00.000Z"));
    const resumed = await runServerMissionExperiment(saved(first.project));
    expect(resumed.readyForHoldout).toBe(true);
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.browser).toHaveBeenCalledTimes(2);
    expect(m.ai.mock.calls.map(c => c[0])).toEqual(["evaluate", "evaluate"]);
  });
});
