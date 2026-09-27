import type { EvaluationResult, EvolveProject } from "@evolution/contracts";
import { fastHash } from "./stable-hash";

/** Score comparability depends on the user contract and original Target, never on the evolving Champion. */
export function campaignScoringInputFingerprint(project: EvolveProject): string {
  return fastHash({
    version: "campaign-scoring-input-v1",
    goal: project.goal,
    objectType: project.objectType,
    evolutionCommand: project.evolutionCommand,
    editableItems: project.editableItems,
    acceptanceRubric: project.acceptanceRubric,
    evalSuite: project.evalSuite,
    hiddenEvalSuite: project.hiddenEvalSuite,
    metrics: (project.metrics ?? []).map(({ key, target, direction }) => ({ key, target, direction })),
    protectedItems: project.protectedItems,
    inputClarifications: project.inputClarifications,
    targetConnection: {
      adapter: project.targetConnection.adapter,
      connectionId: project.targetConnection.connectionId,
      git: project.targetConnection.git,
      gitSnapshot: project.targetConnection.gitSnapshot && { commitSha: project.targetConnection.gitSnapshot.commitSha, treeSha: project.targetConnection.gitSnapshot.treeSha, artifactId: project.targetConnection.gitSnapshot.artifactId },
      connector: project.targetConnection.connector,
      connectorSnapshot: project.targetConnection.connectorSnapshot && { connectorId: project.targetConnection.connectorSnapshot.connectorId, targetId: project.targetConnection.connectorSnapshot.targetId, versionRef: project.targetConnection.connectorSnapshot.versionRef, snapshotRef: project.targetConnection.connectorSnapshot.snapshotRef, artifactId: project.targetConnection.connectorSnapshot.artifactId },
    },
    executionPolicy: {
      batchArtifactRuntime: project.experimentPolicy?.batchArtifactRuntime,
      batchSize: project.experimentPolicy?.batchSize,
    },
    sourceArtifacts: (project.sourceArtifacts ?? []).map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      role: artifact.role,
      extension: artifact.extension,
      inputMode: artifact.inputMode,
      kind: artifact.artifactKind,
      descriptor: artifact.artifactDescriptor,
      mimeType: artifact.mimeType,
      size: artifact.size,
      storageRef: artifact.storageRef,
      openaiFileId: artifact.openaiFileId,
      summary: artifact.summary,
      warnings: artifact.warnings,
      parseStatus: artifact.parseStatus,
      textContent: artifact.textContent,
      textExcerpt: artifact.textExcerpt,
      structure: artifact.structure,
      structuredContent: artifact.structuredContent,
    })),
  });
}

/** A live Target or remote evaluator may change even when the stored input identity has not. */
export function campaignObservesLiveTarget(project: EvolveProject): boolean {
  return project.targetConnection.adapter === "http"
    || (project.targetConnection.adapter === "connector" && !project.targetConnection.connectorSnapshot)
    || [...project.evalSuite, ...project.hiddenEvalSuite].some((testCase) => testCase.executionMode === "external-runner" || testCase.executionMode === "visual-review");
}
/** Old scores cannot be compared after the scoring input changes, including legacy rows without a binding. */
export function campaignScoringInputBlocker(project: EvolveProject): string | undefined {
  if (project.campaign.currentRound === 0) return undefined;
  if (project.campaign.scoringInputFingerprint === campaignScoringInputFingerprint(project)) return undefined;
  return "目标、考卷、验收标准或 Target 来源已变化，旧 Campaign 分数不可直接比较；请在自主进化中心点击「重置搜索」，再重新运行。";
}

/** Repairing a later round must never turn its current Champion score into the original Campaign anchor. */
export function campaignRootBaselineForMeasurement(
  project: EvolveProject,
  measured: EvaluationResult | undefined,
  routeFingerprint?: string,
  retryIncomplete = false,
): EvaluationResult | undefined {
  if (project.campaign.currentRound === 0 && (
    retryIncomplete
    || project.campaign.scoringInputFingerprint !== campaignScoringInputFingerprint(project)
    || project.campaign.scoringRouteFingerprint !== routeFingerprint
  )) return measured;
  return project.campaign.rootBaseline ?? measured;
}
