import type {Candidate,EvolveProject,ReleaseAdapterResult,VercelReleaseObservation} from "@evolution/contracts";
import {applyProductionLearningGovernance,currentReleaseCandidate,expectedReleaseArtifactHashes,reconcileAdapterReleaseObservation,reconcileHttpReleaseObservation,reconcileReleaseObservation,type DurableReleaseAction} from "@evolution/core";

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

export type ServerHttpReleaseReconciliationPorts={
  observe(args:{
    candidate:Candidate;
    deploymentId?:string;
    stableDeploymentId?:string;
    expectedArtifactHashes:Array<{sourceArtifactId:string;contentHash:string}>;
    recoveryAction?:DurableReleaseAction;
    healthPath?:string;
  }):Promise<ReleaseAdapterResult>;
};

export type ServerHttpReleaseReconciliationOutcome={
  control:"continue"|"stop";
  project:EvolveProject;
  disposition:"safe-to-resume"|"terminal-live-decision"|"manual-check";
  observation?:ReleaseAdapterResult;
  observedAt:string;
  reason:string;
};

export async function runServerHttpReleaseReconciliation(
  project:EvolveProject,
  ports:ServerHttpReleaseReconciliationPorts,
):Promise<ServerHttpReleaseReconciliationOutcome>{
  return runServerAdapterReleaseReconciliation(project,ports,{providerLabel:"HTTP Observe",failureLabel:"HTTP Observe"});
}

export async function runServerAdapterReleaseReconciliation(
  project:EvolveProject,
  ports:ServerHttpReleaseReconciliationPorts,
  options:{providerLabel:string;failureLabel:string},
):Promise<ServerHttpReleaseReconciliationOutcome>{
  const candidate=currentReleaseCandidate(project);
  if(!candidate)throw new Error(`${options.providerLabel} reconcile requires the exact current Candidate`);
  let observation:ReleaseAdapterResult;
  try{
    observation=await ports.observe({
      candidate,
      deploymentId:project.release.deploymentId,
      stableDeploymentId:project.release.stableDeploymentId,
      expectedArtifactHashes:expectedReleaseArtifactHashes(candidate),
      recoveryAction:project.release.recovery?.action,
      healthPath:project.releaseTarget?.healthPath,
    });
  }catch(error){
    const observedAt=new Date().toISOString();
    const reason=`${options.failureLabel} 未完成：${error instanceof Error?error.message:String(error)}。系统不会自动重放生产写操作。`;
    return{
      control:"stop",
      disposition:"manual-check",
      observedAt,
      reason,
      project:{
        ...project,
        stage:"release",
        release:{...project.release,recovery:{status:"manual-check",action:project.release.recovery?.action,reason,at:project.release.recovery?.at??observedAt,lastObservedAt:observedAt}},
        campaign:{...project.campaign,status:"paused",stopReason:`[server-release-manual-check] ${reason}`,schedule:{...project.campaign.schedule,enabled:false,nextRunAt:undefined}},
        updatedAt:observedAt,
      },
    };
  }
  const result=options.providerLabel==="HTTP Observe"
    ?reconcileHttpReleaseObservation({project,candidate,observation})
    :reconcileAdapterReleaseObservation({project,candidate,observation,providerLabel:options.providerLabel});
  const observedAt=observation.observedAt??new Date().toISOString();
  const governed=applyProductionLearningGovernance(result.project,{at:observedAt,now:Date.parse(observedAt)});
  const manual=result.disposition==="manual-check";
  const next:EvolveProject=manual?{
    ...governed,
    stage:"release",
    campaign:{...governed.campaign,status:"paused",stopReason:`[server-release-manual-check] ${result.reason}`,schedule:{...governed.campaign.schedule,enabled:false,nextRunAt:undefined}},
  }:governed;
  return{control:manual?"stop":"continue",project:next,disposition:result.disposition,observation,observedAt,reason:result.reason};
}

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
