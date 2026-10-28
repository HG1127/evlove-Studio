import {EvolveProjectSchema,RepairEvidenceReferenceSchema,type ArtifactRepairAttempt,type EvolveProject} from "@evolution/contracts";
import {artifactRepairStopReason,campaignRepairLimitStopReason,estimateNextRoundCost,hasExactFrozenArtifactSet,hiddenRepairFeedbackContext,hiddenRepairTarget,HIDDEN_REPAIR_V2,candidateFailureContextBlocker} from "@evolution/core";
import type {ServerArtifactAcceptanceOutcome,ServerArtifactAcceptancePorts} from "./server-artifact-acceptance";
import {hasCompleteServerExperimentFrozenSet} from "./server-experiment-recovery";

function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(!value||typeof value!=="object")return value;
  return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
}

/** Claim the shared budget through the caller's revision-scoped store before mutation I/O. */
export async function runServerTargetedArtifactRepair(input:EvolveProject,ports:ServerArtifactAcceptancePorts,now:()=>string):Promise<ServerArtifactAcceptanceOutcome>{
  let project=input;
  const pause=(detail:string):ServerArtifactAcceptanceOutcome=>{
    const reason=`[server-campaign-artifact-repair-pending] ${detail}`;
    return {control:"stop",project:{...project,campaign:{...project.campaign,status:"paused",stopReason:reason,
      schedule:{...project.campaign.schedule,enabled:false,nextRunAt:undefined}},updatedAt:now()},reason,accepted:false,repaired:false};
  };
  const parsed=EvolveProjectSchema.safeParse(project);
  if(!parsed.success)return pause("修复输入未通过 Mission 边界校验。");
  project=parsed.data;
  const candidate=project.candidates.find(item=>item.id===project.validationRun.candidateId);
  if(!candidate)return pause("当前 Hidden 记录没有对应的唯一冻结父代。");
  const failureContextBlocker=candidateFailureContextBlocker(project,candidate);if(failureContextBlocker)return pause(failureContextBlocker);
  const stop=artifactRepairStopReason(project,candidate);
  if(stop)return pause(stop);
  if(!ports.persistProject||!ports.fingerprint||!ports.archiveRepairEvidence)return pause("缺少修复前的版本冲突检查、完整证据归档或持久化能力，未调用 AI、未扣次数。");
  const target=hiddenRepairTarget(project,candidate),failedCriteria=target.failedCriteria;
  const attempt=project.artifactAcceptance.attempts+1,round=project.campaign.currentRound+1,estimatedCost=estimateNextRoundCost(project),at=now();
  const inputFingerprint=await ports.fingerprint(JSON.stringify(canonical({version:target.version,missionId:project.id,round,attempt,candidate,
    ...(target.version===HIDDEN_REPAIR_V2?{feedbackKind:target.feedbackKind,failedCriterionIds:failedCriteria.map(c=>c.id)}:{}),
    name:project.name,goal:project.goal,command:project.evolutionCommand,protectedItems:project.protectedItems,editableItems:project.editableItems,
    sources:project.sourceArtifacts,rubric:project.acceptanceRubric,visible:project.evalSuite,hidden:project.hiddenEvalSuite,final:project.finalHoldout,
    experiment:project.experimentRun,validation:project.validationRun,acceptance:project.artifactAcceptance,
    policy:project.experimentPolicy,route:project.campaign.scoringRouteFingerprint,scoring:project.campaign.scoringInputFingerprint,
    limits:project.campaign.stopCriteria,startedAt:project.campaign.startedAt,estimatedCost})));
  if(!/^[0-9a-f]{64}$/.test(inputFingerprint))return pause("修复输入缺少有效 SHA-256 指纹，未调用 AI。");
  const content=JSON.stringify(canonical({version:"repair-feedback-evidence-v1",missionId:project.id,candidateId:candidate.id,phase:"hidden",round,attempt,inputFingerprint,
    experiment:project.experimentRun,validation:project.validationRun,acceptance:project.artifactAcceptance}));
  const sha256=await ports.fingerprint(content),size=new TextEncoder().encode(content).byteLength;
  let evidence;
  try{
    evidence=RepairEvidenceReferenceSchema.parse(await ports.archiveRepairEvidence({version:"repair-evidence-archive-v1",missionId:project.id,candidateId:candidate.id,
      phase:"hidden",attempt,content,sha256,size}));
    if(evidence.sha256!==sha256||evidence.size!==size||evidence.missionId!==project.id||evidence.candidateId!==candidate.id)return pause("完整失败证据归档身份不一致，未调用 AI。");
  }catch{return pause("完整失败证据归档或回读失败，未调用 AI、未扣次数。");}
  const beforeClaimLimit=campaignRepairLimitStopReason(project);
  if(beforeClaimLimit)return pause(beforeClaimLimit);
  const claim={id:`artifact-repair-r${round}-${attempt}-${inputFingerprint.slice(0,16)}`,
    round,attempt,status:"running" as const,parentCandidateId:candidate.id,inputFingerprint,finalPaperHash:candidate.finalHoldoutPaperHash!,
    failedCriterionIds:failedCriteria.map(c=>c.id),evidence,estimatedCost,startedAt:at};
  const record:ArtifactRepairAttempt=target.version===HIDDEN_REPAIR_V2?{version:HIDDEN_REPAIR_V2,...claim,feedbackKind:target.feedbackKind}:{version:"artifact-targeted-repair-v1",...claim};
  const beforeDebit=project;
  project={...project,artifactRepairAttempts:[...(project.artifactRepairAttempts??[]),record],
    artifactAcceptance:{...project.artifactAcceptance,attempts:attempt},
    campaign:{...project.campaign,estimatedCost:project.campaign.estimatedCost+estimatedCost},updatedAt:at};
  // A failed/unknown save is deliberately outside the provider catch: it must not overwrite a newer Mission.
  await ports.persistProject(project);
  const afterClaimLimit=campaignRepairLimitStopReason(beforeDebit);
  if(afterClaimLimit){
    project={...project,artifactRepairAttempts:project.artifactRepairAttempts!.map(item=>item.id===record.id?{...item,status:"failed",error:afterClaimLimit,completedAt:now()}:item)};
    return pause(afterClaimLimit);
  }
  try{
    if(target.version===HIDDEN_REPAIR_V2)hiddenRepairFeedbackContext(project,candidate,failedCriteria.map(c=>c.id),attempt);
    const repaired=await ports.repairCandidate({project,candidate,failedCriteria,attempt});
    const repairedContextBlocker=candidateFailureContextBlocker(project,repaired);if(repairedContextBlocker)throw new Error(repairedContextBlocker);
    if(project.candidates.some(item=>item.id===repaired.id)||!hasCompleteServerExperimentFrozenSet(project,repaired)
      ||repaired.finalHoldoutPaperHash!==record.finalPaperHash)throw new Error("Repair 必须使用新的 Candidate identity、完整冻结目标和原独立终验绑定。");
    if(repaired.artifactSnapshots.every(snapshot=>snapshot.frozenArtifact?.sha256===candidate.artifactSnapshots.find(parent=>parent.sourceArtifactId===snapshot.sourceArtifactId)?.frozenArtifact?.sha256))throw new Error("Repair 冻结文件没有实际变化，禁止仅凭新 identity 晋级。");
    const verification=await ports.verifyFrozenArtifacts({project,candidate:repaired});
    if(verification.failed.length||verification.unavailable.length
      ||!hasExactFrozenArtifactSet(project,repaired,{...project.artifactAcceptance,frozenArtifacts:verification.verified}))throw new Error("Repair 冻结文件回读不可用或身份不一致，不能晋级。");
    const completedAt=now();
    project={...project,candidates:[...project.candidates,repaired],selectedCandidateIds:[repaired.id],
      artifactRepairAttempts:project.artifactRepairAttempts!.map(item=>item.id===record.id?{...item,status:"frozen",candidateId:repaired.id,
        repairedArtifactSnapshots:repaired.artifactSnapshots,completedAt}:item),
      experimentRun:{id:`experiment-r${round}-server`,status:"idle",candidateResults:[],summary:"[server-campaign-artifact-repair-visible-pending] 新 Repair 文件必须重新完成 Visible Experiment。"},
      validationRun:{id:`validation-repair-pending-${repaired.id}`,status:"idle",candidateId:repaired.id,runs:[],baselineRuns:[],checks:[],recommendation:"hold",
        previousEvaluation:beforeDebit.validationRun.evaluation,summary:"已保留父代完整失败记录；新冻结候选必须重新通过 Visible、Hidden、独立终验与 Gate F。"},
      artifactAcceptance:{...project.artifactAcceptance,status:"repairing",candidateId:repaired.id,summary:`Targeted Repair ${attempt}/${project.artifactAcceptance.maxRepairAttempts} 已冻结，等待重新验证。`},
      campaign:{...project.campaign,status:"running",stopReason:undefined,checkpoint:{round,completedPhase:"plan",at:completedAt}},stage:"experiment",updatedAt:completedAt};
    return {control:"continue",project,reason:`Gate F 已证实 ${failedCriteria.length} 项失败或同卷退步；修复 ${attempt}/${project.artifactAcceptance.maxRepairAttempts} 已冻结新候选 ${repaired.id}，重新运行 Visible、Hidden、独立终验与 Gate F。`,accepted:false,repaired:true};
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    project={...project,artifactRepairAttempts:project.artifactRepairAttempts!.map(item=>item.id===record.id?{...item,status:"failed",error:detail,completedAt:now()}:item)};
    return pause(`已保留完整失败证据，本次修复未完成且次数已消耗：${detail}`);
  }
}
