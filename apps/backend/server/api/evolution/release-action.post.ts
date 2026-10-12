import { createError, defineEventHandler, readBody } from "nitro/h3";
import { createEvolutionEvent, VercelReleaseActionRequestSchema,type ReleaseOutcomeTelemetryStatus } from "@evolution/contracts";
import { applyProductionLearningGovernance, applyReleaseResultToProject, htmlProtectionAcceptanceBlocker, projectHasOnlineReleaseTarget, projectUsesConnectorRelease, projectUsesHttpRelease, projectUsesVercelRelease } from "@evolution/core";
import { getServerVercelReleaseConfig } from "../../../src/server-env";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
import { requireActiveReleaseApprovalGrant } from "../../../src/services/release-approval-store";
import { executeServerReleaseProvider } from "../../../src/services/server-release-orchestration";
import {recordConnectorReleaseOutcomeObservation,recordHttpReleaseOutcomeObservation} from "../../../src/services/release-outcome-telemetry";
import {captureReleaseOutcomeTelemetry} from "../../../src/services/release-outcome-status";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

function fail(statusCode:number,statusMessage:string):never{
  throw createError({statusCode,statusMessage});
}

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"release.execute");
  const input=VercelReleaseActionRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)fail(404,"Mission not found");

  const releaseTarget=mission.releaseTarget;
  if(!projectHasOnlineReleaseTarget(mission))fail(409,"Mission 未连接受支持的线上 Release Target");
  const vercelRelease=projectUsesVercelRelease(mission);
  if(vercelRelease){
    const serverConfig=getServerVercelReleaseConfig();
    if(releaseTarget?.projectId&&serverConfig.projectId&&releaseTarget.projectId!==serverConfig.projectId){
      fail(409,"Mission Release Target 与当前 Vercel Project 不一致");
    }
  }

  const candidate=mission.candidates.find((item)=>item.id===input.candidateId)
    ?? (mission.searchChampion?.candidate?.id===input.candidateId?mission.searchChampion.candidate:undefined);
  if(!candidate)fail(404,"Release Candidate not found");
  if(mission.experimentRun.winnerId!==candidate.id)fail(409,"Only the experiment winner can be released");

  let approvalGrantId:string|undefined;
  if(input.action!=="rollback"){
    const contractBlocker=htmlProtectionAcceptanceBlocker(mission);
    if(contractBlocker)fail(409,contractBlocker);
    if(mission.validationRun.recommendation!=="release")fail(409,"Validation did not recommend release");
    if(mission.artifactAcceptance.status!=="passed"||mission.artifactAcceptance.candidateId!==candidate.id){
      fail(409,"Artifact Acceptance is not bound to the Release Candidate");
    }
    if(mission.gates.find((gate)=>gate.id==="artifact-ready")?.status!=="approved")fail(409,"Artifact Ready gate is not approved");
    if(mission.gates.find((gate)=>gate.id==="release-ready")?.status!=="approved")fail(409,"Release Ready gate is not approved");
    try{
      approvalGrantId=(await requireActiveReleaseApprovalGrant({
        missionId:mission.id,
        candidateId:candidate.id,
      })).id;
    }catch(error){
      fail(409,error instanceof Error?error.message:"Release approval is required");
    }
  }

  const mode=releaseTarget?.mode??"progressive";
  if(mode==="preview-promote"&&["canary-5","canary-20","canary-50"].includes(input.action)){
    fail(409,"当前 Release Target 使用 Preview → Promote，不支持 5/20/50 Canary");
  }
  const liveHealthy=mission.release.evidenceMode==="live"
    &&mission.release.healthy===true
    &&mission.release.observationStatus==="healthy";
  if(input.action==="shadow"&&!["idle","promoted","rolled-back"].includes(mission.release.status)){
    fail(409,"Preview Gate 只能从 idle / promoted / rolled-back 开始");
  }
  if(mode==="progressive"){
    const expectedPrevious:Record<"canary-5"|"canary-20"|"canary-50"|"promote",string>={
      "canary-5":"shadow",
      "canary-20":"canary-5",
      "canary-50":"canary-20",
      promote:"canary-50",
    };
    if(input.action in expectedPrevious){
      const previous=expectedPrevious[input.action as keyof typeof expectedPrevious];
      if(mission.release.status!==previous){
        fail(409,`${input.action} 前必须处于 ${previous} 阶段`);
      }
      if(!liveHealthy)fail(409,`${previous} 阶段尚无 live healthy evidence，禁止继续放量`);
    }
  }else if(input.action==="promote"&&mission.release.status!=="shadow"){
    fail(409,"Promote 前必须先通过 Preview Gate");
  }
  if(input.action==="rollback"&&mission.release.status==="idle")fail(409,"Nothing has been released, rollback is not available");

  const artifactHashes=input.action==="rollback"?[]:candidate.artifactSnapshots.map((snapshot)=>{
    if(!snapshot.contentHash)fail(409,"Release Candidate Artifact 缺少 contentHash");
    return {sourceArtifactId:snapshot.sourceArtifactId,contentHash:snapshot.contentHash};
  });
  if(input.action!=="rollback"&&!artifactHashes.length)fail(409,"Release Candidate 没有可绑定的 Artifact Hash");

  const deploymentId=input.action==="rollback"
    ? mission.release.stableDeploymentId
    : input.deploymentId??mission.release.deploymentId;
  if(input.action==="shadow"&&vercelRelease){
    if(!input.deploymentId)fail(409,"Vercel Preview Gate 必须显式选择 Candidate Deployment");
    if(mission.release.deploymentId!==input.deploymentId||mission.release.candidateId!==candidate.id){
      fail(409,"Preview Deployment 尚未与当前 Release Candidate 显式绑定");
    }
  }else if(input.action==="shadow"&&input.deploymentId&&mission.release.deploymentId&&mission.release.deploymentId!==input.deploymentId){
    fail(409,"Shadow deploymentId 与当前 Mission 已绑定 Deployment 不一致");
  }
  if(input.action!=="shadow"&&input.action!=="rollback"
    &&(!deploymentId||deploymentId!==mission.release.deploymentId||mission.release.candidateId!==candidate.id)){
    fail(409,`${input.action} 只能推进已经绑定的同一 Candidate Deployment`);
  }
  if(input.action==="rollback"&&!deploymentId)fail(409,"Rollback 缺少稳定 Deployment ID");

  let result;
  let outcomeTelemetry:ReleaseOutcomeTelemetryStatus|undefined;
  try{
    result=await executeServerReleaseProvider(mission,{
      action:input.action,
      deploymentId,
      stableDeploymentId:mission.release.stableDeploymentId,
      healthPath:releaseTarget?.healthPath,
      artifactHashes,
    });
  }catch(error){
    const code=(error as {code?:string}).code;
    if(vercelRelease&&code==="VERCEL_RELEASE_CREDENTIAL_REQUIRED")fail(503,"Vercel Release 写操作尚未授权：需要 VERCEL_RELEASE_TOKEN");
    if(vercelRelease&&code==="VERCEL_ROLLING_RELEASE_NOT_ENABLED")fail(409,error instanceof Error?error.message:String(error));
    const at=new Date().toISOString();
    const gitCommitMismatch=vercelRelease&&code==="VERCEL_RELEASE_GIT_COMMIT_MISMATCH";
    const recoveryStatus=gitCommitMismatch?"manual-check" as const:"pending" as const;
    const reason=gitCommitMismatch
      ?`[server-release-manual-check] ${input.action} 绑定的 Vercel Deployment 与 exact Git commit 不一致：${error instanceof Error?error.message:String(error)}`
      :`[server-release-provider-pending] ${input.action} 结果未能可靠结算：${error instanceof Error?error.message:String(error)}`;
    const recoveryMission={
      ...mission,
      stage:"release" as const,
      release:{
        ...mission.release,
        recovery:{status:recoveryStatus,action:input.action,reason,at},
      },
      campaign:{...mission.campaign,status:"paused" as const,stopReason:reason},
      updatedAt:at,
    };
    await runtime.missions.save(recoveryMission);
    await runtime.events.append(createEvolutionEvent({
      missionId:mission.id,
      type:"ReleaseChanged",
      source:"manual-release-api",
      payload:{requestedAction:input.action,candidateId:candidate.id,deploymentId,stableDeploymentId:mission.release.stableDeploymentId,recovery:recoveryMission.release.recovery,reason},
    })).catch(()=>undefined);
    if(gitCommitMismatch||(vercelRelease&&code?.startsWith("VERCEL_ROLLING_RELEASE_")))fail(409,error instanceof Error?error.message:String(error));
    throw error;
  }
  try{
    const released=applyReleaseResultToProject({
      project:mission,
      candidate,
      requestedAction:input.action,
      result,
      at:result.observedAt??new Date().toISOString(),
    });
    const governanceAt=result.observedAt??new Date().toISOString();
    const updated=applyProductionLearningGovernance(released,{at:governanceAt,now:Date.parse(governanceAt)});
    await runtime.missions.save(updated);
    if(projectUsesConnectorRelease(mission)){
      outcomeTelemetry=await captureReleaseOutcomeTelemetry(()=>recordConnectorReleaseOutcomeObservation(updated,result));
    }else if(projectUsesHttpRelease(mission)){
      outcomeTelemetry=await captureReleaseOutcomeTelemetry(()=>recordHttpReleaseOutcomeObservation(updated,result));
    }
    await runtime.events.append(createEvolutionEvent({
      missionId:mission.id,
      type:"ReleaseChanged",
      source:"manual-release-api",
      payload:{
        requestedAction:input.action,
        effectiveAction:result.effectiveAction,
        candidateId:candidate.id,
        deploymentId:updated.release.deploymentId,
        stableDeploymentId:updated.release.stableDeploymentId,
        trafficPercent:updated.release.trafficPercent,
        artifactHashes:updated.release.artifactHashes,
        evidenceMode:updated.release.evidenceMode,
        observedAt:updated.release.observedAt,
        healthy:updated.release.healthy,
        observationStatus:updated.release.observationStatus,
        approvalGrantId,
        outcomeTelemetry,
        rollingRelease:"rollingRelease" in result?result.rollingRelease:undefined,
        reason:result.note,
      },
    })).catch(()=>undefined);
  }catch(error){
    const at=new Date().toISOString();
    const reason=`Provider 回执无法绑定 exact Candidate：${error instanceof Error?error.message:String(error)}`;
    const recoveryMission={
      ...mission,
      stage:"release" as const,
      release:{...mission.release,recovery:{status:"manual-check" as const,action:input.action,reason,at,lastObservedAt:result.observedAt}},
      campaign:{...mission.campaign,status:"paused" as const,stopReason:`[server-release-manual-check] ${reason}`},
      updatedAt:at,
    };
    await runtime.missions.save(recoveryMission);
    await runtime.events.append(createEvolutionEvent({
      missionId:mission.id,
      type:"ReleaseChanged",
      source:"manual-release-api",
      payload:{requestedAction:input.action,candidateId:candidate.id,deploymentId:result.deploymentId,stableDeploymentId:result.stableDeploymentId,artifactHashes:result.artifactHashes,evidenceMode:result.evidenceMode,observedAt:result.observedAt,recovery:recoveryMission.release.recovery,reason},
    })).catch(()=>undefined);
    throw error;
  }
  return {...result,outcomeTelemetry};
});
