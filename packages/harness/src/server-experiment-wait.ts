import { ExperimentCandidateCheckpointSchema, type EvolveProject } from "@evolution/contracts";
import { campaignPreflightStopReason, goalReadiness } from "@evolution/core";
import { hasCompleteServerExperimentFrozenSet } from "./server-experiment-recovery";

/** Structural journal recognition; actual input digests and frozen bytes are verified at execution. */
export function serverExperimentRecoveryCheckpoint(project: EvolveProject) {
  const { campaign, experimentRun: experiment } = project;
  const round = campaign.currentRound + 1;
  const reason = experiment.summary;
  if (project.targetConnection.adapter !== "artifact"
    || project.stage !== "experiment" || !/^\[server-campaign-experiment-(?:judge|build)-pending\]/.test(reason ?? "")
    || experiment.status !== "failed"
    || experiment.id !== "experiment-r" + round + "-server"
    || campaign.checkpoint?.round !== round || campaign.checkpoint.completedPhase !== "plan") return undefined;
  const selected = project.selectedCandidateIds;
  if (!selected.length || new Set(selected).size !== selected.length
    || selected.some(id => project.candidates.filter(c => c.id === id).length !== 1)) return undefined;
  const checkpoints = experiment.executionCheckpoints ?? [];
  if (!checkpoints.length || new Set(checkpoints.map(c => c.candidateId)).size !== checkpoints.length
    || checkpoints.some(c => !selected.includes(c.candidateId) || !ExperimentCandidateCheckpointSchema.safeParse(c).success)
    || !checkpoints.some(c => c.execution?.runs.length)) return undefined;
  if (reason?.startsWith("[server-campaign-experiment-build-pending]")
    && (checkpoints.some(c => !hasCompleteServerExperimentFrozenSet(project, project.candidates.find(x => x.id === c.candidateId)!))
      || !checkpoints.some(c => c.execution?.runs.length && experiment.buildFailures?.some(f => f.candidateId === c.candidateId)))) return undefined;
  return reason;
}

/** Only an explicit retry can reopen its matching pause; all readiness and human gates still apply. */
export function serverExperimentRecoveryWait(project: EvolveProject) {
  const reason = serverExperimentRecoveryCheckpoint(project);
  if (!reason || project.campaign.status !== "paused" || project.campaign.stopReason !== reason
    || campaignPreflightStopReason(project) || !goalReadiness(project).ready) return undefined;
  // Recovery cannot resolve unrelated approval, evidence, input or safety requests.
  const pending = (project.attentionRequests ?? []).filter(r => r.status === "pending" && r.blocking);
  if (pending.some(r => r.type !== "capability" || r.reason !== reason || r.stage !== project.stage)) return undefined;
  return reason;
}

/** Replan after a fresh model probe; preserve checkpoints, observations and all budget windows. */
export function recoverServerExperimentRecoveryWait(project: EvolveProject, at: string): EvolveProject {
  const reason = serverExperimentRecoveryWait(project);
  if (!reason) return project;
  return {
    ...project,
    campaign: { ...project.campaign, status: "idle", stopReason: undefined },
    attentionRequests: project.attentionRequests?.map(r => r.status === "pending" && r.type === "capability"
      && r.reason === reason && r.stage === project.stage
      ? { ...r, status: "resolved", resolvedAt: at, resolution: "Server AI Runtime Probe 已恢复；重新核验保留的 Experiment 文件并继续独立评审。" } : r),
    updatedAt: at,
  };
}

/** Compatibility aliases for existing Judge retry clients. */
export const serverExperimentJudgeWait = serverExperimentRecoveryWait;
export const recoverServerExperimentJudgeWait = recoverServerExperimentRecoveryWait;
