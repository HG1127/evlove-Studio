import type { EvolveProject, ReleaseState } from "@evolution/contracts";

function releaseTargetIdentity(target:EvolveProject["releaseTarget"]){
  if(!target)return "none";
  return JSON.stringify({
    provider:target.provider,
    mode:target.mode,
    connectionId:target.connectionId??null,
    projectId:target.projectId??null,
    productionUrl:target.productionUrl??null,
    healthPath:target.healthPath??"/",
  });
}

function emptyReleaseState():ReleaseState{
  return {
    status:"idle",
    trafficPercent:0,
    kpis:[],
    evidenceMode:"none",
    history:[],
  };
}

export function transitionReleaseTarget(
  project:EvolveProject,
  releaseTarget:NonNullable<EvolveProject["releaseTarget"]>,
  at=new Date().toISOString(),
):EvolveProject{
  if(releaseTargetIdentity(project.releaseTarget)===releaseTargetIdentity(releaseTarget)){
    return {...project,releaseTarget,updatedAt:at};
  }
  if(projectHasOnlineReleaseTarget(project)&&["shadow","canary-5","canary-20","canary-50","promoted"].includes(project.release.status)){
    throw new Error(`当前 Release 仍处于 ${project.release.status}，不能静默切换或断开发布平台；请先完成 Rollback / 收口。`);
  }
  return {
    ...project,
    releaseTarget,
    release:emptyReleaseState(),
    gates:project.gates.map((gate)=>gate.id==="release-ready"
      ?{
        ...gate,
        status:"pending" as const,
        approvedAt:undefined,
        note:"Release Target 已变更，旧发布证据与审批不再适用于当前平台；需要重新确认 Release Ready。",
      }
      :gate),
    updatedAt:at,
  };
}

export function projectUsesVercelRelease(project:EvolveProject){
  return project.releaseTarget?.provider==="vercel"&&project.releaseTarget.status==="connected";
}

export function projectUsesHttpRelease(project:EvolveProject){
  return project.releaseTarget?.provider==="http"&&project.releaseTarget.status==="connected";
}

export function projectUsesConnectorRelease(project:EvolveProject){
  if(project.targetConnection?.adapter!=="connector"||project.targetConnection.status!=="connected")return false;
  return project.releaseTarget?.provider==="connector"&&project.releaseTarget.status==="connected";
}

export function projectHasOnlineReleaseTarget(project:EvolveProject){
  return projectUsesVercelRelease(project)||projectUsesHttpRelease(project)||projectUsesConnectorRelease(project);
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
    sourceGitCommitSha:undefined,
    sourceGitBranch:undefined,
    sourceGitRepository:undefined,
    sourceGitPullNumber:undefined,
    sourceGitPullUrl:undefined,
    artifactHash:undefined,
    artifactHashes:undefined,
    environment:undefined,
    observedAt:undefined,
    sampleSize:undefined,
    windowMinutes:undefined,
    recovery:undefined,
  };
}
