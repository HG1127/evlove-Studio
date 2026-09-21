import { createError, defineEventHandler, readBody } from "nitro/h3";
import { createEvolutionEvent, VercelReleaseActionRequestSchema, VercelReleaseActionResponseSchema } from "@evolution/contracts";
import { applyProductionLearningGovernance, applyReleaseResultToProject } from "@evolution/core";
import { getServerVercelReleaseConfig } from "../../../src/server-env";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
import { requireActiveReleaseApprovalGrant } from "../../../src/services/release-approval-store";
import { executeVercelReleaseAction } from "../../../src/services/vercel-release";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

function fail(statusCode:number,statusMessage:string):never{
  throw createError({statusCode,statusMessage});
}

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"release.execute");
  const input=VercelReleaseActionRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)fail(404,"Mission not found");

  const releaseTarget=mission.releaseTarget;
  if(releaseTarget?.provider!=="vercel")fail(409,"Mission 未连接 Vercel Release Target");
  const serverConfig=getServerVercelReleaseConfig();
  if(releaseTarget.projectId&&serverConfig.projectId&&releaseTarget.projectId!==serverConfig.projectId){
    fail(409,"Mission Release Target 与当前 Vercel Project 不一致");
  }

  const candidate=mission.candidates.find((item)=>item.id===input.candidateId)
    ?? (mission.searchChampion?.candidate?.id===input.candidateId?mission.searchChampion.candidate:undefined);
  if(!candidate)fail(404,"Release Candidate not found");
  if(mission.experimentRun.winnerId!==candidate.id)fail(409,"Only the experiment winner can be released");

  let approvalGrantId:string|undefined;
  if(input.action!=="rollback"){
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

  const mode=releaseTarget.mode;
  if(mode==="preview-promote"&&["canary-5","canary-20","canary-50"].includes(input.action)){
    fail(409,"当前 Vercel Target 使用 Preview → Promote，不支持 5/20/50 Canary");
  }
  if(input.action==="shadow"&&!["idle","promoted","rolled-back"].includes(mission.release.status)){
    fail(409,"Preview Gate 只能从 idle / promoted / rolled-back 开始");
  }
  if(input.action==="promote"&&mission.release.status!=="shadow")fail(409,"Promote 前必须先通过 Preview Gate");
  if(input.action==="rollback"&&mission.release.status==="idle")fail(409,"Nothing has been released, rollback is not available");

  const artifactHashes=input.action==="rollback"?[]:candidate.artifactSnapshots.map((snapshot)=>{
    if(!snapshot.contentHash)fail(409,"Release Candidate Artifact 缺少 contentHash");
    return {sourceArtifactId:snapshot.sourceArtifactId,contentHash:snapshot.contentHash};
  });
  if(input.action!=="rollback"&&!artifactHashes.length)fail(409,"Release Candidate 没有可绑定的 Artifact Hash");

  const deploymentId=input.action==="rollback"
    ? mission.release.stableDeploymentId
    : input.deploymentId??mission.release.deploymentId;
  if(input.action==="shadow"){
    if(!input.deploymentId)fail(409,"Preview Gate 必须显式选择 Candidate Deployment");
    if(mission.release.deploymentId!==input.deploymentId||mission.release.candidateId!==candidate.id){
      fail(409,"Preview Deployment 尚未与当前 Release Candidate 显式绑定");
    }
  }
  if(input.action==="promote"&&(!deploymentId||deploymentId!==mission.release.deploymentId||mission.release.candidateId!==candidate.id)){
    fail(409,"Promote 只能推进已经通过 Preview Gate 的同一 Candidate Deployment");
  }
  if(input.action==="rollback"&&!deploymentId)fail(409,"Rollback 缺少稳定 Deployment ID");

  let result;
  try{
    result=VercelReleaseActionResponseSchema.parse(await executeVercelReleaseAction({
      action:input.action,
      deploymentId,
      stableDeploymentId:mission.release.stableDeploymentId,
      healthPath:releaseTarget.healthPath,
      artifactHashes,
    }));
  }catch(error){
    const code=(error as {code?:string}).code;
    if(code==="VERCEL_RELEASE_CREDENTIAL_REQUIRED")fail(503,"Vercel Release 写操作尚未授权：需要 VERCEL_RELEASE_TOKEN");
    if(code==="VERCEL_ROLLING_RELEASE_NOT_ENABLED")fail(409,error instanceof Error?error.message:String(error));
    if(input.action==="shadow"||input.action==="promote"||input.action==="rollback"){
      const at=new Date().toISOString();
      const reason=`[server-release-provider-pending] ${input.action} 结果未能可靠结算：${error instanceof Error?error.message:String(error)}`;
      const recoveryMission={
        ...mission,
        stage:"release" as const,
        release:{
          ...mission.release,
          recovery:{status:"pending" as const,action:input.action,reason,at},
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
    }
    throw error;
  }
  if(input.action==="shadow"||input.action==="promote"||input.action==="rollback"){
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
          artifactHashes:updated.release.artifactHashes,
          evidenceMode:updated.release.evidenceMode,
          observedAt:updated.release.observedAt,
          healthy:updated.release.healthy,
          observationStatus:updated.release.observationStatus,
          approvalGrantId,
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
  }
  return result;
});
