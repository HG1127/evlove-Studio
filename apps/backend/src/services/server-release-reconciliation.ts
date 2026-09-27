import type {EvolveProject} from "@evolution/contracts";
import {projectUsesConnectorRelease,projectUsesHttpRelease,projectUsesVercelRelease} from "@evolution/core";
import {runServerAdapterReleaseReconciliation,runServerHttpReleaseReconciliation,runServerReleaseReconciliation} from "@evolution/harness";
import {observeHttpTarget} from "./http-target-gateway";
import {expectedServerHttpReleaseByteHashes} from "./server-http-release-artifacts";
import {observeConnectorReleaseReality} from "./connector-release";
import {observeVercelReleaseReality} from "./vercel-release";
import {recordConnectorReleaseOutcomeObservation,recordHttpReleaseOutcomeObservation,recordReleaseOutcomeObservation} from "./release-outcome-telemetry";
import {captureReleaseOutcomeTelemetry,skippedReleaseOutcomeTelemetry} from "./release-outcome-status";

export async function runServerMissionReleaseReconciliation(project:EvolveProject){
  if(projectUsesConnectorRelease(project)){
    const outcome=await runServerAdapterReleaseReconciliation(project,{
      observe:({deploymentId,stableDeploymentId,recoveryAction})=>observeConnectorReleaseReality(project,{deploymentId,stableDeploymentId,recoveryAction}),
    },{providerLabel:"Connector Observe",failureLabel:"Connector Observe"});
    const outcomeTelemetry=outcome.disposition!=="manual-check"&&outcome.observation
      ?await captureReleaseOutcomeTelemetry(()=>recordConnectorReleaseOutcomeObservation(outcome.project,outcome.observation!))
      :skippedReleaseOutcomeTelemetry();
    return{
      ...outcome,
      provider:"connector" as const,
      outcomeTelemetry,
      previewReady:outcome.disposition!=="manual-check"&&outcome.observation?.effectiveAction==="shadow"&&outcome.observation.healthy===true,
      productionDeploymentId:outcome.project.release.environment==="production"?outcome.project.release.deploymentId:undefined,
      boundDeploymentId:outcome.project.release.deploymentId,
      productionHealthReady:outcome.disposition!=="manual-check"&&outcome.project.release.environment==="production"?outcome.project.release.healthy:undefined,
      boundHealthReady:outcome.disposition!=="manual-check"&&outcome.project.release.environment!=="production"?outcome.project.release.healthy:undefined,
      observationErrors:[] as string[],
      rollingRelease:undefined,
    };
  }
  if(projectUsesHttpRelease(project)){
    const connectionId=project.releaseTarget?.connectionId;
    if(!connectionId)throw new Error("HTTP Release Observe 缺少独立 releaseTarget.connectionId");
    const outcome=await runServerHttpReleaseReconciliation(project,{
      observe:({candidate,deploymentId,stableDeploymentId,expectedArtifactHashes,recoveryAction,healthPath})=>observeHttpTarget({
        projectId:project.id,
        connectionId,
        candidate,
        deploymentId,
        stableDeploymentId,
        expectedArtifactHashes,
        expectedArtifactByteHashes:expectedServerHttpReleaseByteHashes(project,candidate),
        recoveryAction,
        healthPath,
      }),
    });
    const outcomeTelemetry=outcome.disposition!=="manual-check"&&outcome.observation
      ?await captureReleaseOutcomeTelemetry(()=>recordHttpReleaseOutcomeObservation(outcome.project,outcome.observation!))
      :skippedReleaseOutcomeTelemetry();
    return{
      ...outcome,
      provider:"http" as const,
      outcomeTelemetry,
      previewReady:outcome.disposition!=="manual-check"&&outcome.observation?.effectiveAction==="shadow"&&outcome.observation.healthy===true,
      productionDeploymentId:outcome.project.release.environment==="production"?outcome.project.release.deploymentId:undefined,
      boundDeploymentId:outcome.project.release.deploymentId,
      productionHealthReady:outcome.disposition!=="manual-check"&&outcome.project.release.environment==="production"?outcome.project.release.healthy:undefined,
      boundHealthReady:outcome.disposition!=="manual-check"&&outcome.project.release.environment!=="production"?outcome.project.release.healthy:undefined,
      observationErrors:[] as string[],
      rollingRelease:undefined,
    };
  }
  if(!projectUsesVercelRelease(project))throw new Error("Mission 未连接受支持的线上 Release Target");

  let observed:Awaited<ReturnType<typeof observeVercelReleaseReality>>|undefined;
  const outcome=await runServerReleaseReconciliation(project,{
    observe:async({boundDeploymentId,healthPath})=>{
      observed=await observeVercelReleaseReality({
        boundDeploymentId,
        gitCommitSha:project.release.sourceGitCommitSha,
        healthPath,
      });
      return observed;
    },
  });
  const outcomeTelemetry=outcome.disposition!=="manual-check"&&observed
    ?await captureReleaseOutcomeTelemetry(()=>recordReleaseOutcomeObservation(outcome.project,observed!))
    :skippedReleaseOutcomeTelemetry();
  return{
    ...outcome,
    provider:"vercel" as const,
    outcomeTelemetry,
    observedAt:outcome.observation.checkedAt,
    previewReady:outcome.disposition!=="manual-check"&&outcome.observation.boundDeployment?.state==="READY",
    productionDeploymentId:outcome.observation.productionDeployment?.id,
    boundDeploymentId:outcome.observation.boundDeployment?.id,
    productionHealthReady:outcome.disposition!=="manual-check"&&outcome.observation.productionHealth.ready,
    boundHealthReady:outcome.disposition!=="manual-check"&&outcome.observation.boundHealth?.ready,
    observationErrors:outcome.observation.errors,
    rollingRelease:outcome.observation.rollingRelease,
  };
}
