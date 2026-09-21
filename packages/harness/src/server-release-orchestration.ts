import type { EvolveProject, ReleaseAdapterResult } from "@evolution/contracts";
import {
  applyProductionLearningGovernance,
  applyReleaseResultToProject,
  currentReleaseCandidate,
  expectedReleaseArtifactHashes,
  nextDurableReleaseAction,
  projectHasLiveReleaseDecision,
  type DurableReleaseAction,
} from "@evolution/core";

export type ServerReleasePorts={
  authorize(args:{
    action:Exclude<DurableReleaseAction,"rollback">;
    candidateId:string;
  }):Promise<{ok:boolean;reason?:string}>;
  execute(args:{
    action:DurableReleaseAction;
    deploymentId:string;
    stableDeploymentId?:string;
    healthPath?:string;
    artifactHashes:Array<{sourceArtifactId:string;contentHash:string}>;
  }):Promise<ReleaseAdapterResult>;
};

export type ServerReleaseOutcome={
  control:"continue"|"stop";
  project:EvolveProject;
  action?:DurableReleaseAction;
  terminal:boolean;
  reason:string;
};

function pause(
  project:EvolveProject,
  reason:string,
  recovery?:{status:"pending"|"manual-check";action?:DurableReleaseAction},
):ServerReleaseOutcome{
  const at=new Date().toISOString();
  return {
    control:"stop",
    project:{
      ...project,
      stage:"release",
      release:recovery?{
        ...project.release,
        recovery:{
          status:recovery.status,
          action:recovery.action,
          reason,
          at,
          lastObservedAt:project.release.recovery?.lastObservedAt,
        },
      }:project.release,
      campaign:{
        ...project.campaign,
        status:"paused",
        stopReason:reason,
        schedule:{...project.campaign.schedule,enabled:false,nextRunAt:undefined},
      },
      updatedAt:at,
    },
    action:recovery?.action,
    terminal:false,
    reason,
  };
}

export async function runServerReleaseOrchestration(
  project:EvolveProject,
  ports:ServerReleasePorts,
  options?:{now?:()=>string},
):Promise<ServerReleaseOutcome>{
  const candidate=currentReleaseCandidate(project);
  if(!candidate)return pause(project,"[server-release-candidate-pending] 找不到 exact Release Candidate。");
  if(project.gates.find((gate)=>gate.id==="release-ready")?.status!=="approved"){
    return pause(project,"[server-release-authorization-pending] Release Ready 尚未获得人工授权。");
  }
  const action=nextDurableReleaseAction(project);
  if(!action){
    if(projectHasLiveReleaseDecision(project)){
      return {control:"continue",project,terminal:true,reason:"线上 Release 已有真实终态证据。"};
    }
    if(project.release.status==="shadow"&&project.release.healthy===false){
      return pause(project,"[server-release-preview-unhealthy] Preview Health Gate 未通过；Production 未切换，保留稳定版本与当前 Candidate 证据。",{status:"pending",action:"shadow"});
    }
    if(project.release.status==="promoted"&&project.release.healthy===false&&!project.release.stableDeploymentId){
      return pause(project,"[server-release-rollback-unavailable] Production Health 异常但缺少 stableDeploymentId；禁止自动猜测回滚目标。",{status:"manual-check",action:"promote"});
    }
    return pause(project,"[server-release-binding-pending] 需要显式绑定当前 Candidate 的 READY Preview Deployment，或当前 Release 状态暂不支持自动推进。");
  }
  if(action!=="rollback"){
    let authorization:{ok:boolean;reason?:string};
    try{
      authorization=await ports.authorize({action,candidateId:candidate.id});
    }catch(error){
      return pause(project,`[server-release-authorization-pending] Release Approval 无法验证：${error instanceof Error?error.message:String(error)}`);
    }
    if(!authorization.ok){
      return pause(project,`[server-release-authorization-pending] ${authorization.reason??"Release Approval 已过期、撤销或与当前 Candidate 不匹配。"}`);
    }
  }
  const deploymentId=action==="rollback"?project.release.stableDeploymentId:project.release.deploymentId;
  if(!deploymentId)return pause(project,`[server-release-binding-pending] ${action} 缺少显式 deploymentId。`);

  let receipt:ReleaseAdapterResult;
  try{
    receipt=await ports.execute({
      action,
      deploymentId,
      stableDeploymentId:project.release.stableDeploymentId,
      healthPath:project.releaseTarget?.healthPath,
      artifactHashes:action==="rollback"?[]:expectedReleaseArtifactHashes(candidate),
    });
  }catch(error){
    return pause(project,`[server-release-provider-pending] ${action} 执行结果未能可靠结算：${error instanceof Error?error.message:String(error)}。禁止自动重试生产副作用，请先核对 Production 状态。`,{status:"pending",action});
  }

  let updated:EvolveProject;
  try{
    updated=applyReleaseResultToProject({
      project,
      candidate,
      requestedAction:action,
      result:receipt,
      at:options?.now?.()??new Date().toISOString(),
    });
  }catch(error){
    return pause(project,`[server-release-receipt-invalid] Provider 回执无法绑定 exact Candidate：${error instanceof Error?error.message:String(error)}`,{status:"manual-check",action});
  }
  const governed=applyProductionLearningGovernance(updated,{at:options?.now?.()??new Date().toISOString()});

  if(action==="shadow"&&(!receipt.ok||receipt.healthy!==true||receipt.observationStatus!=="healthy")){
    return pause(governed,"[server-release-preview-unhealthy] Preview Health Gate 未通过；没有切换 Production。",{status:"pending",action:"shadow"});
  }
  if(action==="promote"&&(!receipt.ok||receipt.healthy!==true||receipt.observationStatus!=="healthy")){
    if(governed.release.stableDeploymentId){
      return {control:"continue",project:governed,action,terminal:false,reason:"Promote 后 Production Health 未通过；已保存真实状态，下一 Durable Step 将回滚 stable Deployment。"};
    }
    return pause(governed,"[server-release-rollback-unavailable] Promote 后 Production Health 未通过且缺少 stableDeploymentId。",{status:"manual-check",action:"promote"});
  }
  if(action==="rollback"&&(!receipt.ok||receipt.healthy!==true||receipt.observationStatus!=="healthy")){
    return pause(governed,"[server-release-rollback-unhealthy] Rollback 已执行但 Production Health 尚未确认；禁止宣称已安全恢复。",{status:"pending",action:"rollback"});
  }

  return {
    control:"continue",
    project:{
      ...governed,
      campaign:{...governed.campaign,status:"running",stopReason:undefined},
    },
    action,
    terminal:projectHasLiveReleaseDecision(governed),
    reason:action==="shadow"
      ?"Preview Health Gate 已通过；下一 Durable Step 将推进同一 Deployment 到 Production。"
      : action==="promote"
        ?"Production Promote 与 Health Gate 已确认；进入 Outcome Learning。"
        :"Production Rollback 与 Health Gate 已确认；进入 Outcome Learning。",
  };
}
