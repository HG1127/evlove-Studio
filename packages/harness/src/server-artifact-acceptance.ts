import type {
  AcceptanceCriterion,
  Candidate,
  EvolveProject,
  FrozenArtifact,
} from "@evolution/contracts";
import {
  campaignObservesLiveTarget,
  estimateRoundCost,
  evidenceFingerprint,
  settleArtifactAcceptanceFromValidation,
  updateSearchChampion,
  verifiedValidationFailures,
} from "@evolution/core";

export type ServerArtifactVerification={
  verified:FrozenArtifact[];
  unavailable:string[];
  failed:string[];
};

export type ServerArtifactAcceptancePorts={
  verifyFrozenArtifacts(args:{project:EvolveProject;candidate:Candidate}):Promise<ServerArtifactVerification>;
  repairCandidate(args:{
    project:EvolveProject;
    candidate:Candidate;
    failedCriteria:AcceptanceCriterion[];
    attempt:number;
  }):Promise<Candidate>;
};

export type ServerArtifactAcceptanceOutcome={
  control:"continue"|"stop";
  project:EvolveProject;
  reason:string;
  accepted:boolean;
  repaired:boolean;
  championChanged?:boolean;
};

function pause(project:EvolveProject,reason:string,now:string):ServerArtifactAcceptanceOutcome{
  return {
    control:"stop",
    project:{
      ...project,
      stage:"validation",
      campaign:{
        ...project.campaign,
        status:"paused",
        stopReason:reason,
        checkpoint:project.campaign.checkpoint,
        schedule:{...project.campaign.schedule,enabled:false,nextRunAt:undefined},
      },
      updatedAt:now,
    },
    reason,
    accepted:false,
    repaired:false,
  };
}

function settleRound(project:EvolveProject,candidate:Candidate,accepted:boolean,now:string){
  const round=project.campaign.checkpoint?.round??project.campaign.currentRound+1;
  const parentVersionId=project.searchChampion?.versionLabel??project.version;
  const championUpdate=accepted?updateSearchChampion({
    project,
    current:project.searchChampion,
    round,
    winner:candidate,
    validation:project.validationRun,
    artifactAcceptance:project.artifactAcceptance,
    baseline:project.campaign.rootBaseline??project.baselineRun.result,
    parentVersionId,
    minImprovement:project.campaign.stopCriteria.minImprovement,
    liveTarget:campaignObservesLiveTarget(project),
    hiddenSuite:project.hiddenEvalSuite,
    selectedAt:now,
  }):{champion:project.searchChampion,changed:false,improvement:0};
  const evaluation=project.validationRun.evaluation;
  const score=evaluation&&accepted
    ? championUpdate.champion?.candidate?.id===candidate.id
      ? championUpdate.champion.score
      : undefined
    : undefined;
  const noImprovementRounds=championUpdate.changed?0:project.campaign.noImprovementRounds+1;
  const archive=evaluation?[{
    id:`archive-r${round}-${candidate.id}-gate-f`,
    round,
    kind:championUpdate.changed?"champion" as const:accepted?"elite" as const:"failure" as const,
    niche:"gate-f",
    score:Number((score??evaluation.rubricScore??evaluation.accuracy).toFixed(2)),
    candidate,
    evaluation,
    parentVersionId,
    lineage:[parentVersionId,candidate.id],
    reason:championUpdate.changed?"Gate F 通过并成为新的 Search Champion":accepted?"Gate F 通过但未超过历史 Search Champion":"Gate F 未通过，保留本轮失败证据",
    createdAt:now,
  }]:[];
  const roundRecord={
    id:`round-${round}-server-gate-f`,
    round,
    status:"completed" as const,
    parentVersionId,
    startedAt:project.campaign.startedAt??now,
    completedAt:now,
    selectedProblemTitle:project.problems.find((problem)=>problem.id===project.selectedProblemId)?.title,
    candidateCount:project.selectedCandidateIds.length||project.candidates.length,
    winnerCandidateId:candidate.id,
    winnerScore:score,
    championChanged:championUpdate.changed,
    globalChampionId:championUpdate.champion?.id,
    improvement:Number(championUpdate.improvement.toFixed(2)),
    estimatedCost:estimateRoundCost(project),
    summary:championUpdate.changed
      ?`Round ${round} 发现新的 Search Champion ${championUpdate.champion?.versionLabel}。`
      :accepted
        ?`Round ${round} Gate F 通过，但未超过当前 Search Champion。`
        :`Round ${round} Gate F 未通过；进入下一轮搜索。`,
  };
  return {
    ...project,
    searchChampion:championUpdate.champion,
    searchAppliedPatches:championUpdate.champion?.patches??project.searchAppliedPatches,
    evolutionArchive:[...project.evolutionArchive,...archive].slice(-240),
    roundHistory:[...project.roundHistory,roundRecord],
    campaign:{
      ...project.campaign,
      status:"running" as const,
      currentRound:round,
      noImprovementRounds,
      bestScore:championUpdate.champion?.score??project.campaign.bestScore,
      lastGapAdvice:championUpdate.changed?undefined:project.campaign.lastGapAdvice,
      estimatedCost:Number((project.campaign.estimatedCost+estimateRoundCost(project)).toFixed(4)),
      stopReason:undefined,
      checkpoint:undefined,
    },
    updatedAt:now,
  };
}

export async function runServerArtifactAcceptance(
  inputProject:EvolveProject,
  ports:ServerArtifactAcceptancePorts,
  options?:{now?:()=>string},
):Promise<ServerArtifactAcceptanceOutcome>{
  const now=options?.now?.()??new Date().toISOString();
  const checkpoint=inputProject.campaign.checkpoint;
  const round=checkpoint?.round??inputProject.campaign.currentRound+1;
  if(!checkpoint||checkpoint.completedPhase!=="validation"){
    throw new Error("Server Artifact Acceptance requires a validation checkpoint");
  }
  const candidateId=inputProject.validationRun.candidateId??inputProject.experimentRun.winnerId??inputProject.experimentRun.pendingEvidenceCandidateId;
  const candidate=inputProject.candidates.find((item)=>item.id===candidateId);
  if(!candidate)return pause(inputProject,"[server-campaign-artifact-acceptance-candidate-pending] 找不到 Hidden Validation 对应 Candidate。",now);
  const binding=evidenceFingerprint(inputProject,candidate);
  if(inputProject.validationRun.status!=="completed"||inputProject.validationRun.evidenceFingerprint!==binding){
    return pause(inputProject,"[server-campaign-artifact-acceptance-evidence-pending] Hidden Validation 与当前 Candidate Artifact 指纹不一致；必须先对 exact Artifact 重新验证。",now);
  }

  let verification:ServerArtifactVerification;
  try{
    verification=await ports.verifyFrozenArtifacts({project:inputProject,candidate});
  }catch(error){
    return pause(inputProject,`[server-campaign-artifact-acceptance-evidence-pending] frozen Artifact 回读未完成：${error instanceof Error?error.message:String(error)}`,now);
  }
  if(verification.failed.length){
    const acceptance={
      ...inputProject.artifactAcceptance,
      id:`artifact-acceptance-server-${Date.parse(now)||Date.now()}`,
      status:"failed" as const,
      candidateId:candidate.id,
      evidenceFingerprint:binding,
      frozenArtifacts:verification.verified,
      hardGatePass:false,
      summary:`Gate F frozen Artifact 完整性失败：${verification.failed.join("；")}`,
      error:verification.failed.join("；"),
      lastCheckedAt:now,
    };
    const project={...inputProject,artifactAcceptance:acceptance,updatedAt:now};
    return pause(project,"[server-campaign-artifact-acceptance-integrity-failed] frozen Artifact bytes/hash 与凭证不一致，禁止交付。",now);
  }
  const acceptance=settleArtifactAcceptanceFromValidation({
    project:inputProject,
    candidate,
    validation:inputProject.validationRun,
    frozenArtifacts:verification.verified,
    now,
  });
  let project:EvolveProject={...inputProject,artifactAcceptance:acceptance,updatedAt:now};
  if(verification.unavailable.length||acceptance.status==="unverified"){
    const reason=`[server-campaign-artifact-acceptance-evidence-pending] Gate F 缺少真实 frozen Artifact / exact-fingerprint 证据：${verification.unavailable.join("；")||acceptance.summary}`;
    return pause(project,reason,now);
  }
  if(acceptance.status==="passed"){
    if(campaignObservesLiveTarget(project)&&project.searchChampion){
      const comparison=updateSearchChampion({
        project,
        current:project.searchChampion,
        round,
        winner:candidate,
        validation:project.validationRun,
        artifactAcceptance:acceptance,
        baseline:project.campaign.rootBaseline??project.baselineRun.result,
        parentVersionId:project.searchChampion.versionLabel,
        minImprovement:project.campaign.stopCriteria.minImprovement,
        liveTarget:true,
        hiddenSuite:project.hiddenEvalSuite,
        selectedAt:now,
      });
      if(comparison.comparisonPending)return pause(project,"[server-campaign-live-comparison-pending] 当前 Champion 缺少完整同卷 Hidden 对照证据；必须重新运行 Hidden Holdout。",now);
    }
    project={
      ...project,
      candidates:project.candidates.map((item)=>item.id===candidate.id?{...item,status:"passed" as const}:item),
      experimentRun:{...project.experimentRun,winnerId:candidate.id,pendingEvidenceCandidateId:undefined},
      gates:project.gates.map((gate)=>gate.id==="artifact-ready"
        ?{...gate,status:"approved" as const,approvedAt:now,note:`Server Gate F · Artifact Acceptance ${acceptance.overallScore}/100`}
        :gate.id==="release-ready"
          ?{...gate,status:"ready" as const,approvedAt:undefined,note:`Candidate ${candidate.id} 已通过 Hidden Validation + Gate F；生产 Release 需要重新授权`}
          :gate),
    };
    const settled=settleRound(project,candidate,true,now);
    return {control:"continue",project:settled,reason:`Round ${round} Gate F 已通过 exact frozen Artifact 验收并完成本轮结算。`,accepted:true,repaired:false,championChanged:settled.searchChampion?.candidate?.id===candidate.id};
  }

  const failedCriteria=verifiedValidationFailures(inputProject,inputProject.validationRun);
  const attempt=(inputProject.artifactAcceptance.attempts??0)+1;
  const max=inputProject.artifactAcceptance.maxRepairAttempts??3;
  if(failedCriteria.length&&attempt<=max){
    try{
      const repaired=await ports.repairCandidate({project:inputProject,candidate,failedCriteria,attempt});
      if(repaired.id===candidate.id)throw new Error("Repair Candidate 必须使用新的 Candidate identity");
      const validation={
        id:`validation-repair-pending-${repaired.id}`,
        status:"idle" as const,
        candidateId:repaired.id,
        runs:[],
        baselineRuns:[],
        checks:[],
        recommendation:"hold" as const,
        previousEvaluation:inputProject.validationRun.evaluation,
        summary:"Server targeted Repair 已生成新的 frozen Artifact；必须重新运行 authoritative Hidden Holdout。",
      };
      project={
        ...project,
        candidates:[...project.candidates,repaired],
        selectedCandidateIds:[repaired.id],
        experimentRun:{...project.experimentRun,status:"completed",winnerId:repaired.id,pendingEvidenceCandidateId:undefined},
        validationRun:validation,
        artifactAcceptance:{...acceptance,status:"repairing",candidateId:repaired.id,attempts:attempt,summary:`Targeted Repair ${attempt}/${max} 已生成新 Candidate；等待重新 Hidden Holdout。`},
        stage:"experiment",
        campaign:{
          ...project.campaign,
          status:"running",
          stopReason:undefined,
          checkpoint:{round,completedPhase:"experiment",at:now},
        },
        updatedAt:now,
      };
      return {control:"continue",project,reason:`Gate F 已证实 ${failedCriteria.length} 个 Criterion 失败；Targeted Repair ${attempt}/${max} 已生成新 Candidate ${repaired.id}，重新进入 Hidden Holdout。`,accepted:false,repaired:true};
    }catch(error){
      const reason=`[server-campaign-artifact-repair-pending] 已保留 Gate F/Hidden 失败证据，但 Targeted Repair 未完成：${error instanceof Error?error.message:String(error)}`;
      return pause(project,reason,now);
    }
  }

  const settled=settleRound(project,candidate,false,now);
  return {
    control:"continue",
    project:settled,
    reason:failedCriteria.length
      ?`Gate F 仍有 ${failedCriteria.length} 个已验证失败项且 Repair 次数已耗尽；本轮结算为失败并进入下一轮。`
      :"Gate F 未通过且没有可安全自动修复的 VERIFIED 失败项；本轮结算为失败并进入下一轮。",
    accepted:false,
    repaired:false,
    championChanged:false,
  };
}
