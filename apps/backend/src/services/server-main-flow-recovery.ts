import { createHash } from "node:crypto";
import { goalReadiness } from "@evolution/core";
import { createEvolutionEvent, type EvolveProject, type EvolutionEvent, type EvolutionWorkflowRunInput } from "@evolution/contracts";
import { canRemeasureLegacyServerPlan, remeasureLegacyServerPlan, recoverServerMainFlowWait,
  serverMainFlowContextFingerprint, serverMainFlowRecoveryWait, serverMainFlowRecoveryWire, serverMainFlowWaitMarker, serverExperimentRecoveryWait, serverControlAiWait } from "@evolution/harness";

export function serverMainFlowRecoveryDigest(project: EvolveProject) {
  return createHash("sha256").update(serverMainFlowRecoveryWire(project)).digest("hex");
}

/** Called only with an actual server Campaign capability outcome, before its Mission write. */
export function checkpointServerMainFlowWait(project: EvolveProject, controlJobId: string): EvolveProject {
  if (!project.targetConnection) return project;
  if (serverExperimentRecoveryWait(project)) return clearServerMainFlowWait(project);
  const marker = serverMainFlowWaitMarker(project);
  if (project.campaign.status !== "paused" || !marker) return project;
  if (marker === "control-ai" && (!goalReadiness(project).ready || project.gates.find(g => g.id === "target-ready")?.status !== "approved")) return project;
  // The existing frozen-observation path remains authoritative when it has a complete execution journal.
  return { ...project, campaign: { ...project.campaign, serverRecoveryWait: {
    schemaVersion: "server-campaign-recovery-v1", controlJobId, missionId: project.id,
    round: project.campaign.currentRound + 1, stage: project.stage, marker,
    reason: project.campaign.stopReason!, inputFingerprint: serverMainFlowRecoveryDigest(project),
    contextFingerprint: serverMainFlowContextFingerprint(project), status: "waiting",
    controlAiAttentionRequestId: marker === "control-ai" ? serverControlAiWait(project)?.id : undefined,
  } } };
}

export function hasServerMainFlowRecoveryBinding(project: EvolveProject) {
  const receipt = project.campaign.serverRecoveryWait;
  return Boolean(receipt && receipt.missionId === project.id
    && receipt.contextFingerprint === serverMainFlowContextFingerprint(project)
    && receipt.inputFingerprint === serverMainFlowRecoveryDigest(project));
}

export function restoreServerMainFlowWait(project: EvolveProject, controlJobId: string, at: string) {
  const receipt = serverMainFlowRecoveryWait(project);
  if (!receipt || receipt.controlJobId === controlJobId || !hasServerMainFlowRecoveryBinding(project)) return project;
  return recoverServerMainFlowWait(project, at, controlJobId);
}

/** Explicit fresh intent creates new measurement evidence; it never retroactively binds the old pause. */
export async function prepareServerFreshBaseline(
  project: EvolveProject, input: EvolutionWorkflowRunInput, append: (event: EvolutionEvent) => Promise<void>,
): Promise<EvolveProject> {
  if (!input.freshBaseline || project.campaign.freshBaselineRestartControlJobId === input.controlJobId) return project;
  const owner=project.campaign.serverControlOwner;
  const sourceVersionMatches=project.updatedAt===input.freshBaseline.sourceUpdatedAt
    ||owner?.controlJobId===input.controlJobId&&owner.sourceUpdatedAt===input.freshBaseline.sourceUpdatedAt;
  if (!sourceVersionMatches || !canRemeasureLegacyServerPlan(project)
    || serverMainFlowRecoveryDigest(project) !== input.freshBaseline.inputFingerprint) {
    throw new Error("当前输入或旧 Plan 暂停已变化；未启动重新测量。请刷新并核对状态。");
  }
  await append(createEvolutionEvent({
    id: "evt-" + input.controlJobId + "-fresh-baseline-source", missionId: project.id, jobId: input.controlJobId,
    type: "MissionUpdated", source: "vercel-workflow-control", at: input.requestedAt,
    payload: { action: "remeasure-current-input", sourceUpdatedAt: input.freshBaseline.sourceUpdatedAt,
      inputFingerprint: input.freshBaseline.inputFingerprint, baselineRun: project.baselineRun, rootBaseline: project.campaign.rootBaseline,
      problems: project.problems, selectedProblemId: project.selectedProblemId, diagnosis: project.diagnosis,
      checkpoint: project.campaign.checkpoint, priorStopReason: project.campaign.stopReason },
  }));
  return remeasureLegacyServerPlan(project, input.controlJobId, input.requestedAt);
}


export function clearServerMainFlowWait(project: EvolveProject): EvolveProject {
  return project.campaign.serverRecoveryWait ? { ...project, campaign: { ...project.campaign, serverRecoveryWait: undefined } } : project;
}
