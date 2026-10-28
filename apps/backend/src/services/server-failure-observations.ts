import type {ArtifactStorePort,EvolveProject} from "@evolution/contracts";
import {buildServerFailureObservations} from "@evolution/harness";
import {getServerProductionRuntime} from "./production-runtime";
import {serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {readServerHoldoutArtifactFingerprint} from "./server-holdout-artifact-binding";
import {serverRepairMeasuredTextAuthorized} from "./server-ai-repair-consent";
import {getServerArtifactStore} from "./artifact-runtime";

/** Read only explicitly registered sources. No AI, write, global search or source execution. */
export function buildServerFailurePlanningObservations(project:EvolveProject){
  // One preparation uses one physical observation of each immutable Blob. Every
  // verifier still checks its own expected hash/size; no bytes survive this call.
  const reads=new Map<string,Promise<Blob|undefined>>();
  const reader:Pick<ArtifactStorePort,"get">={get:id=>{
    let pending=reads.get(id);
    if(!pending){pending=getServerArtifactStore().get(id);reads.set(id,pending);}
    return pending;
  }};
  return buildServerFailureObservations(project,{
    readSourceMission:id=>getServerProductionRuntime().missions.get(id),
    fingerprintText:text=>serverArtifactSha256(new TextEncoder().encode(text)),
    verifyFrozenSnapshot:snapshot=>verifyServerCandidateFrozenArtifact(snapshot,reader),
    readExecutionArtifactFingerprint:({project,candidate,historicalDeploymentSha})=>readServerHoldoutArtifactFingerprint({project,candidate,observationDeploymentSha:historicalDeploymentSha??null},reader),
    bodyAuthorized:(current,source)=>serverRepairMeasuredTextAuthorized(current)&&serverRepairMeasuredTextAuthorized(source),
  });
}
