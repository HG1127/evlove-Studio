import type { EvolveProject } from "@evolution/contracts";
import { fastHash } from "@evolution/core";
import { deriveAutonomousDecision, type AutonomousAction, type AutonomousDecision } from "./autonomous-planner";
import type { HarnessExecutionPlan } from "./action-executor";

export type ServerHarnessPlan = HarnessExecutionPlan<AutonomousAction> & {
  decision: AutonomousDecision;
  sourceRevision: string;
};

export function buildServerHarnessPlan(project:EvolveProject):ServerHarnessPlan {
  const decision=deriveAutonomousDecision(project);
  const sourceRevision=fastHash([
    project.id,
    project.updatedAt,
    project.stage,
    project.currentVersionId,
    project.campaign.currentRound,
    project.campaign.status,
    project.searchChampion?.id,
    project.validationRun.id,
    project.artifactAcceptance.id,
    project.gates.find((gate)=>gate.id==="release-ready")?.status,
    project.release.status,
    project.release.candidateId,
    project.release.deploymentId,
    project.release.stableDeploymentId,
    project.release.evidenceMode,
    project.release.healthy,
    project.release.recovery?.status,
    project.release.recovery?.action,
    project.release.recovery?.lastObservedAt,
    decision.action,
  ]);
  const checkpointId=`server-checkpoint-${fastHash([
    project.id,
    sourceRevision,
    decision.stage,
    project.campaign.currentRound,
    project.release.status,
    project.release.deploymentId,
    project.release.recovery?.status,
    decision.action,
  ])}`;
  return {
    decision,
    checkpoint:{
      id:checkpointId,
      stage:decision.stage,
      round:project.campaign.currentRound,
    },
    policy:{
      mode:decision.action==="wait-human"?"human":"auto",
    },
    sourceRevision,
  };
}
