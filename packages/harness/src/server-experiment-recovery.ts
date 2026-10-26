import type { Candidate, EvolveProject, ExperimentCandidateCheckpoint, TargetRunResult } from "@evolution/contracts";
import { ExperimentCandidateCheckpointSchema } from "@evolution/contracts";
import { LIVE_TARGET_OBSERVATION_MAX_AGE_MS } from "@evolution/core";
import type { ServerExperimentExecutionPorts } from "./server-experiment-runner";
import {serverHtmlNativeRunsMatchOriginal} from "./server-html-native-runs";

export type ServerExperimentRecoveryPorts = Pick<ServerExperimentExecutionPorts, "verifyFrozenArtifact"> & {
  /** Cryptographic digest supplied by composition; no provider or browser dependency in Harness. */
  fingerprint?(canonicalWire: string): Promise<string>;
  readExecutionArtifactFingerprint?(args: { project: EvolveProject; candidate: Candidate }): Promise<string | undefined>;
  scoringRouteFingerprint?: string;
  executionRuntimeFingerprint?: string;
};
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, ordered(record[key])]));
}
async function digest(ports: ServerExperimentRecoveryPorts, value: unknown) {
  try {
    const wire = JSON.stringify(ordered(JSON.parse(JSON.stringify(value))));
    const result = await ports.fingerprint?.(wire);
    return result && /^[0-9a-f]{64}$/.test(result) ? result : undefined;
  } catch { return undefined; }
}
export class ServerExperimentFrozenRecoveryError extends Error {}
function buildInputs(project: EvolveProject, candidate: Candidate) {
  const { id, name, title, change, hypothesis, patches, risks, designRationale } = candidate;
  return { version: "server-experiment-build-input-v1", missionId: project.id,
    round: project.campaign.checkpoint?.round, candidate: { id, name, title, change, hypothesis, patches, risks, designRationale },
    name: project.name, objectType: project.objectType, versionLabel: project.version,
    goal: project.goal, command: project.evolutionCommand, protectedItems: project.protectedItems,
    editableItems: project.editableItems, rubric: project.acceptanceRubric, sources: project.sourceArtifacts,
    parent: project.searchChampion, selectedProblemId: project.selectedProblemId, diagnosis: project.diagnosis };
}
export function hasCompleteServerExperimentFrozenSet(project: EvolveProject, candidate: Candidate) {
  const targets = project.sourceArtifacts.filter(s => s.role === "target");
  return candidate.artifactBuildStatus === "ready" && targets.length > 0
    && new Set(targets.map(t => t.id)).size === targets.length
    && candidate.artifactSnapshots.length === targets.length
    && new Set(candidate.artifactSnapshots.map(s => s.sourceArtifactId)).size === targets.length
    && candidate.artifactSnapshots.every(s => s.frozenArtifact?.sourceArtifactId === s.sourceArtifactId
      && targets.some(t => t.id === s.sourceArtifactId));
}
function pending(project: EvolveProject, round: number) {
  return project.targetConnection.adapter === "artifact" && project.experimentRun.status === "failed"
    && project.experimentRun.id === "experiment-r" + round + "-server"
    && /^\[server-campaign-experiment-(?:judge|build)-pending\]/.test(project.experimentRun.summary ?? "");
}

/** Newly frozen repair construction is not a Visible winner. It must be measured first. */
export function serverFrozenRepairCandidate(project: EvolveProject, round = project.campaign.currentRound + 1) {
  if (project.targetConnection.adapter !== "artifact" || project.campaign.checkpoint?.round !== round
    || project.campaign.checkpoint.completedPhase !== "plan" || project.artifactAcceptance.status !== "repairing"
    || project.selectedCandidateIds.length !== 1
    || !(project.experimentRun.status === "idle" && project.experimentRun.summary?.startsWith("[server-campaign-artifact-repair-visible-pending]")
      || pending(project, round))) return undefined;
  const id = project.selectedCandidateIds[0];
  const candidates = project.candidates.filter(candidate => candidate.id === id);
  if (candidates.length !== 1 || project.artifactAcceptance.candidateId !== id
    || project.validationRun.status !== "idle" || project.validationRun.candidateId !== id
    || project.validationRun.id !== "validation-repair-pending-" + id
    || !hasCompleteServerExperimentFrozenSet(project, candidates[0]!)) return undefined;
  return candidates[0];
}
/** Restore only the checkpoint-bound frozen construction; expired measurements do not change these bytes. */
export async function restoreServerExperimentCandidate(project: EvolveProject, candidate: Candidate, round: number, ports: ServerExperimentRecoveryPorts) {
  const freshRepair = serverFrozenRepairCandidate(project, round)?.id === candidate.id
    && !project.experimentRun.executionCheckpoints?.some(checkpoint => checkpoint.candidateId === candidate.id);
  if (freshRepair) {
    if (!ports.verifyFrozenArtifact) throw new ServerExperimentFrozenRecoveryError("Repair 冻结文件缺少真实回读能力，不能重新生成替代文件。");
    for (const snapshot of candidate.artifactSnapshots) {
      let verified = false;
      try { verified = await ports.verifyFrozenArtifact(snapshot); } catch { /* Preserve the frozen repair on unavailable storage. */ }
      if (!verified) throw new ServerExperimentFrozenRecoveryError("Repair 冻结文件回读不可用或身份不一致，禁止重新生成替代文件。");
    }
    return candidate;
  }
  if (!pending(project, round) || !ports.verifyFrozenArtifact) return undefined;
  const matches = project.experimentRun.executionCheckpoints?.filter(c => c.candidateId === candidate.id) ?? [];
  if (matches.length !== 1) return undefined;
  const parsed = ExperimentCandidateCheckpointSchema.safeParse(matches[0]);
  if (!parsed.success || parsed.data.buildInputFingerprint !== await digest(ports, buildInputs(project, candidate))) return undefined;
  if (!hasCompleteServerExperimentFrozenSet(project, candidate) || parsed.data.artifactFingerprint !== await digest(ports, candidate.artifactSnapshots)) {
    throw new ServerExperimentFrozenRecoveryError("已执行 Candidate 的冻结记录发生变化；不能在评审重试中重新生成另一份文件。");
  }
  for (const snapshot of candidate.artifactSnapshots) {
    let verified = false;
    try { verified = await ports.verifyFrozenArtifact(snapshot); } catch { /* Keep construction across temporary read failures. */ }
    if (!verified) throw new ServerExperimentFrozenRecoveryError("已执行 Candidate 的冻结文件暂不可用或身份不一致；恢复后重试，禁止重新生成替代文件。");
  }
  return candidate;
}
export async function serverExperimentBuildCheckpoint(project: EvolveProject, candidate: Candidate, ports: ServerExperimentRecoveryPorts): Promise<ExperimentCandidateCheckpoint | undefined> {
  if (project.targetConnection.adapter !== "artifact" || !hasCompleteServerExperimentFrozenSet(project, candidate)) return undefined;
  const buildInputFingerprint = await digest(ports, buildInputs(project, candidate));
  const artifactFingerprint = await digest(ports, candidate.artifactSnapshots);
  return buildInputFingerprint && artifactFingerprint ? { candidateId: candidate.id, buildInputFingerprint, artifactFingerprint } : undefined;
}
async function executionBinding(project: EvolveProject, checkpoint: ExperimentCandidateCheckpoint, ports: ServerExperimentRecoveryPorts) {
  return digest(ports, { version: "server-experiment-execution-input-v1", buildInput: checkpoint.buildInputFingerprint,
    candidateArtifacts: checkpoint.artifactFingerprint, suite: project.evalSuite, baseline: project.baselineRun,
    rubric: project.acceptanceRubric, metrics: project.metrics, target: project.targetConnection,
    profile: project.aiProfile, policy: project.experimentPolicy,
    scoringRoute: ports.scoringRouteFingerprint, runtime: ports.executionRuntimeFingerprint });
}
async function physicalBinding(project: EvolveProject, candidate: Candidate, ports: ServerExperimentRecoveryPorts) {
  try {
    const result = await ports.readExecutionArtifactFingerprint?.({ project, candidate });
    return result && /^[0-9a-f]{64}$/.test(result) ? result : undefined;
  } catch { return undefined; }
}
export async function serverExperimentObservationBinding(project: EvolveProject, candidate: Candidate, checkpoint: ExperimentCandidateCheckpoint | undefined, ports: ServerExperimentRecoveryPorts) {
  if (!checkpoint) return undefined;
  return { inputFingerprint: await executionBinding(project, checkpoint, ports), artifactFingerprint: await physicalBinding(project, candidate, ports) };
}
/** Preserve raw answer sheets even when they cannot qualify for reuse. */
export async function serverExperimentExecutionCheckpoint(project: EvolveProject, candidate: Candidate, checkpoint: ExperimentCandidateCheckpoint | undefined, runs: TargetRunResult[], observedAt: number, ports: ServerExperimentRecoveryPorts, observedBinding?: Awaited<ReturnType<typeof serverExperimentObservationBinding>>) {
  if (!checkpoint) return undefined;
  const inputFingerprint = await executionBinding(project, checkpoint, ports);
  const artifactFingerprint = await physicalBinding(project, candidate, ports);
  const evidenceFingerprint = await digest(ports, { runs, observedAt });
  if (!inputFingerprint || !evidenceFingerprint || !Number.isFinite(observedAt) || observedAt <= 0) return checkpoint;
  const stablePhysicalBinding = inputFingerprint === observedBinding?.inputFingerprint
    && artifactFingerprint === observedBinding?.artifactFingerprint ? artifactFingerprint : undefined;
  return { ...checkpoint, execution: { inputFingerprint, artifactFingerprint: stablePhysicalBinding, evidenceFingerprint, observedAt, runs } };
}
/** Reuse complete, recent observations only; judging always remains independent and runs again. */
export async function recoverableServerExperimentRuns(project: EvolveProject, candidate: Candidate, round: number, checkpoint: ExperimentCandidateCheckpoint | undefined, nowMs: number, ports: ServerExperimentRecoveryPorts): Promise<TargetRunResult[] | undefined> {
  const execution = checkpoint?.execution;
  if (!pending(project, round) || !checkpoint || !execution || !Number.isFinite(nowMs)
    || nowMs < execution.observedAt || nowMs - execution.observedAt >= LIVE_TARGET_OBSERVATION_MAX_AGE_MS
    || !execution.artifactFingerprint || execution.inputFingerprint !== await executionBinding(project, checkpoint, ports)
    || execution.artifactFingerprint !== await physicalBinding(project, candidate, ports)
    || execution.evidenceFingerprint !== await digest(ports, { runs: execution.runs, observedAt: execution.observedAt })
    || project.evalSuite.length === 0 || execution.runs.length !== project.evalSuite.length
    || !serverHtmlNativeRunsMatchOriginal(project,execution.runs,candidate)
    || new Set(project.evalSuite.map(t => t.id)).size !== project.evalSuite.length) return undefined;
  return project.evalSuite.every((t, i) => {
    const run = execution.runs[i];
    return run?.testCaseId === t.id && !run.error && Boolean(run.output.trim())
      && (run.verificationStatus === "verified" || run.verificationStatus === "partial");
  }) ? execution.runs : undefined;
}
