import type {
  Candidate,
  EvolveProject,
  ReleaseAdapterResult,
  VercelReleaseObservation,
} from "@evolution/contracts";
import { appendReleaseObservation } from "./release-outcome";
import {applyReleaseResultToProject, expectedReleaseArtifactHashes} from "./release-orchestration";
import {projectHasLiveReleaseDecision} from "./release-target";

export type ReleaseReconcileDisposition="safe-to-resume"|"terminal-live-decision"|"manual-check";

export type ReleaseReconcileResult={
  project:EvolveProject;
  disposition:ReleaseReconcileDisposition;
  reason:string;
};

export function reconcileHttpReleaseObservation(args:{
  project:EvolveProject;
  candidate:Candidate;
  observation:ReleaseAdapterResult;
}):ReleaseReconcileResult{
  const observedAt=args.observation.observedAt??new Date().toISOString();
  const action=args.observation.effectiveAction;
  if(!action){
    const reason="HTTP Observe receipt 缺少 effectiveAction；无法确认外部真实 Release 状态。";
    return {project:withRecovery(args.project,{status:"manual-check",reason,observedAt}),disposition:"manual-check",reason};
  }
  try{
    let project=applyReleaseResultToProject({
      project:args.project,
      candidate:args.candidate,
      requestedAction:action,
      result:args.observation,
      at:observedAt,
      observationSource:"reconcile",
    });
    if(args.project.release.recovery?.action==="rollback"&&action!=="rollback"){
      project={
        ...project,
        release:{
          ...project.release,
          recovery:{
            status:"reconciled",
            action:"rollback",
            reason:"HTTP Observe 已确认此前 rollback 未生效；当前状态已只读核实，可安全重试 rollback。",
            at:args.project.release.recovery.at,
            lastObservedAt:observedAt,
          },
        },
      };
    }
    const terminal=projectHasLiveReleaseDecision(project);
    const reason=terminal
      ?`HTTP Observe 已确认 live ${project.release.status} 终态。`
      :`HTTP Observe 已确认当前 live ${project.release.status} 状态，可从已观测状态继续。`;
    return{project,disposition:terminal?"terminal-live-decision":"safe-to-resume",reason};
  }catch(error){
    const reason=`HTTP Observe receipt 无法安全结算：${error instanceof Error?error.message:String(error)}`;
    return {project:withRecovery(args.project,{status:"manual-check",reason,observedAt,action}),disposition:"manual-check",reason};
  }
}

function withRecovery(
  project:EvolveProject,
  args:{
    status:"pending"|"manual-check"|"reconciled";
    reason:string;
    observedAt:string;
    action?:"shadow"|"canary-5"|"canary-20"|"canary-50"|"promote"|"rollback";
  },
){
  return {
    ...project,
    release:{
      ...project.release,
      recovery:{
        status:args.status,
        action:args.action??project.release.recovery?.action,
        reason:args.reason,
        at:project.release.recovery?.at??args.observedAt,
        lastObservedAt:args.observedAt,
      },
    },
    updatedAt:args.observedAt,
  } satisfies EvolveProject;
}

function releaseHistory(
  project:EvolveProject,
  at:string,
  note:string,
  overrides?:{
    candidateId?:string;
    deploymentId?:string;
    artifactHashes?:Array<{sourceArtifactId:string;contentHash:string}>;
    healthy?:boolean;
    observationStatus?:"observing"|"healthy"|"unhealthy";
    environment?:string;
  },
){
  return [...project.release.history,{
    at,
    action:"reconcile",
    note,
    candidateId:overrides?.candidateId??project.release.candidateId,
    deploymentId:overrides?.deploymentId??project.release.deploymentId,
    stableDeploymentId:project.release.stableDeploymentId,
    artifactHashes:overrides?.artifactHashes??project.release.artifactHashes,
    evidenceMode:"live" as const,
    environment:overrides?.environment??project.release.environment,
    observedAt:at,
    healthy:overrides?.healthy??project.release.healthy,
    observationStatus:overrides?.observationStatus??project.release.observationStatus,
    reason:note,
  }];
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
      history:releaseHistory(project,at,healthy?"Reconcile：Production 已确认 exact Candidate Deployment，Health 通过。":"Reconcile：Production 指向 exact Candidate Deployment，但 Health 未通过。",{candidateId:candidate.id,deploymentId:project.release.deploymentId,artifactHashes:expectedReleaseArtifactHashes(candidate),healthy,observationStatus:healthy?"healthy":"unhealthy",environment:"production"}),
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
      history:releaseHistory(project,at,healthy?"Reconcile：Production 已确认 stable Deployment，Health 通过。":"Reconcile：Production 已回到 stable Deployment，但 Health 未通过。",{deploymentId:stableId,healthy,observationStatus:healthy?"healthy":"unhealthy",environment:"production"}),
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
      history:releaseHistory(project,at,healthy?"Reconcile：绑定 Preview Health 通过。":"Reconcile：绑定 Preview Health 未通过。",{candidateId:candidate.id,deploymentId:project.release.deploymentId,artifactHashes:expectedReleaseArtifactHashes(candidate),healthy,observationStatus:healthy?"healthy":"unhealthy",environment:"preview"}),
    },
    stage:"release",
    campaign:{...project.campaign,status:healthy?"running":"paused",stopReason:healthy?undefined:"[server-release-preview-unhealthy] Reconcile 后 Preview Health 仍未通过。"},
    updatedAt:at,
  };
}

function settleCanary(
  project:EvolveProject,
  candidate:Candidate,
  observation:VercelReleaseObservation,
  args:{status:"canary-5"|"canary-20"|"canary-50";trafficPercent:5|20|50;stableDeploymentId:string},
):EvolveProject{
  const at=observation.checkedAt;
  const candidateHealth=observation.boundHealth;
  const stableHealth=observation.productionHealth;
  const healthy=Boolean(candidateHealth?.ready&&stableHealth.ready);
  return {
    ...project,
    release:{
      ...project.release,
      status:args.status,
      candidateId:candidate.id,
      trafficPercent:args.trafficPercent,
      healthy,
      evidenceMode:"live",
      observationStatus:healthy?"healthy":"unhealthy",
      stableDeploymentId:args.stableDeploymentId,
      artifactHashes:expectedReleaseArtifactHashes(candidate),
      environment:"production-canary",
      observedAt:at,
      sampleSize:(candidateHealth?.checks.length??0)+stableHealth.checks.length,
      windowMinutes:Math.max(0.01,Math.max(candidateHealth?.latencyMs??0,stableHealth.latencyMs)/60000),
      recovery:{
        status:"reconciled",
        action:project.release.recovery?.action,
        reason:healthy
          ?`Reconcile 已确认 ${args.trafficPercent}% Canary 与 stable/candidate Health 均通过。`
          :`Reconcile 已确认 ${args.trafficPercent}% Canary，但 stable 或 candidate Health 未通过。`,
        at:project.release.recovery?.at??at,
        lastObservedAt:at,
      },
      history:releaseHistory(
        project,
        at,
        healthy
          ?`Reconcile：Vercel Rolling Release 已确认 ${args.trafficPercent}% Canary，Health 通过。`
          :`Reconcile：Vercel Rolling Release 已确认 ${args.trafficPercent}% Canary，但 Health 未通过。`,
        {
          candidateId:candidate.id,
          deploymentId:project.release.deploymentId,
          artifactHashes:expectedReleaseArtifactHashes(candidate),
          healthy,
          observationStatus:healthy?"healthy":"unhealthy",
          environment:"production-canary",
        },
      ),
    },
    stage:"release",
    campaign:{...project.campaign,status:"running",stopReason:undefined},
    updatedAt:at,
  };
}

export function reconcileReleaseObservation(args:{
  project:EvolveProject;
  candidate:Candidate;
  observation:VercelReleaseObservation;
}):ReleaseReconcileResult{
  const {candidate,observation}=args;
  const checkedAt=observation.checkedAt;
  const expectedGitCommit=args.project.release.sourceGitCommitSha;
  const originalBoundId=args.project.release.deploymentId;
  const discoveredCommit=observation.boundDeployment?.meta?.githubCommitSha;
  if(expectedGitCommit&&observation.boundDeployment
    &&discoveredCommit!==expectedGitCommit){
    const reason=`Vercel Preview 的 githubCommitSha ${String(discoveredCommit??"missing")} 与 Mission exact Git commit ${expectedGitCommit} 不一致；禁止自动绑定。`;
    return {
      project:withRecovery(args.project,{status:"manual-check",reason,observedAt:checkedAt}),
      disposition:"manual-check",
      reason,
    };
  }
  const autoDiscoveredId=!originalBoundId&&expectedGitCommit&&observation.boundDeployment
    ?observation.boundDeployment.id
    :undefined;
  const autoBinding=Boolean(autoDiscoveredId);
  const sourceProject:EvolveProject=autoBinding?{
    ...args.project,
    release:{
      ...args.project.release,
      candidateId:candidate.id,
      deploymentId:autoDiscoveredId,
      recovery:{
        status:"pending",
        action:"shadow",
        reason:`已按 exact Git commit ${expectedGitCommit} 唯一发现 Vercel Preview ${autoDiscoveredId}，等待 READY/Health 确认。`,
        at:checkedAt,
        lastObservedAt:checkedAt,
      },
    },
    updatedAt:checkedAt,
  }:args.project;
  const boundId=sourceProject.release.deploymentId;
  const stableId=sourceProject.release.stableDeploymentId;
  const candidateDeploymentId=sourceProject.release.status==="rolled-back"
    ?[...sourceProject.release.history].reverse().find((entry)=>entry.candidateId===candidate.id&&entry.action==="promote")?.deploymentId
    :boundId;
  const productionId=observation.productionDeployment?.id;
  const recoveryAction=sourceProject.release.recovery?.action;
  const previewObservation=(recoveryAction==="shadow"
      ||(!recoveryAction&&(sourceProject.release.status==="idle"||sourceProject.release.status==="shadow")))
    &&Boolean(observation.boundDeployment);
  const observedHealth=previewObservation
    ?observation.boundHealth
    :observation.productionHealth;
  const observedDeploymentId=previewObservation
    ?observation.boundDeployment?.id
    :productionId??sourceProject.release.deploymentId;
  const observedEnvironment=previewObservation?"preview":"production";
  const observedCandidateArtifact=Boolean(candidateDeploymentId)&&observedDeploymentId===candidateDeploymentId;
  const project:EvolveProject={
    ...sourceProject,
    release:{
      ...sourceProject.release,
      observations:appendReleaseObservation(sourceProject.release.observations,{
        source:"reconcile",
        action:"reconcile",
        at:checkedAt,
        candidateId:candidate.id,
        deploymentId:observedDeploymentId,
        stableDeploymentId:stableId,
        artifactHashes:observedCandidateArtifact?expectedReleaseArtifactHashes(candidate):undefined,
        evidenceMode:"live",
        environment:observedEnvironment,
        healthy:observedHealth?.ready,
        observationStatus:observedHealth?observedHealth.ready?"healthy":"unhealthy":undefined,
        latencyMs:observedHealth?.latencyMs,
        sampleSize:observedHealth?.checks.length,
        windowMinutes:observedHealth?Math.max(0.01,observedHealth.latencyMs/60000):undefined,
        reason:observation.errors.length
          ?`Reconcile observation incomplete: ${observation.errors.join("；")}`
          :`Reconcile observed ${observedEnvironment} deployment ${observedDeploymentId??"unknown"}.`,
      }),
    },
  };
  if(project.release.candidateId!==candidate.id){
    const reason="Mission Release Candidate 与当前 exact Candidate 不一致；禁止自动恢复。";
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }
  if(observation.errors.length){
    const reason=`Vercel 只读观测不完整：${observation.errors.join("；")}`;
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }
  if(expectedGitCommit&&!boundId){
    const reason=`尚未发现 exact Git commit ${expectedGitCommit} 对应的唯一 Vercel Preview；继续等待 Git Integration 创建 Deployment。`;
    return {
      project:withRecovery(project,{status:"pending",action:"shadow",reason,observedAt:checkedAt}),
      disposition:"safe-to-resume",
      reason,
    };
  }
  const observedBoundDeployment=observation.boundDeployment;
  if(expectedGitCommit&&observedBoundDeployment&&observedBoundDeployment.id===boundId
    &&observedBoundDeployment.state!=="READY"){
    if(["ERROR","CANCELED","CANCELLED","DELETED"].includes(observedBoundDeployment.state.toUpperCase())){
      const reason=`exact Git commit ${expectedGitCommit} 对应的 Vercel Preview ${boundId} 已进入失败终态 ${observedBoundDeployment.state}；禁止继续 Release。`;
      return {
        project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),
        disposition:"manual-check",
        reason,
      };
    }
    const reason=`已按 exact Git commit ${expectedGitCommit} 绑定 Vercel Preview ${boundId}，当前状态 ${observedBoundDeployment.state}；等待 READY 后再执行 Preview Health。`;
    return {
      project:withRecovery(project,{status:"pending",action:"shadow",reason,observedAt:checkedAt}),
      disposition:"safe-to-resume",
      reason,
    };
  }
  const rolling=observation.rollingRelease;
  if(rolling?.active){
    if(rolling.candidateDeploymentId!==boundId){
      const reason=`Active Rolling Release candidate ${rolling.candidateDeploymentId??"unknown"} 与 Mission 绑定 Candidate Deployment ${boundId??"unknown"} 不一致。`;
      return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
    }
    if(!rolling.stableDeploymentId){
      const reason="Active Rolling Release 缺少 stable/current deployment identity；禁止自动续跑。";
      return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
    }
    if(stableId&&stableId!==rolling.stableDeploymentId){
      const reason=`Rolling Release stable ${rolling.stableDeploymentId} 与 Mission stable ${stableId} 不一致。`;
      return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
    }
    const stage=rolling.currentPercentage===5
      ?{status:"canary-5" as const,trafficPercent:5 as const}
      :rolling.currentPercentage===20
        ?{status:"canary-20" as const,trafficPercent:20 as const}
        :rolling.currentPercentage===50
          ?{status:"canary-50" as const,trafficPercent:50 as const}
          :undefined;
    if(!stage){
      const reason=`Active Rolling Release 当前流量阶段 ${rolling.currentPercentage??"unknown"}% 不在受控 5/20/50 阶段。`;
      return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
    }
    const candidateDeployment=observation.boundDeployment;
    if(!candidateDeployment||candidateDeployment.id!==boundId||!observation.boundHealth){
      const reason="Active Rolling Release 无法确认绑定 Candidate Deployment 与 Health；禁止自动续跑。";
      return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
    }
    const withStable:EvolveProject={
      ...project,
      release:{...project.release,stableDeploymentId:rolling.stableDeploymentId},
    };
    const updated=settleCanary(withStable,candidate,observation,{
      ...stage,
      stableDeploymentId:rolling.stableDeploymentId,
    });
    return {
      project:updated,
      disposition:"safe-to-resume",
      reason:updated.release.healthy
        ?`Reconcile 已恢复 ${stage.trafficPercent}% Canary 真值，可安全继续下一阶段。`
        :`Reconcile 已恢复 ${stage.trafficPercent}% Canary 真值且 Health 异常，可安全进入 stable rollback。`,
    };
  }
  if(!boundId){
    const reason="Mission 尚未绑定 exact Preview Deployment；无法 reconcile。";
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }
  if(!productionId){
    const reason="无法确认当前 Production Deployment；禁止推断线上状态。";
    return {project:withRecovery(project,{status:"manual-check",reason,observedAt:checkedAt}),disposition:"manual-check",reason};
  }

  if(project.release.status==="rolled-back"&&stableId&&productionId===stableId){
    const updated=settleRolledBack(project,observation);
    return {
      project:updated,
      disposition:updated.release.healthy?"terminal-live-decision":"manual-check",
      reason:updated.release.healthy
        ?"Reconcile 已刷新 rolled-back Production Outcome，stable Deployment 与 Health 均已确认。"
        :"Rollback 终态仍指向 stable Deployment，但最新 Production Health 未通过。",
    };
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
          history:releaseHistory(project,checkedAt,"Reconcile：Rollback 请求后 Production 仍在 Candidate；继续 stable rollback。",{deploymentId:boundId,healthy:health.ready,observationStatus:health.ready?"healthy":"unhealthy",environment:"production"}),
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
