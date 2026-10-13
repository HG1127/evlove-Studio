import type { EvolveProject } from "@evolution/contracts";
import { recoverServerControlAiWait, serverControlAiWait, recoverServerExperimentRecoveryWait,
  serverExperimentRecoveryWait, serverMainFlowRecoveryWait, serverMainFlowRecoveryBindingVersion, SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION, canRemeasureLegacyServerPlan, canRecoverServerArtifactReadbackWithoutAi } from "@evolution/harness";
import { serverAiScoringRouteFingerprint } from "./ai-gateway";
import { requireServerControlAi, ServerControlAiUnavailableError } from "./server-control-ai";
import { hasServerMainFlowRecoveryBinding, restoreServerMainFlowWait, restoreServerMainFlowWaitWithPolicyAudit, type ServerMainFlowRecoveryAuditPort } from "./server-main-flow-recovery";

/** Metadata only admits a readback attempt; Gate F must still read and verify the physical bytes. */
export async function requireServerMainFlowRecoveryAi(project: EvolveProject, routeFingerprint?: string, nowMs = Date.now()): Promise<void> {
  if (!canRecoverServerArtifactReadbackWithoutAi(project, routeFingerprint, nowMs)) {
    await requireServerControlAi({ force: true });
  }
}

/** Called only inside an explicitly started durable control run. */
export async function restoreServerControlAiWait(project: EvolveProject, controlJobId?: string,
  audit?: ServerMainFlowRecoveryAuditPort): Promise<EvolveProject> {
  const receipt = project.campaign.serverRecoveryWait;
  const boundWait = serverMainFlowRecoveryWait(project);
  if (receipt && (!controlJobId || !boundWait || receipt.controlJobId === controlJobId || !hasServerMainFlowRecoveryBinding(project))) return project;
  const legacyPolicyTransition = Boolean(boundWait && serverMainFlowRecoveryBindingVersion(project) === SERVER_MAIN_FLOW_LEGACY_BINDING_VERSION);
  if (legacyPolicyTransition && !audit) throw new Error("Legacy policy transition requires a durable audit port");
  const controlWait = serverControlAiWait(project);
  if (!receipt && canRemeasureLegacyServerPlan(project)) return project;
  if (!receipt && controlWait && (project.candidates.length > 0 || project.campaign.currentRound > 0 || project.searchChampion
    || project.experimentRun.status !== "idle" || project.validationRun.status !== "idle" || project.artifactAcceptance.status !== "idle")) return project;
  if (!boundWait && !controlWait && !serverExperimentRecoveryWait(project)) return project;
  try {
    const route = boundWait?.marker === "artifact-acceptance-evidence-pending"
      ? await serverAiScoringRouteFingerprint() : undefined;
    await requireServerMainFlowRecoveryAi(project, route);
  } catch (error) {
    if (error instanceof ServerControlAiUnavailableError) return project;
    throw error;
  }
  const at = new Date().toISOString();
  return boundWait ? legacyPolicyTransition
    ? restoreServerMainFlowWaitWithPolicyAudit(project, controlJobId!, at, audit)
    : restoreServerMainFlowWait(project, controlJobId!, at)
    : controlWait ? recoverServerControlAiWait(project, at) : recoverServerExperimentRecoveryWait(project, at);
}
