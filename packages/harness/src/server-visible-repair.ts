import type {Candidate,EvolveProject,VisibleRepairAttempt} from "@evolution/contracts";
import {EvolveProjectSchema,VisibleRepairAttemptSchema} from "@evolution/contracts";
import {campaignRepairLimitStopReason,estimateNextRoundCost,visibleRepairTarget} from "@evolution/core";
import {hasCompleteServerExperimentFrozenSet,type ServerExperimentRecoveryPorts} from "./server-experiment-recovery";
import type {ServerArtifactAcceptancePorts} from "./server-artifact-acceptance";

function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(!value||typeof value!=="object")return value;
  return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
}
async function binding(project:EvolveProject,record:Pick<VisibleRepairAttempt,"round"|"attempt"|"parentCandidateId"|"experiment"|"failedCriterionIds"|"finalPaperHash">,ports:ServerExperimentRecoveryPorts){
  const parent=project.candidates.filter(candidate=>candidate.id===record.parentCandidateId);
  const wire={version:"experiment-visible-repair-v1",missionId:project.id,record,parent,
    goal:project.goal,command:project.evolutionCommand,protectedItems:project.protectedItems,editableItems:project.editableItems,
    rubric:project.acceptanceRubric,sources:project.sourceArtifacts,baseline:project.baselineRun,
    visible:project.evalSuite,hidden:project.hiddenEvalSuite,final:project.finalHoldout,policy:project.experimentPolicy,
    route:project.campaign.scoringRouteFingerprint,scoring:project.campaign.scoringInputFingerprint,
    limits:project.campaign.stopCriteria,startedAt:project.campaign.startedAt,maxRepairs:project.artifactAcceptance.maxRepairAttempts};
  const result=await ports.fingerprint?.(JSON.stringify(canonical(wire)));
  return result&&/^[0-9a-f]{64}$/.test(result)?result:undefined;
}
function activeRecord(project:EvolveProject){
  const records=project.visibleRepairAttempts?.filter(item=>item.round===project.campaign.currentRound+1&&["reserved","running"].includes(item.status))??[];
  if(records.length!==1)return undefined;
  const parsed=VisibleRepairAttemptSchema.safeParse(records[0]);
  return parsed.success?parsed.data:undefined;
}
/** Structural routing only; the executor rechecks the digest and physical bytes before I/O. */
export function hasServerPendingVisibleRepair(project:EvolveProject){
  const record=activeRecord(project);
  return Boolean(record&&project.campaign.status==="running"&&project.campaign.checkpoint?.round===record.round
    &&project.campaign.checkpoint.completedPhase==="experiment"
    &&project.experimentRun.status==="completed"&&!project.experimentRun.winnerId&&!project.experimentRun.pendingEvidenceCandidateId);
}
/** The returned project must be saved before executing the reservation on a later control step. */
export async function prepareServerVisibleRepair(project:EvolveProject,ports:ServerExperimentRecoveryPorts,now:string):Promise<EvolveProject|undefined>{
  if(project.experimentPolicy.visibleFailureRepair!=="experiment-visible-repair-v1")return undefined;
  // Hash the same validated representation that the Mission store will read back.
  const parsed=EvolveProjectSchema.safeParse(project);
  if(!parsed.success)return undefined;
  project=parsed.data;
  const target=visibleRepairTarget(project);
  if(!target||!ports.verifyFrozenArtifact||!hasCompleteServerExperimentFrozenSet(project,target.candidate)
    ||target.candidate.artifactSnapshots.some(snapshot=>!snapshot.frozenArtifact||!/^[0-9a-f]{64}$/.test(snapshot.frozenArtifact.sha256))
    ||JSON.stringify(target.result.artifactSnapshots)!==JSON.stringify(target.candidate.artifactSnapshots))return undefined;
  const attempt=project.artifactAcceptance.attempts+1,round=project.campaign.currentRound+1;
  const basis={round,attempt,parentCandidateId:target.candidate.id,experiment:project.experimentRun,
    failedCriterionIds:target.failedCriteria.map(c=>c.id),finalPaperHash:project.finalHoldout!.paperHash};
  const inputFingerprint=await binding(project,basis,ports);
  if(!inputFingerprint)return undefined;
  const record:VisibleRepairAttempt={...basis,version:"experiment-visible-repair-v1",id:`visible-repair-r${round}-${attempt}-${inputFingerprint.slice(0,16)}`,
    status:"reserved",inputFingerprint,reservedAt:now};
  return {...project,visibleRepairAttempts:[...(project.visibleRepairAttempts??[]),record],
    artifactAcceptance:{...project.artifactAcceptance,attempts:attempt,summary:`Visible Repair ${attempt}/${project.artifactAcceptance.maxRepairAttempts} 已登记；Gate F 尚未执行。`},updatedAt:now};
}
export type ServerVisibleRepairPorts=ServerExperimentRecoveryPorts&{
  /** Compare-and-swap the loaded Mission revision before I/O. Conflict/unavailable storage must throw. */
  persistProject(project:EvolveProject):Promise<unknown>;
  repairCandidate(args:Parameters<ServerArtifactAcceptancePorts["repairCandidate"]>[0]&{feedbackPhase:"visible"}):Promise<Candidate>;
};
export async function runServerVisibleRepair(input:EvolveProject,ports:ServerVisibleRepairPorts,options?:{now?:()=>string}){
  const now=()=>options?.now?.()??new Date().toISOString();
  let project=input,record=activeRecord(input);
  const pause=(detail:string)=>{
    const reason=`[server-campaign-visible-repair-stopped] ${detail}`;
    return {control:"stop" as const,project:{...project,campaign:{...project.campaign,status:"paused" as const,stopReason:reason,
      schedule:{...project.campaign.schedule,enabled:false,nextRunAt:undefined}},updatedAt:now()},reason,repaired:false};
  };
  if(!record||!hasServerPendingVisibleRepair(input))return pause("没有当前轮已登记的可见失败修复。禁止新建调用。");
  if(record.status!=="reserved")return pause("此前调用已开始，结果可能未知；保留已消耗次数，禁止自动重发。");
  const stop=campaignRepairLimitStopReason(input);
  if(stop)return pause(stop);
  const beforeDebit={...input,visibleRepairAttempts:input.visibleRepairAttempts?.filter(item=>item.id!==record!.id),
    artifactAcceptance:{...input.artifactAcceptance,attempts:record.attempt-1}};
  const target=visibleRepairTarget(beforeDebit);
  if(input.artifactAcceptance.attempts!==record.attempt||!target||target.candidate.id!==record.parentCandidateId
    ||JSON.stringify(target.failedCriteria.map(c=>c.id))!==JSON.stringify(record.failedCriterionIds)
    ||JSON.stringify(input.experimentRun)!==JSON.stringify(record.experiment)
    ||await binding(input,{round:record.round,attempt:record.attempt,parentCandidateId:record.parentCandidateId,
      experiment:record.experiment,failedCriterionIds:record.failedCriterionIds,finalPaperHash:record.finalPaperHash},ports)!==record.inputFingerprint
    ||!hasCompleteServerExperimentFrozenSet(input,target.candidate)||!ports.verifyFrozenArtifact)return pause("修复输入、预算、父代或失败证据已变化。");
  try{
    for(const snapshot of target.candidate.artifactSnapshots){
      if(!await ports.verifyFrozenArtifact(snapshot))return pause("冻结父代回读失败；禁止基于替代字节修复。");
    }
  }catch{return pause("冻结父代回读不可用。");}
  // Storage verification can take time. Enforce the same window again immediately before provider I/O.
  const afterReadLimit=campaignRepairLimitStopReason(input);
  if(afterReadLimit)return pause(afterReadLimit);
  const estimatedCost=estimateNextRoundCost(project);
  record={...record,status:"running",estimatedCost};
  project={...project,visibleRepairAttempts:project.visibleRepairAttempts!.map(item=>item.id===record!.id?record!:item),
    campaign:{...project.campaign,estimatedCost:project.campaign.estimatedCost+estimatedCost},updatedAt:now()};
  await ports.persistProject(project);
  const afterClaimLimit=campaignRepairLimitStopReason(input);
  if(afterClaimLimit)return pause(afterClaimLimit);
  try{
    const repaired=await ports.repairCandidate({project,candidate:target.candidate,failedCriteria:target.failedCriteria,attempt:record.attempt,feedbackPhase:"visible"});
    if(project.candidates.some(candidate=>candidate.id===repaired.id)||!hasCompleteServerExperimentFrozenSet(project,repaired)
      ||repaired.finalHoldoutPaperHash!==record.finalPaperHash)throw new Error("Repair 必须生成新 identity、完整冻结成果并保留原独立终验绑定。");
    if(repaired.artifactSnapshots.every(snapshot=>snapshot.frozenArtifact?.sha256===target.candidate.artifactSnapshots
      .find(parent=>parent.sourceArtifactId===snapshot.sourceArtifactId)?.frozenArtifact?.sha256))throw new Error("Repair 只有新 identity，冻结文件没有实际变化。");
    for(const snapshot of repaired.artifactSnapshots){
      if(!await ports.verifyFrozenArtifact!(snapshot))throw new Error("Repair 冻结字节回读失败。");
    }
    const at=now();
    project={...project,candidates:[...project.candidates,repaired],selectedCandidateIds:[repaired.id],
      visibleRepairAttempts:project.visibleRepairAttempts!.map(item=>item.id===record!.id?{...item,status:"frozen",candidateId:repaired.id,
        repairedArtifactSnapshots:repaired.artifactSnapshots,completedAt:at}:item),
      experimentRun:{id:`experiment-r${record.round}-server`,status:"idle",candidateResults:[],summary:"[server-campaign-visible-repair-visible-pending] 新 Repair 必须重跑完整 Visible，不继承父代分数。"},
      validationRun:{id:`validation-repair-pending-${repaired.id}`,status:"idle",candidateId:repaired.id,runs:[],baselineRuns:[],checks:[],recommendation:"hold"},
      artifactAcceptance:{...project.artifactAcceptance,status:"repairing",candidateId:repaired.id,hardGatePass:false},
      campaign:{...project.campaign,checkpoint:{round:record.round,completedPhase:"plan",at}},stage:"experiment",updatedAt:at};
    return {control:"continue" as const,project,reason:`Visible Repair ${record.attempt}/${project.artifactAcceptance.maxRepairAttempts} 已冻结 ${repaired.id}；重新运行完整 Visible → Hidden → 独立终验 → Gate F。`,repaired:true};
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    project={...project,visibleRepairAttempts:project.visibleRepairAttempts!.map(item=>item.id===record!.id?{...item,status:"failed",error:detail,completedAt:now()}:item)};
    return pause(`本次修复未完成，次数已消耗：${detail}`);
  }
}
