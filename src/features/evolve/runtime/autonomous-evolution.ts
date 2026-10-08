import type { AttentionRequest, EvolveProject } from "../schemas";
import { deliveryReadiness } from "./delivery-readiness";
import { projectHasLiveReleaseDecision, projectHasOnlineReleaseTarget } from "@evolution/core";
import { deriveAttentionRequest, isLocalBaselineJudgePause, serverExperimentJudgeWait, serverControlAiWait } from "@evolution/harness";

export { autonomousClarificationPlan, clarificationNeedsHuman } from "./autonomy-policy";

export type AutonomousEvolutionState = "waiting-input" | "ready" | "preparing" | "running" | "attention" | "completed";
export type AutonomousAttention = {
  kind: "clarification" | "source" | "validation" | "model" | "limit";
  title: string;
  detail: string;
  stage: EvolveProject["stage"];
  criterionIds?: string[];
  request?: AttentionRequest;
};

export function hasEvolutionTargetInput(project:EvolveProject){
  if(project.sourceArtifacts.some((artifact)=>artifact.role==="target"))return true;
  if(project.targetConnection.status!=="connected")return false;
  return project.targetConnection.adapter==="git"
    ?Boolean(project.targetConnection.git)
    :project.targetConnection.adapter==="connector"
      ?Boolean(project.targetConnection.connector)
      :false;
}

function legacyKind(type: AttentionRequest["type"]): AutonomousAttention["kind"] {
  if (type === "clarification") return "clarification";
  if (type === "input") return "source";
  if (type === "evidence" || type === "capability") return "validation";
  return "limit";
}

/** UI adapter only. Autonomous policy and escalation decisions live in autonomous-orchestrator.ts. */
export function autonomousAttention(project: EvolveProject): AutonomousAttention | undefined {
  const request = deriveAttentionRequest(project);
  if (!request) return undefined;
  return {
    kind: serverExperimentJudgeWait(project) || serverControlAiWait(project) || isLocalBaselineJudgePause(project) || request.diagnosticCode === "artifact-repair-recovery" || request.diagnosticCode === "judge-recovery" ? "model" : legacyKind(request.type),
    title: request.title,
    detail: request.reason,
    stage: request.stage,
    criterionIds: request.criterionIds,
    request,
  };
}

export function autonomousEvolutionState(project: EvolveProject, busy = false): AutonomousEvolutionState {
  if (!hasEvolutionTargetInput(project)) return "waiting-input";
  const hasAcceptedOutput = project.outputArtifacts.some((artifact) => artifact.accepted && artifact.kind === "primary");
  const online = projectHasOnlineReleaseTarget(project);
  const releaseClosureReady = !online || projectHasLiveReleaseDecision(project);
  const learningClosureReady = project.lessons.length > 0 && project.nextQueue.length > 0;
  if (deliveryReadiness(project).ready && hasAcceptedOutput && releaseClosureReady && learningClosureReady) return "completed";
  if (busy || project.campaign.status === "running" || project.campaign.status === "scheduled") return "running";
  if (project.inputUnderstanding?.status === "running") return "preparing";
  if (autonomousAttention(project)) return "attention";
  return "ready";
}

export function autonomousProgress(project: EvolveProject) {
  const targetReady = project.gates.find((gate) => gate.id === "target-ready")?.status === "approved";
  const evolved = Boolean(project.searchChampion?.candidate && project.searchChampion.validation?.recommendation === "release" && project.searchChampion.artifactAcceptance?.status === "passed");
  const packaged = project.outputArtifacts.some((artifact) => artifact.accepted && artifact.kind === "primary");
  const online = projectHasOnlineReleaseTarget(project);
  const closureReady = packaged
    && (!online || projectHasLiveReleaseDecision(project))
    && project.lessons.length > 0
    && project.nextQueue.length > 0;
  return [
    { id: "input", label: "任务已输入", done: hasEvolutionTargetInput(project) },
    { id: "contract", label: "目标与验收已建立", done: Boolean(targetReady && project.evalSuite.length && project.hiddenEvalSuite.length) },
    { id: "evolve", label: "自动进化已达标", done: evolved },
    { id: "output", label: online ? "上线决策、成果与经验已准备" : "成果与经验已准备", done: closureReady },
  ];
}
