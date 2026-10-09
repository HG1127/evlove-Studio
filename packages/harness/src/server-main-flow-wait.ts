import { ServerCampaignRecoveryWaitSchema, type EvolveProject } from "@evolution/contracts";
import { campaignPreflightStopReason, campaignScoringInputFingerprint, evidenceFingerprint, fastHash, goalReadiness } from "@evolution/core";
import { serverControlAiWait } from "./server-control-capability";

/** Exact server markers only. Human approvals, integrity failures and stop reasons are excluded. */
const stages: Record<string, EvolveProject["stage"] | undefined> = {
  "ai-pending": undefined,
  "baseline-evidence-pending": "baseline",
  "baseline-judge-pending": "baseline",
  "diagnosis-pending": "diagnosis",
  "plan-grounding-pending": "plan",
  "experiment-build-pending": "experiment",
  "holdout-artifact-pending": "validation",
  "holdout-judge-pending": "validation",
  "holdout-review-pending": "validation",
  "holdout-evidence-pending": "validation",
  "artifact-acceptance-evidence-pending": "validation",
  "artifact-repair-pending": "validation",
};

export function serverMainFlowWaitMarker(project: EvolveProject) {
  if (serverControlAiWait(project)) return "control-ai";
  const match = /^\[server-campaign-([a-z-]+)\]/.exec(project.campaign.stopReason ?? "");
  const marker = match?.[1];
  if (!marker || !Object.hasOwn(stages, marker) || stages[marker] && stages[marker] !== project.stage) return undefined;
  const checkpoint = project.campaign.checkpoint, round = project.campaign.currentRound + 1;
  if (checkpoint && checkpoint.round !== round) return undefined;
  if (marker === "plan-grounding-pending" && checkpoint?.completedPhase !== "diagnose") return undefined;
  if (marker === "diagnosis-pending" && checkpoint?.completedPhase !== "diagnose") return undefined;
  if (marker === "experiment-build-pending" && (checkpoint?.completedPhase !== "plan"
    || project.experimentRun.status !== "failed" || project.experimentRun.id !== "experiment-r" + round + "-server"
    || project.experimentRun.summary !== project.campaign.stopReason
    || !project.selectedCandidateIds.length || new Set(project.selectedCandidateIds).size !== project.selectedCandidateIds.length
    || project.selectedCandidateIds.some(id => project.candidates.filter(c => c.id === id).length !== 1)
    || !project.experimentRun.buildFailures?.length)) return undefined;
  if (marker.startsWith("holdout-") && (checkpoint?.completedPhase !== "experiment"
    || project.experimentRun.status !== "completed" || !project.experimentRun.winnerId && !project.experimentRun.pendingEvidenceCandidateId
    || project.candidates.filter(c => c.id === (project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId)).length !== 1
    || project.validationRun.candidateId !== (project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId)
    || project.validationRun.id !== "validation-server-r" + round)) return undefined;
  if (marker === "holdout-judge-pending" && (project.validationRun.status !== "failed" || project.validationRun.error !== project.campaign.stopReason)) return undefined;
  if (marker === "holdout-review-pending" && (project.validationRun.status !== "completed" || project.validationRun.summary !== project.campaign.stopReason)) return undefined;
  if (marker.startsWith("artifact-")) {
    const matching = project.candidates.filter(c => c.id === project.validationRun.candidateId);
    if (checkpoint?.completedPhase !== "validation" || project.validationRun.status !== "completed" || matching.length !== 1
      || project.validationRun.evidenceFingerprint !== evidenceFingerprint(project, matching[0]!)) return undefined;
  }
  return marker;
}

/** Bind the complete saved generation, including physical references, both papers and exact parent. */
export function serverMainFlowRecoveryContext(project: EvolveProject) {
  return {
    schemaVersion: "server-main-flow-context-v1", missionId: project.id, objectType: project.objectType, stage: project.stage,
    contract: campaignScoringInputFingerprint(project),
    sources: project.sourceArtifacts, target: project.targetConnection, goal: project.goal, command: project.evolutionCommand,
    protectedItems: project.protectedItems, editableItems: project.editableItems,
    clarifications: project.inputClarifications, understanding: project.inputUnderstanding, metrics: project.metrics,
    rubric: project.acceptanceRubric, rubricState: project.acceptanceRubricState, eval: project.evalSuite, hidden: project.hiddenEvalSuite,
    supplementalEvidence: project.supplementalValidationEvidence,
    parent: project.searchChampion, version: project.version, currentVersionId: project.currentVersionId,
    checkpoint: project.campaign.checkpoint, round: project.campaign.currentRound,
    selectedProblemId: project.selectedProblemId, problems: project.problems, diagnosis: project.diagnosis,
    candidates: project.candidates, selectedCandidateIds: project.selectedCandidateIds,
    baseline: project.baselineRun, experiment: project.experimentRun, validation: project.validationRun,
    acceptance: project.artifactAcceptance, gates: project.gates, release: project.release,
    profile: project.aiProfile, policy: project.experimentPolicy,
  };
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, ordered(record[key])]));
}
export function serverMainFlowRecoveryWire(project: EvolveProject) {
  return JSON.stringify(ordered(JSON.parse(JSON.stringify(serverMainFlowRecoveryContext(project)))));
}
export function serverMainFlowContextFingerprint(project: EvolveProject) {
  return fastHash(serverMainFlowRecoveryWire(project));
}

export function serverMainFlowRecoveryReadiness(project: EvolveProject) {
  const evaluation = project.validationRun.evaluation;
  if (evaluation?.safety === "FAIL" || project.experimentRun.candidateResults.some(r => r.experimentStage === "finalist" && r.evaluation.safety === "FAIL")) return false;
  const approvalCriterionIds = new Set(project.acceptanceRubric.filter(c => c.protectedConstraint
    || c.source === "protected-item" || c.validationMethod === "manual-review").map(c => c.id));
  if (evaluation?.criterionScores?.some(r => r.verificationStatus === "verified" && !r.pass && approvalCriterionIds.has(r.criterionId))
    || project.artifactAcceptance.status === "failed" && project.artifactAcceptance.results.some(r => !r.pass && approvalCriterionIds.has(r.criterionId))) return false;
  // Capability evidence gaps are the subject of this retry. Budget, Safety, time and round limits remain.
  const boundaryView = { ...project, artifactAcceptance: { ...project.artifactAcceptance, status: "idle" as const },
    validationRun: { ...project.validationRun, evaluation: project.validationRun.evaluation
      ? { ...project.validationRun.evaluation, unverifiedCriterionIds: [] } : undefined } };
  return !campaignPreflightStopReason(boundaryView) && goalReadiness(project).ready
    && project.gates.find(g => g.id === "target-ready")?.status === "approved"
    && !(project.attentionRequests ?? []).some(r => r.status === "pending" && r.blocking
      && (r.type !== "capability" || r.reason !== project.campaign.stopReason || r.stage !== project.stage));
}

/** Synchronous UI/Domain recognition; composition must additionally verify the SHA before resuming. */
export function serverMainFlowRecoveryWait(project: EvolveProject) {
  const parsed = ServerCampaignRecoveryWaitSchema.safeParse(project.campaign.serverRecoveryWait);
  if (!parsed.success) return undefined;
  const receipt = parsed.data;
  if (receipt.status !== "waiting" || project.campaign.status !== "paused" || receipt.missionId !== project.id
    || receipt.round !== project.campaign.currentRound + 1 || receipt.stage !== project.stage
    || receipt.reason !== project.campaign.stopReason || receipt.marker !== serverMainFlowWaitMarker(project)
    || receipt.contextFingerprint !== serverMainFlowContextFingerprint(project) || !serverMainFlowRecoveryReadiness(project)) return undefined;
  return receipt;
}

/** A newly admitted server generation may rerun its capability boundary without erasing failed evidence. */
export function serverMainFlowRecoveryActive(project: EvolveProject) {
  const parsed = ServerCampaignRecoveryWaitSchema.safeParse(project.campaign.serverRecoveryWait);
  if (!parsed.success) return false;
  const receipt = parsed.data;
  if (receipt.status !== "recovering" || !receipt.resumedByControlJobId || receipt.resumedByControlJobId === receipt.controlJobId
    || project.campaign.status !== "idle" || receipt.missionId !== project.id
    || receipt.stage !== project.stage || receipt.round !== project.campaign.currentRound + 1
    || receipt.contextFingerprint !== serverMainFlowContextFingerprint(project) || !serverMainFlowRecoveryReadiness(project)) return false;
  return receipt.marker === serverMainFlowWaitMarker({ ...project,
    campaign: { ...project.campaign, status: "paused", stopReason: receipt.reason } });
}
/** Only checkpoint preservation, after the explicit entry admitted and SHA-checked this generation. */
export function serverMainFlowRecoveryCheckpoint(project: EvolveProject) {
  const receipt = project.campaign.serverRecoveryWait;
  if (receipt?.status !== "recovering" || receipt.missionId !== project.id || receipt.stage !== project.stage
    || receipt.round !== project.campaign.currentRound + 1 || receipt.contextFingerprint !== serverMainFlowContextFingerprint(project)) return undefined;
  return project.campaign.checkpoint && ["plan", "experiment", "validation"].includes(project.campaign.checkpoint.completedPhase)
    ? project.campaign.checkpoint : undefined;
}

export function recoverServerMainFlowWait(project: EvolveProject, at: string, controlJobId: string) {
  const receipt = serverMainFlowRecoveryWait(project);
  if (!receipt || controlJobId === receipt.controlJobId) return project;
  return { ...project, campaign: { ...project.campaign, status: "idle" as const, stopReason: undefined,
    serverRecoveryWait: { ...receipt, status: "recovering" as const, resumedByControlJobId: controlJobId } },
    attentionRequests: project.attentionRequests?.map(r => r.status === "pending" && r.type === "capability"
      && r.reason === receipt.reason && r.stage === receipt.stage
      ? { ...r, status: "resolved" as const, resolvedAt: at, resolution: "明确重试已核验保存的输入与生成边界。" } : r),
    updatedAt: at };
}

/** Old zero-Candidate Plan waits cannot prove the old parent. An explicit fresh measurement is required. */
export function canRemeasureLegacyServerPlan(project: EvolveProject) {
  const known = ["plan-grounding-pending", "ai-pending", "control-ai"].includes(serverMainFlowWaitMarker(project) ?? "");
  return known && project.stage === "plan" && project.campaign.status === "paused" && !project.campaign.serverRecoveryWait
    && project.campaign.currentRound === 0 && project.candidates.length === 0 && project.selectedCandidateIds.length === 0
    && !project.searchChampion && project.experimentRun.status === "idle" && project.experimentRun.candidateResults.length === 0
    && !project.experimentRun.winnerId && !project.experimentRun.pendingEvidenceCandidateId
    && project.validationRun.status === "idle" && project.validationRun.runs.length === 0 && project.validationRun.baselineRuns.length === 0
    && project.artifactAcceptance.status === "idle" && project.release.status === "idle"
    && !project.outputArtifacts.some(a => a.accepted) && serverMainFlowRecoveryReadiness(project);
}

export function remeasureLegacyServerPlan(project: EvolveProject, controlJobId: string, at: string): EvolveProject {
  if (!canRemeasureLegacyServerPlan(project)) return project;
  const prefix = "fresh-baseline-" + controlJobId;
  return { ...project, stage: "baseline", problems: [], selectedProblemId: undefined, diagnosis: undefined,
    baselineRun: { id: prefix, status: "idle", suiteName: project.baselineRun.suiteName, totalCases: project.evalSuite.length, runs: [] },
    experimentRun: { id: prefix + "-experiment", status: "idle", candidateResults: [] },
    validationRun: { id: prefix + "-validation", status: "idle", checks: [], runs: [], baselineRuns: [] },
    campaign: { ...project.campaign, status: "idle", stopReason: undefined, checkpoint: undefined,
      rootBaseline: undefined, scoringInputFingerprint: undefined, scoringRouteFingerprint: undefined,
      freshBaselineRestartControlJobId: controlJobId },
    attentionRequests: project.attentionRequests?.map(r => r.status === "pending" && r.type === "capability"
      && r.reason === project.campaign.stopReason && r.stage === project.stage
      ? { ...r, status: "resolved" as const, resolvedAt: at, resolution: "显式从当前输入重新测量；旧证据保留在恢复事件中。" } : r),
    gates: project.gates.map(g => g.id === "target-ready" ? g : { ...g, status: "pending" as const, approvedAt: undefined, note: undefined }),
    updatedAt: at };
}
