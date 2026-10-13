import { createHash } from "node:crypto";
import { goalReadiness, HTML_PROTECTION_SETTLEMENT_POLICY } from "@evolution/core";
import { createEvolutionEvent, EvolveProjectSchema, type EvolveProject, type EvolutionEvent, type EvolutionWorkflowRunInput } from "@evolution/contracts";
import { canRemeasureLegacyServerPlan, remeasureLegacyServerPlan, recoverServerMainFlowWait,
  serverMainFlowContextFingerprint, serverMainFlowRecoveryBindingVersion, SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION,
  type ServerMainFlowRecoveryBindingVersion, serverMainFlowRecoveryWait, serverMainFlowRecoveryWire, serverMainFlowWaitMarker, serverExperimentRecoveryWait, serverControlAiWait } from "@evolution/harness";

export function serverMainFlowRecoveryDigest(project: EvolveProject,
  bindingVersion: ServerMainFlowRecoveryBindingVersion = HTML_PROTECTION_SETTLEMENT_POLICY) {
  return createHash("sha256").update(serverMainFlowRecoveryWire(project, bindingVersion)).digest("hex");
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
  const bindingVersion = serverMainFlowRecoveryBindingVersion(project);
  return Boolean(receipt && receipt.missionId === project.id && bindingVersion
    && receipt.inputFingerprint === serverMainFlowRecoveryDigest(project, bindingVersion));
}

export function restoreServerMainFlowWait(project: EvolveProject, controlJobId: string, at: string) {
  const receipt = serverMainFlowRecoveryWait(project);
  if (!receipt || receipt.controlJobId === controlJobId || !hasServerMainFlowRecoveryBinding(project)) return project;
  // A legacy policy transition must preserve its failed paper in a durable audit before recovery.
  if (serverMainFlowRecoveryBindingVersion(project) === SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION) return project;
  return recoverServerMainFlowWait(project, at, controlJobId);
}

export type ServerMainFlowRecoveryAuditPort = {
  requestedAt: string;
  append(event: EvolutionEvent): Promise<void>;
};

/** Only the explicit normal new-control path can admit this exact policy transition. */
export async function restoreServerMainFlowWaitWithPolicyAudit(
  project: EvolveProject, controlJobId: string, at: string, audit?: ServerMainFlowRecoveryAuditPort,
): Promise<EvolveProject> {
  if (serverMainFlowRecoveryBindingVersion(project) !== SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION)
    return restoreServerMainFlowWait(project, controlJobId, at);
  // Freeze and validate the complete generation before the external append awaits.
  const snapshot = EvolveProjectSchema.parse(structuredClone(project));
  const receipt = serverMainFlowRecoveryWait(snapshot);
  if (!receipt || receipt.controlJobId === controlJobId || !hasServerMainFlowRecoveryBinding(snapshot)) return project;
  if (!audit || !Number.isFinite(Date.parse(audit.requestedAt))) throw new Error("Legacy policy transition requires a durable audit port and fixed request time");
  const requestedAt = audit.requestedAt;
  const event = createEvolutionEvent({
    id: "evt-" + controlJobId + "-baseline-policy-transition-v1", missionId: snapshot.id, jobId: controlJobId,
    type: "ActionPlanned", source: "vercel-workflow-control", at: requestedAt,
    payload: {
      action: "baseline-policy-transition", fromBindingVersion: SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION,
      toProtectionPolicy: HTML_PROTECTION_SETTLEMENT_POLICY,
      priorControlJobId: receipt.controlJobId, resumedByControlJobId: controlJobId,
      sourceUpdatedAt: snapshot.updatedAt, priorContextFingerprint: receipt.contextFingerprint,
      priorInputFingerprint: receipt.inputFingerprint, currentContextFingerprint: serverMainFlowContextFingerprint(snapshot),
      currentInputFingerprint: serverMainFlowRecoveryDigest(snapshot),
      requiredActions: ["execute-current-policy-baseline", "independent-current-policy-baseline-judge"],
      priorRunsReusedAsNewPolicyEvidence: false,
      priorBaselineRun: snapshot.baselineRun, priorCheckpoint: snapshot.campaign.checkpoint,
      priorRecoveryWait: receipt,
    },
  });
  // A port must not be able to mutate the bound snapshot via its audit payload.
  await audit.append(structuredClone(event));
  if (!serverMainFlowRecoveryWait(snapshot) || !hasServerMainFlowRecoveryBinding(snapshot))
    throw new Error("Recovery binding or runtime boundary changed before the policy transition");
  return recoverServerMainFlowWait(snapshot, at, controlJobId);
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
