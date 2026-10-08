// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ExperimentRunSchema, type Candidate, type EvaluateAiResult } from "@evolution/contracts";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { runServerExperiment } from "./server-experiment";

const digest = async (value: string) => createHash("sha256").update(value).digest("hex");
function setup(count = 1) {
  const x = experimentRecoveryFixture(count);
  const project = x.project;
  const test = project.evalSuite[0]!;
  const frozen = new Map([x.current, x.prior].map(c => [c.id, c]));
  const buildCandidate = vi.fn(async ({ candidate }: { candidate: Candidate }) => ({ ...candidate, ...frozen.get(candidate.id)!, status: "draft" as const }));
  const executeExternalBatch = vi.fn(async () => [{ testCaseId: test.id, output: "observed improved exact file", artifactHash: x.current.artifactSnapshots[0]!.frozenArtifact!.sha256, latencyMs: 1, cost: 0, verificationStatus: "verified" as "verified" | "partial", trace: [] }]);
  const judge = vi.fn(async (): Promise<EvaluateAiResult> => ({ accuracy: 92, evidence: 92, riskCoverage: 92, completeness: 92, safety: "PASS", notes: [], failures: [], cases: [{ testCaseId: test.id, accuracy: 92, evidence: 92, completeness: 92, reason: "improved" }], criteria: [{ criterionId: "CONTENT", score: 92, pass: true, evidence: ["observed improved exact file"], gaps: [], testCaseIds: [test.id] }] }));
  const ports = { buildCandidate, executeExternalBatch, executeSemanticBatch: vi.fn(async () => ({ results: [] })), judge, verifyFrozenArtifact: vi.fn(async () => true), fingerprint: digest, readExecutionArtifactFingerprint: vi.fn(async (): Promise<string | undefined> => "a".repeat(64)), scoringRouteFingerprint: "b".repeat(64), executionRuntimeFingerprint: "runtime-v1" };
  return { x, project, ports };
}
describe("server Experiment recovery after independent assessment outage", () => {
  it("retains actual failed-judge observations and resumes the same frozen Candidate", async () => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("model timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    expect(first.reason).toContain("experiment-judge-pending");
    first.project.experimentRun = ExperimentRunSchema.parse(JSON.parse(JSON.stringify(first.experiment)));
    expect(first.experiment.executionCheckpoints?.[0]?.execution?.runs[0]?.output).toBe("observed improved exact file");
    const firstCandidate = structuredClone(first.project.candidates[0]);
    const second = await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(second.readyForHoldout).toBe(true);
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(1);
    expect(ports.judge).toHaveBeenCalledTimes(2);
    expect(second.project.candidates[0]!.artifactSnapshots).toEqual(firstCandidate!.artifactSnapshots);
    expect(second.experiment.candidateResults[0]!.runs[0]!.output).toBe("observed improved exact file");
  });
  it("does not rebuild already frozen later Candidates when the first Judge fails", async () => {
    const { project, ports } = setup(2);
    ports.judge.mockRejectedValueOnce(new Error("model timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    const second = await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(second.experiment.candidateResults).toHaveLength(2);
    expect(ports.buildCandidate).toHaveBeenCalledTimes(2);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it("rejects a Builder returning a different Candidate ID", async () => {
    const { project, ports, x } = setup();
    ports.buildCandidate.mockResolvedValue({ ...x.current, id: "foreign", status: "draft" });
    const result = await runServerExperiment(project, ports, { now: () => at });
    expect(result.control).toBe("stop");
    expect(result.readyForHoldout).toBe(false);
    expect(ports.executeExternalBatch).not.toHaveBeenCalled();
  });
  it.each(["2026-10-09T02:10:00.000Z", "2026-10-09T01:59:59.000Z"])("reruns observations at an invalid age (%s), preserving frozen construction", async (now) => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    await runServerExperiment(first.project, ports, { now: () => now });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it("does not extend the observation window through repeated Judge failures", async () => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValue(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    const warm = await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:09:00.000Z" });
    expect(warm.experiment.executionCheckpoints?.[0]?.execution?.observedAt).toBe(Date.parse(at));
    await runServerExperiment(warm.project, ports, { now: () => "2026-10-09T02:10:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it.each(["suite", "baseline", "profile", "route", "runtime", "physical"])("reruns observations after %s changes without regenerating frozen files", async (change) => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    if (change === "suite") first.project.evalSuite[0]!.input += " changed";
    if (change === "baseline") first.project.baselineRun.runs[0]!.output += " changed";
    if (change === "profile") first.project.aiProfile = { ...first.project.aiProfile, judge: { connectionId: "other", model: "different", label: "test" } };
    if (change === "route") ports.scoringRouteFingerprint = "c".repeat(64);
    if (change === "runtime") ports.executionRuntimeFingerprint = "runtime-v2";
    if (change === "physical") ports.readExecutionArtifactFingerprint.mockResolvedValue("c".repeat(64));
    await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it.each(["command", "goal", "patch", "source", "rubric"])("invalidates construction recovery after %s input changes", async (change) => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    if (change === "command") first.project.evolutionCommand += " changed";
    if (change === "goal") first.project.goal += " changed";
    if (change === "patch") first.project.candidates[0]!.change += " changed";
    if (change === "source") first.project.sourceArtifacts[0]!.textContent += " changed";
    if (change === "rubric") first.project.acceptanceRubric[0]!.requirement += " changed";
    await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(2);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it.each(["content", "blob", "size", "snapshot", "missing"])("stops after frozen %s drift without generating replacement bytes", async (change) => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    const snapshot = first.project.candidates[0]!.artifactSnapshots[0]!;
    if (change === "content") snapshot.content += "changed";
    if (change === "blob") snapshot.frozenArtifact!.blobId += "changed";
    if (change === "size") snapshot.frozenArtifact!.size += 1;
    if (change === "snapshot") snapshot.id += "changed";
    if (change === "missing") ports.verifyFrozenArtifact.mockResolvedValue(false);
    const second = await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(second.control).toBe("stop");
    expect(second.readyForHoldout).toBe(false);
    expect(second.project.candidates[0]!.artifactBuildStatus).toBe("ready");
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(1);
  });
  it("retries a temporary frozen-byte read failure without losing the checkpoint", async () => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    ports.verifyFrozenArtifact.mockRejectedValueOnce(new Error("storage timeout"));
    const blocked = await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(blocked.control).toBe("stop");
    const restored = await runServerExperiment(blocked.project, ports, { now: () => "2026-10-09T02:02:00.000Z" });
    expect(restored.readyForHoldout).toBe(true);
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(1);
  });
  it("retains raw runs with a missing physical binding, but executes them again", async () => {
    const { project, ports } = setup();
    ports.readExecutionArtifactFingerprint.mockResolvedValue(undefined);
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    expect(first.experiment.executionCheckpoints?.[0]?.execution?.runs).toHaveLength(1);
    expect(first.experiment.executionCheckpoints?.[0]?.execution?.artifactFingerprint).toBeUndefined();
    await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it("retains raw runs but disables reuse when physical inputs change during execution", async () => {
    const { project, ports } = setup();
    ports.executeExternalBatch.mockImplementationOnce(async () => {
      ports.readExecutionArtifactFingerprint.mockResolvedValue("c".repeat(64));
      return [{ testCaseId: "V1", output: "observed improved exact file", latencyMs: 1, cost: 0, verificationStatus: "verified", trace: [], artifactHash: "a".repeat(64) }];
    });
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    expect(first.experiment.executionCheckpoints?.[0]?.execution?.artifactFingerprint).toBeUndefined();
    await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it.each(["output", "trace", "timestamp", "missing", "duplicate", "wrong-id", "unverified", "failed", "empty", "error"])("cannot reuse %s answer-sheet drift, even with a rebound checksum", async (change) => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    const execution = first.experiment.executionCheckpoints![0]!.execution!;
    const run = execution.runs[0]!;
    if (change === "output") run.output += "changed";
    if (change === "trace") run.trace.push({ id: "other", stage: "other", summary: "changed", status: "warning" });
    if (change === "timestamp") execution.observedAt += 1;
    if (change === "missing") execution.runs = [];
    if (change === "duplicate") execution.runs.push(structuredClone(run));
    if (change === "wrong-id") run.testCaseId = "foreign";
    if (change === "unverified") run.verificationStatus = "unverified";
    if (change === "failed") run.verificationStatus = "failed";
    if (change === "empty") run.output = " ";
    if (change === "error") run.error = "runner failed";
    if (!["output", "trace", "timestamp"].includes(change)) {
      const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered((v as Record<string, unknown>)[k])])) : v;
      execution.evidenceFingerprint = await digest(JSON.stringify(ordered({ runs: execution.runs, observedAt: execution.observedAt })));
    }
    await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it("preserves partial observations and obtains a new independent assessment", async () => {
    const { project, ports } = setup();
    ports.executeExternalBatch.mockResolvedValue([{ testCaseId: "V1", output: "partial observation", artifactHash: "a".repeat(64), latencyMs: 1, cost: 0, verificationStatus: "partial", trace: [] }]);
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    const second = await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(1);
    expect(ports.judge).toHaveBeenCalledTimes(2);
    expect(second.experiment.candidateResults[0]!.runs[0]!.verificationStatus).toBe("partial");
  });
  it("keeps completed earlier Candidates when a later Judge fails", async () => {
    const { project, ports } = setup(2);
    const originalJudge = ports.judge.getMockImplementation()!;
    ports.judge.mockImplementationOnce(originalJudge).mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    expect(first.experiment.candidateResults).toHaveLength(1);
    const second = await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(second.experiment.candidateResults).toHaveLength(2);
    expect(ports.buildCandidate).toHaveBeenCalledTimes(2);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
    expect(ports.judge).toHaveBeenCalledTimes(4);
  });
  it("reads legacy experiments without treating them as reusable measurements", async () => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    delete first.project.experimentRun.executionCheckpoints;
    first.project.experimentRun = ExperimentRunSchema.parse(first.project.experimentRun);
    await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(2);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });

  it.each(["missing", "duplicate-selection", "duplicate-candidate"])("rejects %s selection before any build or execution", async (kind) => {
    const { project, ports } = setup();
    if (kind === "missing") project.selectedCandidateIds.push("foreign");
    if (kind === "duplicate-selection") project.selectedCandidateIds.push(project.selectedCandidateIds[0]!);
    if (kind === "duplicate-candidate") project.candidates.push(structuredClone(project.candidates[0]!));
    await expect(runServerExperiment(project, ports)).rejects.toThrow("unique, existing");
    expect(ports.buildCandidate).not.toHaveBeenCalled();
    expect(ports.executeExternalBatch).not.toHaveBeenCalled();
  });
  it("blocks a Frozen receipt for a different Target before execution", async () => {
    const { project, ports, x } = setup();
    x.current.artifactSnapshots[0]!.frozenArtifact!.sourceArtifactId = "foreign";
    const result = await runServerExperiment(project, ports, { now: () => at });
    expect(result.control).toBe("stop");
    expect(ports.executeExternalBatch).not.toHaveBeenCalled();
  });
  it("retains warm recovery after JSON object keys are reordered by storage", async () => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    const reordered = (v: unknown): unknown => Array.isArray(v) ? v.map(reordered) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reordered((v as Record<string, unknown>)[k])])) : v;
    const persisted = JSON.parse(JSON.stringify(reordered(first.project))) as typeof project;
    await runServerExperiment(persisted, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(1);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(1);
  });

  it("cannot carry measurements into another round by renaming the Experiment record", async () => {
    const { project, ports } = setup();
    ports.judge.mockRejectedValueOnce(new Error("timeout"));
    const first = await runServerExperiment(project, ports, { now: () => at });
    first.project.campaign.checkpoint!.round = 2;
    first.project.experimentRun.id = "experiment-r2-server";
    await runServerExperiment(first.project, ports, { now: () => "2026-10-09T02:01:00.000Z" });
    expect(ports.buildCandidate).toHaveBeenCalledTimes(2);
    expect(ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });

});
