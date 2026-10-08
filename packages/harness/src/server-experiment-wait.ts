import { ExperimentCandidateCheckpointSchema, type EvolveProject } from "@evolution/contracts";
import { campaignPreflightStopReason } from "@evolution/core";

/** Recognize only the server-written, current-round frozen Experiment Judge pause. */
export function serverExperimentJudgeWait(project: EvolveProject) {
  const { campaign, experimentRun: experiment } = project;
  const round = campaign.currentRound + 1;
  const reason = campaign.stopReason;
  if (project.targetConnection.adapter !== "artifact" || campaign.status !== "paused"
    || project.stage !== "experiment" || !reason?.startsWith("[server-campaign-experiment-judge-pending]")
    || experiment.summary !== reason || experiment.status !== "failed"
    || experiment.id !== "experiment-r" + round + "-server"
    || campaign.checkpoint?.round !== round || campaign.checkpoint.completedPhase !== "plan"
    || campaignPreflightStopReason(project)) return undefined;
  const selected = project.selectedCandidateIds;
  if (!selected.length || new Set(selected).size !== selected.length
    || selected.some(id => project.candidates.filter(c => c.id === id).length !== 1)) return undefined;
  const checkpoints = experiment.executionCheckpoints ?? [];
  if (!checkpoints.length || new Set(checkpoints.map(c => c.candidateId)).size !== checkpoints.length
    || checkpoints.some(c => !selected.includes(c.candidateId) || !ExperimentCandidateCheckpointSchema.safeParse(c).success)
    || !checkpoints.some(c => c.execution?.runs.length)) return undefined;
  // A model retry cannot resolve unrelated approval, evidence, input or safety requests.
  const pending = (project.attentionRequests ?? []).filter(r => r.status === "pending" && r.blocking);
  if (pending.some(r => r.type !== "capability" || r.reason !== reason || r.stage !== project.stage)) return undefined;
  return reason;
}

/** Replan after a fresh model probe; preserve checkpoints, observations and all budget windows. */
export function recoverServerExperimentJudgeWait(project: EvolveProject, at: string): EvolveProject {
  const reason = serverExperimentJudgeWait(project);
  if (!reason) return project;
  return {
    ...project,
    campaign: { ...project.campaign, status: "idle", stopReason: undefined },
    attentionRequests: project.attentionRequests?.map(r => r.status === "pending" && r.type === "capability"
      && r.reason === reason && r.stage === project.stage
      ? { ...r, status: "resolved", resolvedAt: at, resolution: "Server AI Runtime Probe 已恢复；重新评审保留的 Experiment 文件和证据。" } : r),
    updatedAt: at,
  };
}
