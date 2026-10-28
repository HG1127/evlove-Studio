import type {EvolveProject} from "@evolution/contracts";
import {buildServerFailureObservations} from "@evolution/harness";
import {getServerProductionRuntime} from "./production-runtime";
import {serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {readServerHoldoutArtifactFingerprint} from "./server-holdout-artifact-binding";
import {serverRepairMeasuredTextAuthorized} from "./server-ai-repair-consent";

/** Read only explicitly registered sources. No AI, write, global search or source execution. */
export function buildServerFailurePlanningObservations(project:EvolveProject){
  return buildServerFailureObservations(project,{
    readSourceMission:id=>getServerProductionRuntime().missions.get(id),
    fingerprintText:text=>serverArtifactSha256(new TextEncoder().encode(text)),
    verifyFrozenSnapshot:verifyServerCandidateFrozenArtifact,
    readExecutionArtifactFingerprint:({project,candidate,historicalDeploymentSha})=>readServerHoldoutArtifactFingerprint({project,candidate,observationDeploymentSha:historicalDeploymentSha??null}),
    bodyAuthorized:(current,source)=>serverRepairMeasuredTextAuthorized(current)&&serverRepairMeasuredTextAuthorized(source),
  });
}
