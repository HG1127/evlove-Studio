import type { EvolveProject, ReleaseState } from "@evolution/contracts";

export function projectHasOnlineReleaseTarget(project:EvolveProject){
  if(project.releaseTarget?.provider==="vercel"||project.releaseTarget?.provider==="http")return true;
  return (!project.releaseTarget||project.releaseTarget.provider==="none")&&project.targetConnection.adapter==="http";
}

export function projectHasLiveReleaseDecision(project:EvolveProject){
  if(!projectHasOnlineReleaseTarget(project))return false;
  const currentCandidateId=project.experimentRun.winnerId??project.searchChampion?.candidate?.id;
  if(!currentCandidateId||project.release.candidateId!==currentCandidateId)return false;
  if(project.release.recovery?.status==="pending"||project.release.recovery?.status==="manual-check")return false;
  if(project.release.recovery?.action==="rollback"&&project.release.status!=="rolled-back")return false;
  if(project.release.evidenceMode!=="live")return false;
  if(!["promoted","rolled-back"].includes(project.release.status))return false;
  return project.release.healthy===true&&project.release.observationStatus==="healthy";
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
    recovery:undefined,
  };
}
