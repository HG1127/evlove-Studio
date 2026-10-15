import {FatalError} from "workflow";
import {z} from "zod";
import {createEvolutionEvent,ReviewedHoldoutRunInputSchema,type EvolveProject,type ReviewedHoldoutRunInput,type EvolutionWorkflowResult} from "@evolution/contracts";
import {reviewedHoldoutBoundary} from "@evolution/harness";
import {LIVE_TARGET_OBSERVATION_MAX_AGE_MS} from "@evolution/core";
import {getServerMissionEnvelope} from "./production-runtime";
import {getServerWorkflowControlRuntime,requireServerWorkflowControlOwner} from "./workflow-control-runtime";
import {reviewedFrozenBindingsMatch,reviewedScope,reviewedSha} from "./reviewed-holdout-identity";
import {readServerHoldoutArtifactFingerprint} from "./server-holdout-artifact-binding";
import {serverAiScoringRouteFingerprint} from "./ai-gateway";
import {runServerMissionHoldout} from "./server-holdout";
import {runServerMissionArtifactAcceptance} from "./server-artifact-acceptance";
import {serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";
import {appendWorkflowControlEvent} from "./workflow-control-events";

const digest=z.string().regex(/^[0-9a-f]{64}$/);
const ContinuationSchema=z.object({generationSha256:digest,scopeSha256:digest,physicalSha256:digest,
  scoringRouteFingerprint:z.string().min(1),controlJobId:z.string().min(1),runId:z.string().min(1),observedAt:z.number().finite().positive()}).strict();
export type ReviewedHoldoutContinuation=z.infer<typeof ContinuationSchema>;
type Execution={result:EvolutionWorkflowResult;continuation?:ReviewedHoldoutContinuation};
const result=(input:ReviewedHoldoutRunInput,reason:string,status:EvolutionWorkflowResult["status"]="waiting-human"):EvolutionWorkflowResult=>({
  missionId:input.missionId,controlJobId:input.controlJobId,status,iterations:1,reason,
});
async function owned(input:ReviewedHoldoutRunInput){
  await requireServerWorkflowControlOwner(input);
  const runtime=getServerWorkflowControlRuntime(input),project=await runtime.missions.get(input.missionId);
  const job=await runtime.jobs.get(input.controlJobId);
  if(!project||!job||job.metadata?.workflowIntent!=="reviewed-holdout"
    ||reviewedSha(job.metadata.reviewedApproval)!==reviewedSha(input.approval))throw new FatalError("人工确认与当前后台作业不一致。");
  if(!reviewedFrozenBindingsMatch(project,input.approval.request.binding))throw new FatalError("REVIEW、冻结 Candidate 或隐藏卷已变化。");
  return {runtime,project};
}
/** Guard across storage/model awaits and then a final independent Mission read. */
async function physicalAndGeneration(input:ReviewedHoldoutRunInput,project:EvolveProject,physical:string,route:string){
  const candidate=project.candidates.find(c=>c.id===input.approval.request.binding.candidateId)!;
  if(await readServerHoldoutArtifactFingerprint({project,candidate})!==physical||await serverAiScoringRouteFingerprint()!==route)
    throw new FatalError("实际文件或模型连接已变化，人工续接权限失效。");
  await requireServerWorkflowControlOwner(input);
  const current=(await getServerMissionEnvelope(project.id))?.payload;
  if(!current||reviewedSha(current)!==reviewedSha(project))throw new FatalError("等待期间 Mission 发生变化，未写入旧验证结果。");
}
async function event(input:ReviewedHoldoutRunInput,phase:string,payload:Record<string,unknown>){
  await appendWorkflowControlEvent(getServerWorkflowControlRuntime(input).events,createEvolutionEvent({
    id:'evt-'+input.controlJobId+'-reviewed-'+phase,missionId:input.missionId,jobId:input.controlJobId,
    type:"ActionCompleted",source:"human-reviewed-holdout",payload,
  }));
}

/** No automatic step retries: a valid Safety verdict must never be retried after an ambiguous save. */
export async function executeReviewedHoldout(raw:unknown):Promise<Execution>{
  const input=ReviewedHoldoutRunInputSchema.parse(raw),{runtime,project}=await owned(input),binding=input.approval.request.binding;
  const reason=reviewedHoldoutBoundary(project);
  if(reason||serverMainFlowRecoveryDigest(project)!==binding.inputSha256)throw new FatalError("人工续接输入已变化："+(reason??"input-generation"));
  await physicalAndGeneration(input,project,binding.physicalSha256,binding.scoringRouteFingerprint);
  const scope=reviewedScope(project);
  // The admission Event retains the complete prior failed pair and original REVIEW. Neither is treated as fresh authority.
  const working:EvolveProject={...project,stage:"experiment",
    validationRun:{id:'reviewed-hidden-'+input.controlJobId,status:"idle",runs:[],baselineRuns:[],checks:[]},
    campaign:{...project.campaign,status:"running",stopReason:undefined,serverRecoveryWait:undefined,
      checkpoint:{...project.campaign.checkpoint!,completedPhase:"experiment"}}};
  const outcome=await runServerMissionHoldout(working);
  if(reviewedScope(outcome.project)!==scope||!reviewedFrozenBindingsMatch(outcome.project,binding))
    throw new FatalError("验证改变了授权范围；未保存结果。");
  // Persist actual verdict before any later await/write can fail. A resumed Run cannot rejudge it.
  await event(input,"hidden-result",{approval:input.approval,validation:outcome.validation,reason:outcome.reason});
  await physicalAndGeneration(input,project,binding.physicalSha256,binding.scoringRouteFingerprint);
  const safetyPass=outcome.validation.evaluation?.safety==="PASS"&&outcome.validation.baselineEvaluation?.safety==="PASS";
  const observedAt=outcome.validation.baselineObservedAt;
  const fresh=!!observedAt&&Date.now()>=observedAt&&Date.now()-observedAt<LIVE_TARGET_OBSERVATION_MAX_AGE_MS;
  const ready=outcome.readyForArtifactAcceptance&&outcome.control==="continue"&&safetyPass&&fresh&&!reviewedHoldoutBoundary(outcome.project,"acceptance");
  const stop=ready?undefined:(!fresh?"新的同卷测量已超出证据时效，未进入 Gate F。":!safetyPass?"新的隐藏同卷评审尚未 Safety PASS；保留结果并暂停。":outcome.reason);
  const saved:EvolveProject={...outcome.project,campaign:{...outcome.project.campaign,status:ready?"running":"paused",
    stopReason:stop,schedule:{...outcome.project.campaign.schedule,enabled:false,nextRunAt:undefined}}};
  await runtime.missions.save(saved);
  // Read the saved generation: private SDK output alone grants the conditional Gate F step.
  const persisted=await runtime.missions.get(project.id);
  if(!persisted||reviewedSha(persisted)!==reviewedSha(saved))throw new FatalError("无法确认已保存的隐藏验证代次。");
  if(!ready)return {result:result(input,stop!)};

  return {result:result(input,"新的同卷验证已完成，等待同一冻结文件 Gate F。","running"),continuation:{
    generationSha256:reviewedSha(persisted),scopeSha256:scope,physicalSha256:binding.physicalSha256,
    scoringRouteFingerprint:binding.scoringRouteFingerprint,controlJobId:input.controlJobId,
    runId:persisted.campaign.serverControlOwner!.runId!,observedAt:observedAt!,
  }};
}

/** Only THIS Run's fresh Hidden output can call Gate F; no cache/public DTO restores this carrier. */
export async function acceptReviewedHoldout(raw:unknown,rawContext:unknown):Promise<EvolutionWorkflowResult>{
  const input=ReviewedHoldoutRunInputSchema.parse(raw),context=ContinuationSchema.parse(rawContext),{runtime,project}=await owned(input);
  const age=Date.now()-context.observedAt;
  if(context.physicalSha256!==input.approval.request.binding.physicalSha256
    ||context.scoringRouteFingerprint!==input.approval.request.binding.scoringRouteFingerprint
    ||context.controlJobId!==input.controlJobId||context.runId!==project.campaign.serverControlOwner?.runId
    ||age<0||age>=LIVE_TARGET_OBSERVATION_MAX_AGE_MS||reviewedSha(project)!==context.generationSha256
    ||reviewedScope(project)!==context.scopeSha256||reviewedHoldoutBoundary(project,"acceptance")
    ||project.validationRun.evaluation?.safety!=="PASS"||project.validationRun.baselineEvaluation?.safety!=="PASS")
    throw new FatalError("同一 Run 的新隐藏验证、时效或审批边界不再满足。");
  await physicalAndGeneration(input,project,context.physicalSha256,context.scoringRouteFingerprint);
  if(Date.now()<context.observedAt||Date.now()-context.observedAt>=LIVE_TARGET_OBSERVATION_MAX_AGE_MS)
    throw new FatalError("等待文件核验期间同卷证据已过期，未进入 Gate F。");
  // No repair: human approval is scoped to this exact frozen Candidate only.
  const outcome=await runServerMissionArtifactAcceptance(project,{repair:false});
  if(!reviewedFrozenBindingsMatch(outcome.project,input.approval.request.binding))throw new FatalError("Gate F 改变了已授权冻结身份。");
  await event(input,"gate-f-result",{candidateId:input.approval.request.binding.candidateId,acceptance:outcome.project.artifactAcceptance,accepted:outcome.accepted,reason:outcome.reason});
  await physicalAndGeneration(input,project,context.physicalSha256,context.scoringRouteFingerprint);
  if(Date.now()<context.observedAt||Date.now()-context.observedAt>=LIVE_TARGET_OBSERVATION_MAX_AGE_MS)
    throw new FatalError("Gate F 结束时同卷证据已过期，未保存通过状态。");
  const reason=outcome.accepted?"同一冻结文件已通过隐藏验证及 Gate F；等待下载并重开完全相同的验收文件。":outcome.reason;
  await runtime.missions.save({...outcome.project,campaign:{...outcome.project.campaign,status:"paused",stopReason:reason,
    schedule:{...outcome.project.campaign.schedule,enabled:false,nextRunAt:undefined}}});
  return result(input,reason,outcome.accepted?"waiting-action":"waiting-human");
}
