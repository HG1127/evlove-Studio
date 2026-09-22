import type {EvolveProject} from "@evolution/contracts";
import {projectUsesConnectorRelease,projectUsesHttpRelease,projectUsesVercelRelease} from "@evolution/core";
import {runServerAdapterReleaseReconciliation,runServerHttpReleaseReconciliation,runServerReleaseReconciliation} from "@evolution/harness";
import {observeHttpTarget} from "./http-target-gateway";
import {observeConnectorReleaseReality} from "./connector-release";
import {observeVercelReleaseReality} from "./vercel-release";
import {recordConnectorReleaseOutcomeObservation,recordHttpReleaseOutcomeObservation,recordReleaseOutcomeObservation} from "./release-outcome-telemetry";

export async function runServerMissionReleaseReconciliation(project:EvolveProject){
  if(projectUsesConnectorRelease(project)){
    const outcome=await runServerAdapterReleaseReconciliation(project,{
      observe:({deploymentId,stableDeploymentId,recoveryAction})=>observeConnectorReleaseReality(project,{deploymentId,stableDeploymentId,recoveryAction}),
    },{providerLabel:"Connector Observe",failureLabel:"Connector Observe"});
    if(outcome.observation){
      const recorded=await recordConnectorReleaseOutcomeObservation(outcome.project,outcome.observation).catch(()=>undefined);
      if(recorded?.telemetry?.warnings.length){
        console.warn("[outcome-telemetry] Connector release observation completed with warnings",recorded.telemetry.warnings);
      }
    }
    return{
      ...outcome,
      provider:"connector" as const,
      previewReady:outcome.observation?.effectiveAction==="shadow"&&outcome.observation.healthy===true,
      productionDeploymentId:outcome.project.release.environment==="production"?outcome.project.release.deploymentId:undefined,
      boundDeploymentId:outcome.project.release.deploymentId,
      productionHealthReady:outcome.project.release.environment==="production"?outcome.project.release.healthy:undefined,
      boundHealthReady:outcome.project.release.environment!=="production"?outcome.project.release.healthy:undefined,
      observationErrors:[] as string[],
      rollingRelease:undefined,
    };
  }
  if(projectUsesHttpRelease(project)){
    const outcome=await runServerHttpReleaseReconciliation(project,{
      observe:({candidate,deploymentId,stableDeploymentId,expectedArtifactHashes,recoveryAction,healthPath})=>observeHttpTarget({
        projectId:project.id,
        connectionId:project.targetConnection.connectionId,
        candidate,
        deploymentId,
        stableDeploymentId,
        expectedArtifactHashes,
        recoveryAction,
        healthPath,
      }),
    });
    if(outcome.observation){
      const recorded=await recordHttpReleaseOutcomeObservation(outcome.project,outcome.observation).catch(()=>undefined);
      if(recorded?.telemetry?.warnings.length){
        console.warn("[outcome-telemetry] HTTP release observation completed with warnings",recorded.telemetry.warnings);
      }
    }
    return{
      ...outcome,
      provider:"http" as const,
      previewReady:outcome.observation?.effectiveAction==="shadow"&&outcome.observation.healthy===true,
      productionDeploymentId:outcome.project.release.environment==="production"?outcome.project.release.deploymentId:undefined,
      boundDeploymentId:outcome.project.release.deploymentId,
      productionHealthReady:outcome.project.release.environment==="production"?outcome.project.release.healthy:undefined,
      boundHealthReady:outcome.project.release.environment!=="production"?outcome.project.release.healthy:undefined,
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
  if(observed){
    const recorded=await recordReleaseOutcomeObservation(outcome.project,observed).catch(()=>undefined);
    if(recorded?.telemetry?.warnings.length){
      console.warn("[outcome-telemetry] release observation completed with warnings",recorded.telemetry.warnings);
    }
  }
  return{
    ...outcome,
    provider:"vercel" as const,
    observedAt:outcome.observation.checkedAt,
    previewReady:outcome.observation.boundDeployment?.state==="READY",
    productionDeploymentId:outcome.observation.productionDeployment?.id,
    boundDeploymentId:outcome.observation.boundDeployment?.id,
    productionHealthReady:outcome.observation.productionHealth.ready,
    boundHealthReady:outcome.observation.boundHealth?.ready,
    observationErrors:outcome.observation.errors,
    rollingRelease:outcome.observation.rollingRelease,
  };
}
