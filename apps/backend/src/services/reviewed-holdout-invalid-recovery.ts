import {EvolutionEventSchema,EvolveProjectSchema,ValidationRunSchema,StageSchema,ReviewedInvalidOutputRecoverySchema,ReviewedHoldoutPreviewSchema,ReviewedHoldoutRunInputSchema,type EvolveProject,type EvolutionJob,type ReviewedHoldoutBinding} from "@evolution/contracts";
import {StructuredAiJsonError,type StructuredAiJsonFailureKind} from "@evolution/adapters";
import {getServerProductionRuntime} from "./production-runtime";
import {previewReviewedHoldout} from "./reviewed-holdout-admission";
import {reviewedSha,sameReviewedHoldoutScope,reviewedFrozenBindingsMatch} from "./reviewed-holdout-identity";
import {serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";
import {workflowRunIdForJob} from "./workflow-run-control";
import {readReviewedSdkEvidence,assertReviewedSdkEvidence,type ReviewedSdkEvidence} from "./reviewed-holdout-sdk-evidence";
const failureKinds:StructuredAiJsonFailureKind[]=["non-json-envelope","trailing-content","unescaped-control","invalid-escape","unfinished-string","unfinished-root","invalid-syntax"];
const prefix="[server-campaign-holdout-judge-pending] Hidden 同卷已进入 Server 执行，但独立 Judge 未完成：";
function invalidOnly(raw:unknown,project:EvolveProject){
  const v=ValidationRunSchema.parse(raw),error=v.error??"";
  const sameIds=(ids:string[])=>reviewedSha([...ids].sort())===reviewedSha(project.hiddenEvalSuite.map(t=>t.id).sort())&&new Set(ids).size===ids.length;
  if(v.status!=="failed"||v.validationMode!=="full"||v.evaluation||v.baselineEvaluation||v.previousEvaluation||v.versionSnapshot||v.completedAt||v.recommendation||v.checks.length
    ||!error.startsWith(prefix)||!failureKinds.some(kind=>error.includes(new StructuredAiJsonError(kind).message))
    ||!error.includes("completionPhase=initial;")||!error.includes("completionPhase=correction;")
    ||!sameIds(v.runs.map(r=>r.testCaseId))||!sameIds(v.baselineRuns.map(r=>r.testCaseId))||!sameIds(v.baselineSuiteIds??[])
    ||v.candidateId!==project.experimentRun.winnerId||!v.executionArtifactFingerprint||!v.executionEvidenceFingerprint)
    throw new Error("旧结果不是已核实的双卷完整执行、无有效评审的 JSON 失败；不能重新评审。");
  return v;
}
function corroboratedEvent(raw:unknown,id:string,job:EvolutionJob,type:"MissionUpdated"|"ActionCompleted"){
  const e=EvolutionEventSchema.parse(raw);
  if(e.id!==id||e.jobId!==job.id||e.missionId!==job.missionId||e.source!=="human-reviewed-holdout"||e.type!==type)throw new Error("旧审计记录身份不一致。");
  return e;
}
/** A completed private SDK step certifies that its deterministic append succeeded before return.
 * Event JSON alone is never sufficient: the public Event API does not mint this proof. */
export function certifyReviewedInvalidAttempt(project:EvolveProject,job:EvolutionJob,sdk:ReviewedSdkEvidence,rawResult:unknown,rawAdmission:unknown,binding:ReviewedHoldoutBinding){
  assertReviewedSdkEvidence(sdk);
  const approval=sdk.input.approval,prior=approval.request.binding;
  if(job.type!=="campaign"||job.generation!==1||job.metadata?.workflowIntent!=="reviewed-holdout"||job.id!==sdk.input.controlJobId
    ||job.missionId!==project.id||sdk.input.missionId!==project.id||sdk.input.controlOwnerKey!==job.idempotencyKey
    ||workflowRunIdForJob(job,project)!==sdk.runId||reviewedSha(job.metadata.reviewedApproval)!==reviewedSha(approval)
    ||job.metadata.requestSha256!==reviewedSha(approval.request)||job.metadata.reviewedActorId!==approval.actorId
    ||!sameReviewedHoldoutScope(approval,binding)||!reviewedFrozenBindingsMatch(project,prior)
    ||prior.scoringRouteFingerprint===binding.scoringRouteFingerprint)throw new Error("旧作业、审批或模型修复版本不一致；同一评分版本不能反复重试。");
  const result=corroboratedEvent(rawResult,'evt-'+job.id+'-reviewed-hidden-result',job,"ActionCompleted");
  const admission=corroboratedEvent(rawAdmission,'evt-'+job.id+'-reviewed-holdout-authorized',job,"MissionUpdated");
  if(reviewedSha(result.payload.approval)!==reviewedSha(approval)||reviewedSha(admission.payload.approval)!==reviewedSha(approval)
    ||reviewedSha(admission.payload.priorBaseline)!==reviewedSha(project.baselineRun))throw new Error("旧审批与已完成私有步骤的审计内容不一致。");
  const validation=invalidOnly(result.payload.validation,project);
  if(validation.executionArtifactFingerprint!==prior.physicalSha256)throw new Error("旧答卷物理身份与原审批不一致。");
  const oldValidation=ValidationRunSchema.parse(admission.payload.priorValidation);
  if(oldValidation.evaluation||oldValidation.baselineEvaluation||oldValidation.previousEvaluation||oldValidation.versionSnapshot)throw new Error("旧审计中已有有效隐藏评审；保留原结果并暂停。");
  // Restore only mutable execution fields in a local hash projection. Never write this projection.
  const sameOriginalInput=StageSchema.options.some(stage=>{
    const original=EvolveProjectSchema.parse({...project,stage,validationRun:oldValidation,campaign:{...project.campaign,
      checkpoint:admission.payload.priorCheckpoint,serverRecoveryWait:admission.payload.priorRecoveryWait}});
    return serverMainFlowRecoveryDigest(original)===prior.inputSha256;
  });
  if(!sameOriginalInput)throw new Error("原审批的完整验收输入已变化，不能使用旧 REVIEW 恢复。");
  return{controlJobId:job.id,runId:sdk.runId,validationSha256:reviewedSha(validation),approvalSha256:reviewedSha(approval),sdkEvidenceSha256:reviewedSha(sdk),scoringRouteFingerprint:prior.scoringRouteFingerprint};
}

/** Explicit read-only recovery preview, requiring complete private observations for every prior attempt. */
export async function previewReviewedInvalidRecovery(project:EvolveProject,pending?:{controlJobId:string;operationKey:string}){
  const first=await previewReviewedHoldout(project),runtime=getServerProductionRuntime();
  const reviewedJobs=(await runtime.jobs.list(project.id)).filter(j=>j.missionId===project.id&&j.metadata?.workflowIntent==="reviewed-holdout");
  if(reviewedJobs.some(j=>!ReviewedHoldoutRunInputSchema.shape.approval.safeParse(j.metadata?.reviewedApproval).success))throw new Error("旧复核审批记录不完整，不能排除先前有效评审。");
  const owner=project.campaign.serverControlOwner;
  const pendingJob=pending?reviewedJobs.find(j=>j.id===pending.controlJobId):undefined;
  const pendingApproval=pendingJob?ReviewedHoldoutRunInputSchema.shape.approval.parse(pendingJob.metadata?.reviewedApproval):undefined;
  if(pending&&(!owner||owner.phase!=="reserved"||owner.controlJobId!==pending.controlJobId||owner.operationKey!==pending.operationKey
    ||!pendingJob||pendingJob.status!=="queued"||pendingJob.generation!==1||pendingJob.idempotencyKey!==pending.operationKey
    ||workflowRunIdForJob(pendingJob,project)||!pendingApproval?.request.invalidOutputRecovery
    ||pendingApproval.request.binding.sourceUpdatedAt!==owner.sourceUpdatedAt||pendingApproval.request.binding.inputSha256!==owner.inputFingerprint
    ||owner.inputFingerprint!==first.binding.inputSha256||pendingJob.metadata?.requestSha256!==reviewedSha(pendingApproval.request)))
    throw new Error("相同请求的恢复预留尚未确认或已发送，不能另起评审。");
  const jobs=reviewedJobs.filter(j=>j.id!==pending?.controlJobId&&sameReviewedHoldoutScope(j.metadata?.reviewedApproval,first.binding)).sort((a,b)=>a.id.localeCompare(b.id));
  if(!jobs.length||jobs.length>8||new Set(jobs.map(j=>j.id)).size!==jobs.length)throw new Error("无法完整核验旧复核作业集合。");
  if(!pending&&(!owner||owner.phase!=="bound"||!jobs.some(j=>j.id===owner.controlJobId&&workflowRunIdForJob(j,project)===owner.runId)))throw new Error("当前暂停不是已绑定的旧复核运行。");
  const priorAttempts=[];let currentResultMatched=false;
  for(const job of jobs){
    const runId=workflowRunIdForJob(job,project);if(!runId||!runtime.events.get)throw new Error("缺少旧 Run 或精确事件读取能力。");
    let sdk:ReviewedSdkEvidence;
    try{sdk=await readReviewedSdkEvidence(runId);}catch{throw new Error("无法核验旧 Workflow 私有完成记录；未启动新的评审。");}
    const result=await runtime.events.get('evt-'+job.id+'-reviewed-hidden-result');
    const admission=await runtime.events.get('evt-'+job.id+'-reviewed-holdout-authorized');
    const proof=certifyReviewedInvalidAttempt(project,job,sdk,result,admission,first.binding);
    if(pending||job.id===owner!.controlJobId){
      if(proof.validationSha256===reviewedSha(project.validationRun))currentResultMatched=true;
      else if(!pending)throw new Error("当前验证与旧私有步骤确认的结果不一致。");
    }
    priorAttempts.push(proof);
  }
  if(!currentResultMatched)throw new Error("当前验证没有已核实的旧私有步骤结果。");
  const recovery=ReviewedInvalidOutputRecoverySchema.parse({schemaVersion:"reviewed-invalid-output-recovery-v1",preserveFailedAttempts:true,acknowledgeNoValidVerdict:true,priorAttempts});
  if(pendingApproval&&reviewedSha(pendingApproval.request.invalidOutputRecovery)!==reviewedSha(recovery))throw new Error("相同恢复请求的原审批证明已变化。");
  const second=await previewReviewedHoldout(project);
  if(reviewedSha(second)!==reviewedSha(first))throw new Error("恢复核验期间文件、输入或模型连接已变化。");
  return ReviewedHoldoutPreviewSchema.parse({...second,invalidOutputRecovery:recovery});
}
