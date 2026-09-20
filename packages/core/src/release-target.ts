import type { EvolveProject, ReleaseState } from "@evolution/contracts";

export function projectHasOnlineReleaseTarget(project:EvolveProject){
  if(project.releaseTarget?.provider==="vercel"||project.releaseTarget?.provider==="http")return true;
  return (!project.releaseTarget||project.releaseTarget.provider==="none")&&project.targetConnection.adapter==="http";
}

export function projectHasLiveReleaseDecision(project:EvolveProject){
  if(!projectHasOnlineReleaseTarget(project))return false;
  if(project.release.evidenceMode!=="live")return false;
  if(project.release.status==="rolled-back")return true;
  return project.release.status==="promoted"
    && project.release.healthy!==false
    && project.release.observationStatus!=="observing";
}

export function projectReleaseMode(project:EvolveProject){
  return project.releaseTarget?.mode??"progressive";
}

export function beginReleaseCycle(release:ReleaseState,candidateId:string):ReleaseState{
  const stableDeploymentId = release.status==="promoted"&&release.deploymentId
    ? release.deploymentId
    : release.stableDeploymentId;
  return {
    ...release,
    status:"idle",
    candidateId,
    trafficPercent:0,
    healthy:undefined,
    kpis:[],
    evidenceMode:"none",
    observationStatus:undefined,
    stableDeploymentId,
    deploymentId:undefined,
    artifactHash:undefined,
    artifactHashes:undefined,
    environment:undefined,
    observedAt:undefined,
    sampleSize:undefined,
    windowMinutes:undefined,
  };
}
