import type {
  Candidate,
  EvolveProject,
  VercelReleaseObservation,
} from "@evolution/contracts";
import { expectedReleaseArtifactHashes } from "./release-orchestration";

export type ReleaseReconcileDisposition="safe-to-resume"|"terminal-live-decision"|"manual-check";

export type ReleaseReconcileResult={
  project:EvolveProject;
  disposition:ReleaseReconcileDisposition;
  reason:string;
};

function withRecovery(
  project:EvolveProject,
  args:{
    status:"pending"|"manual-check"|"reconciled";
    reason:string;
    observedAt:string;
  },
){
  return {
    ...project,
    release:{
      ...project.release,
      recovery:{
        status:args.status,
        action:project.release.recovery?.action,
        reason:args.reason,
        at:project.release.recovery?.at??args.observedAt,
        lastObservedAt:args.observedAt,
      },
    },
    updatedAt:args.observedAt,
  } satisfies EvolveProject;
}

function releaseHistory(project:EvolveProject,at:string,note:string){
  return [...project.release.history,{at,action:"reconcile",note}];
}

function settlePromoted(
  project:EvolveProject,
  candidate:Candidate,
  observation:VercelReleaseObservation,
):EvolveProject{
  const at=observation.checkedAt;
  const health=observation.productionHealth;
  const healthy=health.ready;
  const newlyPromoted=project.release.status!=="promoted";
  return {
    ...project,
    version:newlyPromoted
      ?`V${Number(project.version.replace(/\D/g,"")||"12")+1}`
      :project.version,
    appliedPatches:newlyPromoted
      ?[...project.appliedPatches,...candidate.patches]
      :project.appliedPatches,
    versions:newlyPromoted
      ?project.versions.map((version)=>version.id===project.currentVersionId?{...version,releasedAt:at}:version)
      :project.versions,
    release:{
      ...project.release,
      status:"promoted",
      candidateId:candidate.id,
      trafficPercent:100,
      healthy,
      evidenceMode:"live",
      observationStatus:healthy?"healthy":"unhealthy",
      artifactHashes:expectedReleaseArtifactHashes(candidate),
      environment:"production",
      observedAt:at,
      sampleSize:health.checks.length,
      windowMinutes:Math.max(0.01,health.latencyMs/60000),
      recovery:{status:"reconciled",action:project.release.recovery?.action,reason:healthy?"Production 已确认指向 exact Candidate Deployment，且 Health 通过。":"Production 已确认指向 exact Candidate Deployment，但 Health 未通过。",at:project.release.recovery?.at??at,lastObservedAt:at},
      history:releaseHistory(project,at,healthy?"Reconcile：Production 已确认 exact Candidate Deployment，Health 通过。":"Reconcile：Production 指向 exact Candidate Deployment，但 Health 未通过。"),
    },
    stage:healthy?"learning":"release",
    campaign:{...project.campaign,status:"running",stopReason:undefined},
    updatedAt:at,
  };
}

function settleRolledBack(
  project:EvolveProject,
  observation:VercelReleaseObservation,
):EvolveProject{
  const at=observation.checkedAt;
  const health=observation.productionHealth;
  const healthy=health.ready;
  const stableId=project.release.stableDeploymentId;
  return {
    ...project,
    release:{
      ...project.release,
      status:"rolled-back",
      trafficPercent:0,
      healthy,
      evidenceMode:"live",
      observationStatus:healthy?"healthy":"unhealthy",
      deploymentId:stableId,
      environment:"production",
      observedAt:at,
      sampleSize:health.checks.length,
      windowMinutes:Math.max(0.01,health.latencyMs/60000),
      recovery:{status:"reconciled",action:project.release.recovery?.action,reason:healthy?"Production 已确认回到 stable Deployment，Health 通过。":"Production 已确认回到 stable Deployment，但 Health 未通过。",at:project.release.recovery?.at??at,lastObservedAt:at},
      history:releaseHistory(project,at,healthy?"Reconcile：Production 已确认 stable Deployment，Health 通过。":"Reconcile：Production 已回到 stable Deployment，但 Health 未通过。"),
    },
    stage:healthy?"learning":"release",
    campaign:{...project.campaign,status:"running",stopReason:undefined},
    updatedAt:at,
  };
}

function settleShadow(
  project:EvolveProject,
  candidate:Candidate,
  observation:VercelReleaseObservation,
):EvolveProject{
  const at=observation.checkedAt;
  const health=observation.boundHealth;
  const healthy=Boolean(health?.ready);
  return {
    ...project,
    release:{
      ...project.release,
      status:"shadow",
      candidateId:candidate.id,
      trafficPercent:0,
      healthy,
      evidenceMode:"live",
      observationStatus:healthy?"healthy":"unhealthy",
      artifactHashes:expectedReleaseArtifactHashes(candidate),
      environment:"preview",
      observedAt:at,
      sampleSize:health?.checks.length??0,
      windowMinutes:Math.max(0.01,(health?.latencyMs??0)/60000),
      recovery:{status:"reconciled",action:project.release.recovery?.action,reason:healthy?"绑定 Preview 已重新观测且 Health 通过。":"绑定 Preview 已重新观测但 Health 未通过。",at:project.release.recovery?.at??at,lastObservedAt:at},
      history:releaseHistory(project,at,healthy?"Reconcile：绑定 Preview Health 通过。":"Reconcile：绑定 Preview Health 未通过。"),
    },
    stage:"release",
    campaign:{...project.campaign,status:healthy?"running":"paused",stopReason:healthy?undefined:"[server-release-preview-unhealthy] Reconcile 后 Preview Health 仍未通过。"},
    updatedAt:at,
  };
}

export function reconcileReleaseObservation(args:{
  project:EvolveProject;
  candidate:Candidate;
  observation:VercelReleaseObservation;
}):ReleaseReconcileResult{
  const {project,candidate,observation}=args;
  const boundId=project.release.deploymentId;
  const stableId=project.release.stableDeploymentId;
  const productionId=observation.productionDeployment?.id;
  const checkedAt=observation.checkedAt;
  if(project.release.candidateId!==candidate.id){
    const reason="Mission Release Candidate 与当前 exact Candidate 不一致；禁止自动恢复。";
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }
  if(observation.errors.length){
    const reason=`Vercel 只读观测不完整：${observation.errors.join("；")}`;
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }
  if(!boundId){
    const reason="Mission 尚未绑定 exact Preview Deployment；无法 reconcile。";
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }
  if(!productionId){
    const reason="无法确认当前 Production Deployment；禁止推断线上状态。";
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }

  if(productionId===boundId){
    if(project.release.recovery?.action==="shadow"){
      const reason="Preview/Shadow 本身不会切换 Production，但当前 Production 已指向绑定 Candidate；需要人工核对外部发布动作。";
      return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
    }
    if(project.release.recovery?.action==="rollback"&&stableId){
      const health=observation.productionHealth;
      const updated:EvolveProject={
        ...project,
        stage:"release",
        release:{
          ...project.release,
          status:"promoted",
          healthy:health.ready,
          evidenceMode:"live",
          observationStatus:health.ready?"healthy":"unhealthy",
          environment:"production",
          observedAt:checkedAt,
          sampleSize:health.checks.length,
          windowMinutes:Math.max(0.01,health.latencyMs/60000),
          recovery:{
            status:"reconciled",
            action:"rollback",
            reason:"Rollback 请求后 Production 仍指向 Candidate；当前事实已确认，继续执行已授权的 stable rollback。",
            at:project.release.recovery.at,
            lastObservedAt:checkedAt,
          },
          history:releaseHistory(project,checkedAt,"Reconcile：Rollback 请求后 Production 仍在 Candidate；继续 stable rollback。"),
        },
        campaign:{...project.campaign,status:"running",stopReason:undefined},
        updatedAt:checkedAt,
      };
      return {
        project:updated,
        disposition:"safe-to-resume",
        reason:"Rollback 尚未生效；Production 仍在 Candidate，已确认当前真相并可安全继续回滚 stable Deployment。",
      };
    }
    const updated=settlePromoted(project,candidate,observation);
    return {
      project:updated,
      disposition:updated.release.healthy?"terminal-live-decision":"safe-to-resume",
      reason:updated.release.healthy
        ?"Reconcile 已确认 Promote 成功且 Production Health 通过。"
        :"Reconcile 已确认 Production 在 Candidate Deployment，但 Health 异常；可安全进入 Rollback。",
    };
  }

  if(!stableId
    &&project.release.recovery?.action==="shadow"
    &&observation.boundDeployment?.id===boundId){
    const captured={
      ...project,
      release:{...project.release,stableDeploymentId:productionId},
    };
    const updated=settleShadow(captured,candidate,observation);
    return {
      project:updated,
      disposition:updated.release.healthy?"safe-to-resume":"manual-check",
      reason:updated.release.healthy
        ?"Preview Gate 不会修改 Production；已从只读观测捕获当前 Production 作为 stable baseline，并确认绑定 Preview Health 通过。"
        :"已捕获当前 Production 作为 stable baseline，但绑定 Preview Health 未通过。",
    };
  }

  if(stableId&&productionId===stableId){
    if(project.release.status==="promoted"||project.release.status==="rolled-back"||project.release.recovery?.action==="rollback"){
      const updated=settleRolledBack(project,observation);
      return {
        project:updated,
        disposition:updated.release.healthy?"terminal-live-decision":"manual-check",
        reason:updated.release.healthy
          ?"Reconcile 已确认 Production 回到 stable Deployment，Rollback 终态成立。"
          :"Production 已回到 stable Deployment，但 Health 未通过，需要人工核对。",
      };
    }
    if(project.release.status==="idle"||project.release.status==="shadow"||project.release.recovery?.action==="shadow"){
      if(!observation.boundDeployment||observation.boundDeployment.id!==boundId){
        const reason="无法确认绑定 Preview Deployment；禁止自动恢复 Preview Gate。";
        return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
      }
      const updated=settleShadow(project,candidate,observation);
      return {
        project:updated,
        disposition:updated.release.healthy?"safe-to-resume":"manual-check",
        reason:updated.release.healthy
          ?"Production 仍在 stable Deployment；绑定 Preview Health 已重新确认，可安全继续 Promote。"
          :"Production 仍稳定，但绑定 Preview Health 未通过。",
      };
    }
    const reason="Production 仍在 stable Deployment，但 Mission 处于不确定的 Promote 恢复状态；需要人工核对后决定是否重试。";
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }

  const reason=`当前 Production Deployment ${productionId} 既不是绑定 Candidate ${boundId}，也不是已知 stable ${stableId??"unknown"}；禁止自动改写 Mission。`;
  return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
}
