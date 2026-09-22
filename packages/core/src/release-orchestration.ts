import type { Candidate, EvolveProject, ReleaseAdapterResult } from "@evolution/contracts";
import { appendReleaseObservation } from "./release-outcome";
import { projectHasLiveReleaseDecision, projectHasOnlineReleaseTarget, projectReleaseMode, projectUsesConnectorRelease, projectUsesHttpRelease, projectUsesVercelRelease } from "./release-target";

export type DurableReleaseAction =
  |"shadow"
  |"canary-5"
  |"canary-20"
  |"canary-50"
  |"promote"
  |"rollback";

export function expectedReleaseTrafficPercent(action:DurableReleaseAction){
  if(action==="canary-5")return 5;
  if(action==="canary-20")return 20;
  if(action==="canary-50")return 50;
  if(action==="promote")return 100;
  return 0;
}

function assertReleaseReceiptSemantics(args:{
  project:EvolveProject;
  action:DurableReleaseAction;
  result:ReleaseAdapterResult;
}){
  const expectedTraffic=expectedReleaseTrafficPercent(args.action);
  if(args.result.trafficPercent!==expectedTraffic){
    throw new Error(`Release receipt trafficPercent ${args.result.trafficPercent} 与 ${args.action} 期望 ${expectedTraffic} 不一致`);
  }
  if(projectReleaseMode(args.project)==="preview-promote"
    &&["canary-5","canary-20","canary-50"].includes(args.action)){
    throw new Error(`preview-promote Release Target 不允许 ${args.action} Canary 回执`);
  }
  if(args.result.ok){
    if(args.result.observationStatus==="healthy"&&args.result.healthy!==true){
      throw new Error("Release receipt 健康状态矛盾：observationStatus=healthy 但 healthy!=true");
    }
    if(args.result.observationStatus==="unhealthy"&&args.result.healthy===true){
      throw new Error("Release receipt 健康状态矛盾：observationStatus=unhealthy 但 healthy=true");
    }
  }
  const stableDeploymentId=args.project.release.stableDeploymentId;
  if(stableDeploymentId&&args.result.stableDeploymentId&&args.result.stableDeploymentId!==stableDeploymentId){
    throw new Error("Release receipt stableDeploymentId 与绑定 stable Deployment 不一致");
  }
}

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
  const vercel=projectUsesVercelRelease(project);
  const http=projectUsesHttpRelease(project);
  const connector=projectUsesConnectorRelease(project);
  if(!vercel&&!http&&!connector)return undefined;
  if(project.gates.find((gate)=>gate.id==="release-ready")?.status!=="approved")return undefined;
  const candidate=currentReleaseCandidate(project);
  if(!candidate)return undefined;
  if(project.release.candidateId!==candidate.id)return undefined;
  if(vercel&&!project.release.deploymentId)return undefined;
  if((http||connector)&&project.release.status!=="idle"&&!project.release.deploymentId)return undefined;
  const mode=projectReleaseMode(project);
  const liveHealthy=project.release.evidenceMode==="live"
    &&project.release.healthy===true
    &&project.release.observationStatus==="healthy";
  const liveUnhealthy=project.release.evidenceMode==="live"
    &&project.release.healthy===false;

  if(project.release.status==="idle")return "shadow";
  if(project.release.status==="promoted"
    &&project.release.recovery?.status==="reconciled"
    &&project.release.recovery.action==="rollback"
    &&project.release.stableDeploymentId)return "rollback";
  if(project.release.status==="shadow"){
    if(!liveHealthy)return undefined;
    return mode==="progressive"?"canary-5":"promote";
  }
  if(mode==="progressive"){
    if(["canary-5","canary-20","canary-50"].includes(project.release.status)
      &&liveUnhealthy
      &&project.release.stableDeploymentId)return "rollback";
    if(project.release.status==="canary-5"&&liveHealthy)return "canary-20";
    if(project.release.status==="canary-20"&&liveHealthy)return "canary-50";
    if(project.release.status==="canary-50"&&liveHealthy)return "promote";
  }
  if(project.release.status==="promoted"&&liveUnhealthy&&project.release.stableDeploymentId)return "rollback";
  return undefined;
}

export function applyReleaseResultToProject(args:{
  project:EvolveProject;
  candidate:Candidate;
  requestedAction:DurableReleaseAction;
  result:ReleaseAdapterResult;
  at?:string;
  observationSource?:"release-action"|"reconcile";
}):EvolveProject{
  const at=args.at??new Date().toISOString();
  const effective=args.result.effectiveAction??args.requestedAction;
  if(!["shadow","canary-5","canary-20","canary-50","promote","rollback"].includes(effective))throw new Error(`Unsupported durable release action: ${effective}`);
  if(effective!==args.requestedAction)throw new Error(`Release Provider effectiveAction ${effective} 与请求 ${args.requestedAction} 不一致`);
  assertReleaseReceiptSemantics({project:args.project,action:effective as DurableReleaseAction,result:args.result});
  if(args.result.evidenceMode!=="live")throw new Error("Release Provider 未返回 live evidence");
  if(!args.result.deploymentId||!args.result.observedAt)throw new Error("Release receipt 缺少 deploymentId / observedAt");
  if(effective!=="rollback"&&!hasExactArtifactHashes(args.candidate,args.result)){
    throw new Error("Release receipt Artifact Hash 与 exact Candidate 不一致");
  }
  if(effective!=="rollback"){
    const boundDeploymentId=args.project.release.deploymentId;
    const mayBindProviderShadow=(projectUsesHttpRelease(args.project)||projectUsesConnectorRelease(args.project))
      &&args.project.release.status==="idle"
      &&effective==="shadow"
      &&!boundDeploymentId;
    if(!boundDeploymentId&&!mayBindProviderShadow){
      throw new Error(`${effective} 缺少预绑定 Candidate Deployment；只有可返回 live deployment receipt 的 Provider 首次 Shadow 可建立绑定`);
    }
    if(boundDeploymentId&&args.result.deploymentId!==boundDeploymentId){
      throw new Error(`${effective} receipt deploymentId 与绑定 Candidate Deployment 不一致`);
    }
  }else if(args.project.release.stableDeploymentId
    &&args.result.deploymentId!==args.project.release.stableDeploymentId){
    throw new Error("rollback receipt deploymentId 与 stable Deployment 不一致");
  }
  const durableAction=effective as DurableReleaseAction;
  const observation= {
    source:args.observationSource??"release-action",
    action:durableAction,
    at:args.result.observedAt,
    candidateId:args.candidate.id,
    deploymentId:args.result.deploymentId,
    stableDeploymentId:args.result.stableDeploymentId??args.project.release.stableDeploymentId,
    artifactHashes:args.result.artifactHashes,
    evidenceMode:"live" as const,
    environment:args.result.environment,
    healthy:args.result.ok&&args.result.healthy===true,
    observationStatus:args.result.ok
      ?args.result.observationStatus
      :args.result.observationStatus==="observing"?"observing" as const:"unhealthy" as const,
    latencyMs:args.result.latencyMs,
    sampleSize:args.result.sampleSize,
    windowMinutes:args.result.windowMinutes,
    reason:args.result.note,
  };
  const status=effective==="promote"
    ?"promoted"
    :effective==="rollback"
      ?"rolled-back"
      :effective;
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
      release:{
        ...args.project.release,
        recovery:undefined,
        observations:appendReleaseObservation(args.project.release.observations,observation),
      },
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
  const newlyPromoted=successfulPromote&&args.project.release.status!=="promoted";
  const settledObservation=args.result.ok
    ?args.result.observationStatus
    :args.result.observationStatus==="observing"?"observing":"unhealthy";
  return {
    ...args.project,
    version:newlyPromoted?`V${Number(args.project.version.replace(/\D/g,"")||"12")+1}`:args.project.version,
    appliedPatches:newlyPromoted?[...args.project.appliedPatches,...args.candidate.patches]:args.project.appliedPatches,
    versions:newlyPromoted
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
      observations:appendReleaseObservation(args.project.release.observations,observation),
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
