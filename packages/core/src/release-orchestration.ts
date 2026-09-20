import type { Candidate, EvolveProject, ReleaseAdapterResult } from "@evolution/contracts";
import { projectHasLiveReleaseDecision, projectHasOnlineReleaseTarget, projectReleaseMode } from "./release-target";

export type DurableReleaseAction = "shadow" | "promote" | "rollback";

export function currentReleaseCandidate(project:EvolveProject):Candidate|undefined{
  const id=project.experimentRun.winnerId??project.searchChampion?.candidate?.id;
  const champion=project.searchChampion?.candidate;
  return project.candidates.find((candidate)=>candidate.id===id)
    ??(champion?.id===id?champion:undefined);
}

export function expectedReleaseArtifactHashes(candidate:Candidate){
  return candidate.artifactSnapshots.map((snapshot)=>{
    if(!snapshot.contentHash)throw new Error(`Release Candidate Artifact ${snapshot.sourceArtifactId} 缺少 contentHash`);
    return {sourceArtifactId:snapshot.sourceArtifactId,contentHash:snapshot.contentHash};
  });
}

function hasExactArtifactHashes(candidate:Candidate,result:ReleaseAdapterResult){
  const expected=expectedReleaseArtifactHashes(candidate);
  const received=result.artifactHashes
    ??(expected.length===1&&result.artifactHash?[{sourceArtifactId:expected[0]!.sourceArtifactId,contentHash:result.artifactHash}]:[]);
  return expected.length>0&&expected.every((item)=>received.some((receipt)=>receipt.sourceArtifactId===item.sourceArtifactId&&receipt.contentHash===item.contentHash));
}

export function nextDurableReleaseAction(project:EvolveProject):DurableReleaseAction|undefined{
  if(!projectHasOnlineReleaseTarget(project)||projectHasLiveReleaseDecision(project))return undefined;
  if(project.releaseTarget?.provider!=="vercel"||projectReleaseMode(project)!=="preview-promote")return undefined;
  if(project.gates.find((gate)=>gate.id==="release-ready")?.status!=="approved")return undefined;
  const candidate=currentReleaseCandidate(project);
  if(!candidate)return undefined;
  if(project.release.candidateId!==candidate.id||!project.release.deploymentId)return undefined;

  if(project.release.status==="idle")return "shadow";
  if(project.release.status==="promoted"
    &&project.release.recovery?.status==="reconciled"
    &&project.release.recovery.action==="rollback"
    &&project.release.stableDeploymentId)return "rollback";
  if(project.release.status==="shadow"){
    return project.release.evidenceMode==="live"
      &&project.release.healthy===true
      &&project.release.observationStatus==="healthy"
      ?"promote"
      :undefined;
  }
  if(project.release.status==="promoted"
    &&project.release.evidenceMode==="live"
    &&project.release.healthy===false
    &&project.release.stableDeploymentId)return "rollback";
  return undefined;
}

export function applyReleaseResultToProject(args:{
  project:EvolveProject;
  candidate:Candidate;
  requestedAction:DurableReleaseAction;
  result:ReleaseAdapterResult;
  at?:string;
}):EvolveProject{
  const at=args.at??new Date().toISOString();
  const effective=args.result.effectiveAction??args.requestedAction;
  if(!["shadow","promote","rollback"].includes(effective))throw new Error(`Unsupported durable release action: ${effective}`);
  if(effective!==args.requestedAction)throw new Error(`Release Provider effectiveAction ${effective} 与请求 ${args.requestedAction} 不一致`);
  if(args.result.evidenceMode!=="live")throw new Error("Release Provider 未返回 live evidence");
  if(!args.result.deploymentId||!args.result.observedAt)throw new Error("Release receipt 缺少 deploymentId / observedAt");
  if(effective!=="rollback"&&!hasExactArtifactHashes(args.candidate,args.result)){
    throw new Error("Release receipt Artifact Hash 与 exact Candidate 不一致");
  }
  if(effective==="promote"&&args.result.deploymentId!==args.project.release.deploymentId){
    throw new Error("Promote receipt deploymentId 与 Preview 绑定不一致");
  }
  const status=effective==="shadow"?"shadow":effective==="promote"?"promoted":"rolled-back";
  if(args.project.release.status===status
    &&args.project.release.candidateId===args.candidate.id
    &&args.project.release.deploymentId===args.result.deploymentId
    &&args.project.release.observedAt===args.result.observedAt
    &&args.project.release.evidenceMode==="live"){
    const recovering=Boolean(args.project.release.recovery)
      ||(args.project.campaign.stopReason??"").startsWith("[server-release-");
    if(!recovering)return args.project;
    return {
      ...args.project,
      release:{...args.project.release,recovery:undefined},
      campaign:(args.project.campaign.stopReason??"").startsWith("[server-release-")
        ?{...args.project.campaign,status:"running",stopReason:undefined}
        :args.project.campaign,
      updatedAt:at,
    };
  }

  const successfulPromote=effective==="promote"
    &&args.result.ok
    &&args.result.healthy===true
    &&args.result.observationStatus==="healthy";
  const successfulRollback=effective==="rollback"
    &&args.result.ok
    &&args.result.healthy===true
    &&args.result.observationStatus==="healthy";
  const settledHealthy=args.result.ok&&args.result.healthy===true;
  const settledObservation=args.result.ok
    ?args.result.observationStatus
    :args.result.observationStatus==="observing"?"observing":"unhealthy";
  return {
    ...args.project,
    version:successfulPromote?`V${Number(args.project.version.replace(/\D/g,"")||"12")+1}`:args.project.version,
    appliedPatches:successfulPromote?[...args.project.appliedPatches,...args.candidate.patches]:args.project.appliedPatches,
    versions:successfulPromote
      ?args.project.versions.map((version)=>version.id===args.project.currentVersionId?{...version,releasedAt:at}:version)
      :args.project.versions,
    release:{
      ...args.project.release,
      status,
      candidateId:args.candidate.id,
      trafficPercent:args.result.trafficPercent,
      healthy:settledHealthy,
      observationStatus:settledObservation,
      kpis:args.result.kpis,
      evidenceMode:"live",
      deploymentId:args.result.deploymentId,
      stableDeploymentId:args.result.stableDeploymentId??args.project.release.stableDeploymentId,
      artifactHash:args.result.artifactHash,
      artifactHashes:args.result.artifactHashes,
      environment:args.result.environment,
      observedAt:args.result.observedAt,
      sampleSize:args.result.sampleSize,
      windowMinutes:args.result.windowMinutes,
      recovery:undefined,
      history:[...args.project.release.history,{
        at,
        action:effective,
        note:args.requestedAction===effective?args.result.note:`${args.requestedAction} → ${effective}：${args.result.note}`,
        candidateId:args.candidate.id,
        deploymentId:args.result.deploymentId,
        stableDeploymentId:args.result.stableDeploymentId??args.project.release.stableDeploymentId,
        artifactHashes:args.result.artifactHashes,
        evidenceMode:"live",
        environment:args.result.environment,
        observedAt:args.result.observedAt,
        healthy:settledHealthy,
        observationStatus:settledObservation,
        reason:args.result.note,
      }],
    },
    campaign:(args.project.campaign.stopReason??"").startsWith("[server-release-")
      ?{...args.project.campaign,status:"running",stopReason:undefined}
      :args.project.campaign,
    stage:successfulPromote||successfulRollback?"learning":"release",
    updatedAt:at,
  };
}
