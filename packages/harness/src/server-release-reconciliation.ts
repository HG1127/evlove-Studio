import type {EvolveProject,VercelReleaseObservation} from "@evolution/contracts";
import {applyProductionLearningGovernance,currentReleaseCandidate,reconcileReleaseObservation} from "@evolution/core";

export type ServerReleaseReconciliationPorts={
  observe(args:{boundDeploymentId?:string;healthPath?:string}):Promise<VercelReleaseObservation>;
};

export type ServerReleaseReconciliationOutcome={
  control:"continue"|"stop";
  project:EvolveProject;
  disposition:"safe-to-resume"|"terminal-live-decision"|"manual-check";
  observation:VercelReleaseObservation;
  reason:string;
};

export async function runServerReleaseReconciliation(
  project:EvolveProject,
  ports:ServerReleaseReconciliationPorts,
):Promise<ServerReleaseReconciliationOutcome>{
  const candidate=currentReleaseCandidate(project);
  if(!candidate)throw new Error("Release reconcile requires the exact current Candidate");
  const observation=await ports.observe({
    boundDeploymentId:project.release.deploymentId,
    healthPath:project.releaseTarget?.healthPath,
  });
  const result=reconcileReleaseObservation({project,candidate,observation});
  const governed=applyProductionLearningGovernance(result.project,{at:observation.checkedAt,now:Date.parse(observation.checkedAt)});
  const manual=result.disposition==="manual-check";
  const next:EvolveProject=manual?{
    ...governed,
    stage:"release",
    campaign:{
      ...governed.campaign,
      status:"paused",
      stopReason:`[server-release-manual-check] ${result.reason}`,
      schedule:{...result.project.campaign.schedule,enabled:false,nextRunAt:undefined},
    },
  }:governed;
  return {
    control:manual?"stop":"continue",
    project:next,
    disposition:result.disposition,
    observation,
    reason:result.reason,
  };
}
