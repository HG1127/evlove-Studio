import { z } from "zod";
import { EvolveProjectSchema, type Candidate, type EvolveProject, type ExperimentCandidateCheckpoint, type ExperimentRun } from "@evolution/contracts";
import { HTML_PROTECTION_SETTLEMENT_POLICY, LIVE_TARGET_OBSERVATION_MAX_AGE_MS } from "@evolution/core";
import { hasCompleteServerExperimentFrozenSet, serverExperimentBuildCheckpoint, serverExperimentObservationBinding,
  ServerExperimentFrozenRecoveryError, type ServerExperimentRecoveryPorts } from "./server-experiment-recovery";

const Schema = z.object({
  schemaVersion: z.literal("server-experiment-continuation-v1"),
  generation: z.string().regex(/^[0-9a-f]{64}$/),
  operation: z.enum(["build", "execute", "judge"]),
  buildIndex: z.number().int().nonnegative(),
  candidateIndex: z.number().int().nonnegative(),
  builtIds: z.array(z.string().min(1)),
  recoveryFailureIds: z.array(z.string().min(1)),
}).strict();
/** Private SDK step output only. Never restore this authority from Mission JSON, events or public input. */
export type ServerExperimentContinuation = z.infer<typeof Schema>;
export type ServerExperimentCursor = Omit<ServerExperimentContinuation, "schemaVersion" | "generation">;
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
}
async function generation(project: EvolveProject, ports: ServerExperimentRecoveryPorts) {
  const value = { project: EvolveProjectSchema.parse(project), route: ports.scoringRouteFingerprint,
    runtime: ports.executionRuntimeFingerprint, policy: HTML_PROTECTION_SETTLEMENT_POLICY };
  const hash = await ports.fingerprint?.(JSON.stringify(ordered(JSON.parse(JSON.stringify(value)))));
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new Error("Durable Experiment requires a cryptographic generation fingerprint");
  return hash;
}
export async function createServerExperimentContinuation(project: EvolveProject, cursor: ServerExperimentCursor, ports: ServerExperimentRecoveryPorts): Promise<ServerExperimentContinuation> {
  return Schema.parse({ ...cursor, schemaVersion: "server-experiment-continuation-v1", generation: await generation(project, ports) });
}
export async function restoreServerExperimentContinuation(project: EvolveProject, raw: unknown, ports: ServerExperimentRecoveryPorts) {
  const context = Schema.parse(raw);
  if (context.generation !== await generation(project, ports) || project.experimentRun.status !== "running"
    || context.buildIndex > project.selectedCandidateIds.length || context.candidateIndex > context.builtIds.length
    || new Set(context.builtIds).size !== context.builtIds.length
    || context.builtIds.some(id => !project.selectedCandidateIds.slice(0, context.buildIndex).includes(id))
    || project.experimentRun.id !== "experiment-r" + project.campaign.checkpoint?.round + "-server"
    || (context.operation === "build"
      ? context.buildIndex >= project.selectedCandidateIds.length || context.candidateIndex !== 0 || project.experimentRun.candidateResults.length !== 0
      : context.buildIndex !== project.selectedCandidateIds.length || context.candidateIndex >= context.builtIds.length
        || project.experimentRun.candidateResults.length !== context.candidateIndex
        || project.experimentRun.candidateResults.some((r, i) => r.candidateId !== context.builtIds[i]))) {
    throw new Error("Durable Experiment generation changed; preserving frozen files without executing stale work");
  }
  const built: Candidate[] = [];
  for (const id of context.builtIds) {
    const candidates = project.candidates.filter(c => c.id === id), checkpoints = project.experimentRun.executionCheckpoints?.filter(c => c.candidateId === id) ?? [];
    const candidate = candidates[0], checkpoint = checkpoints[0];
    const actual = candidate && await serverExperimentBuildCheckpoint(project, candidate, ports);
    if (candidates.length !== 1 || checkpoints.length !== 1 || !actual || !checkpoint
      || !hasCompleteServerExperimentFrozenSet(project, candidate!) || actual.buildInputFingerprint !== checkpoint.buildInputFingerprint
      || actual.artifactFingerprint !== checkpoint.artifactFingerprint || !ports.verifyFrozenArtifact) {
      throw new ServerExperimentFrozenRecoveryError("Durable Experiment frozen construction changed; replacement generation is forbidden");
    }
    for (const snapshot of candidate!.artifactSnapshots) {
      if (!await ports.verifyFrozenArtifact(snapshot)) throw new ServerExperimentFrozenRecoveryError("Durable Experiment frozen bytes are unavailable or changed");
    }
    built.push(candidate!);
  }
  if (context.generation !== await generation(project, ports)) throw new Error("Durable Experiment generation changed during frozen verification");
  return { context, built };
}
/** Fresh same-Run answer sheets may contain honest UNVERIFIED results. They never become cache or Gate F authority. */
export async function continuedServerExperimentRuns(project: EvolveProject, candidate: Candidate,
  checkpoint: ExperimentCandidateCheckpoint | undefined, now: () => number, ports: ServerExperimentRecoveryPorts) {
  const execution = checkpoint?.execution, nowMs = now();
  if (!execution || !Number.isFinite(nowMs) || nowMs < execution.observedAt
    || nowMs - execution.observedAt >= LIVE_TARGET_OBSERVATION_MAX_AGE_MS) return undefined;
  const binding = await serverExperimentObservationBinding(project, candidate, checkpoint, ports);
  if (execution.inputFingerprint !== binding?.inputFingerprint || execution.artifactFingerprint !== binding?.artifactFingerprint) return undefined;
  const finalMs = now();
  return Number.isFinite(finalMs) && finalMs >= execution.observedAt && finalMs - execution.observedAt < LIVE_TARGET_OBSERVATION_MAX_AGE_MS ? execution.runs : undefined;
}
export function runningServerExperimentProject(input: EvolveProject, built: Candidate[], experiment: ExperimentRun, at: string): EvolveProject {
  const byId = new Map(built.map(c => [c.id, c]));
  return { ...input, candidates: input.candidates.map(c => byId.get(c.id) ?? c), experimentRun: experiment,
    campaign: { ...input.campaign, status: "running", stopReason: undefined, serverRecoveryWait: undefined },
    stage: "experiment", updatedAt: at };
}
