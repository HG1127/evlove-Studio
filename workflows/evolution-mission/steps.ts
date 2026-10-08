import { FatalError } from "workflow";
import { campaignScoringInputBlocker } from "@evolution/core";
import {
  EvolutionJobSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  createEvolutionEvent,
  type EvolutionWorkflowResult,
  type EvolutionWorkflowRunInput,
} from "@evolution/contracts";
import { advanceCampaignScheduleAfterServerRun, applyDeterministicRoundtripEvidence, applyProductionLearningGovernance, campaignGoalSatisfied, campaignStopReason, completeAutonomousMission, integrateDistilledLesson, mapTestsToRubric, materializeAcceptedChampionPackage, mergeGovernedNextQueue, normalizeAcceptanceRubric, normalizeEvalSuiteForProject, productionOutcomeFreshness, productionOutcomeTrend, projectHasStableHealthyProductionOutcome, projectHasLiveReleaseDecision, projectHasOnlineReleaseTarget, resetDownstream, rubricSuiteCoverage, rubricValidation } from "@evolution/core";
import {
  advanceServerCampaignPreparation,
  compactServerSourceArtifacts,
  SERVER_SOURCE_CONTEXT_INSTRUCTION,
  serverCampaignScoringRouteBlocker,
  canReuseServerBaseline,
  buildServerHarnessPlan,
  buildWorkflowControlJobUpdate,
  WorkflowControlJobUnavailableError,
  type WorkflowControlJobUpdate,
  serverControlCapabilityWaitPlan,
  serverControlAiWait,
  serverExperimentJudgeWait,
  normalizeLocallyVerifiableCandidateRuns,
  reconcileAttentionRequest,
  type ServerHarnessPlan,
} from "@evolution/harness";
import { getServerProductionRuntime } from "../../apps/backend/src/services/production-runtime";
import { serverAiScoringRouteFingerprint } from "../../apps/backend/src/services/ai-gateway";
import { runServerControlAi as runServerAi, ServerControlAiUnavailableError } from "../../apps/backend/src/services/server-control-ai";
import { restoreServerControlAiWait } from "../../apps/backend/src/services/server-control-ai-recovery";
import { runServerMissionBaseline } from "../../apps/backend/src/services/server-baseline";
import { runServerMissionExperiment } from "../../apps/backend/src/services/server-experiment";
import { runServerMissionHoldout } from "../../apps/backend/src/services/server-holdout";
import { runServerMissionArtifactAcceptance } from "../../apps/backend/src/services/server-artifact-acceptance";
import { runServerMissionRelease } from "../../apps/backend/src/services/server-release-orchestration";
import { runServerMissionReleaseReconciliation } from "../../apps/backend/src/services/server-release-reconciliation";
import { nextProductionMonitorDelay } from "../../apps/backend/src/services/production-monitor";
import { syncMissionCapabilities } from "../../apps/backend/src/services/organization-capability";
import { publishAcceptedChampionToConfiguredGit } from "../../apps/backend/src/services/git-accepted-publisher";
import { renderAcceptedProjectArtifacts } from "../../apps/backend/src/services/server-artifact-renderer";
import { lockGitTargetSnapshot,materializeLockedGitTargetSource } from "../../apps/backend/src/services/git-target-source";
import { lockConnectorTargetSnapshot,materializeLockedConnectorTargetSource } from "../../apps/backend/src/services/connector-target-source";
import { serverAiConfigured } from "../../apps/backend/src/server-env";
import {appendWorkflowControlEvent} from "../../apps/backend/src/services/workflow-control-events";
import {planWorkflowResultFinalization} from "../../apps/backend/src/services/workflow-result-finalization";

async function controlJob(input:EvolutionWorkflowRunInput,args:WorkflowControlJobUpdate){
  const current=await getServerProductionRuntime().jobs.get(input.controlJobId);
  try{
    return buildWorkflowControlJobUpdate(current,input,args,new Date().toISOString());
  }catch(error){
    if(error instanceof WorkflowControlJobUnavailableError)throw new FatalError(error.message);
    throw error;
  }
}

export async function initializeWorkflowControlStep(input:EvolutionWorkflowRunInput){
  "use step";
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
  const startedAt=new Date().toISOString();
  const initializedJob=await controlJob(input,{
    status:input.scheduledFor?"waiting":"running",
    startedAt,
    progress:{percent:1,detail:input.scheduledFor?`Durable Scheduler 已武装，等待 ${input.scheduledFor}`:"Durable Workflow 已接管 Mission control loop"},
  });
  await runtime.jobs.put(initializedJob);
  await runtime.events.append(createEvolutionEvent({
    id:`evt-${input.controlJobId}-started`,
    missionId:input.missionId,
    jobId:input.controlJobId,
    type:"JobStarted",
    at:initializedJob.startedAt??input.requestedAt,
    source:"vercel-workflow-control",
    payload:{runtime:"workflow",phase:input.scheduledFor?"scheduled-wait":"control-loop",scheduledFor:input.scheduledFor},
  }));
  return {missionId:mission.id};
}

function withoutDurableScheduleBinding<T extends {
  durableJobId?:string;
  durableRunId?:string;
  durableScheduledFor?:string;
}>(schedule:T){
  const rest={...schedule};
  delete rest.durableJobId;
  delete rest.durableRunId;
  delete rest.durableScheduledFor;
  return rest;
}

export async function prepareScheduledTriggerStep(
  input:EvolutionWorkflowRunInput,
  scheduledFor:string,
  cycle:number,
):Promise<
  | {control:"run";targetRound?:number}
  | {control:"stop";result:EvolutionWorkflowResult}
>{
  "use step";
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
  const schedule=mission.campaign.schedule;
  const bindingMatches=Boolean(
    schedule.enabled
    &&schedule.nextRunAt===scheduledFor
    &&schedule.durableScheduledFor===scheduledFor
    &&schedule.durableJobId===input.controlJobId,
  );
  if(!bindingMatches||mission.campaign.status==="completed"||mission.campaign.status==="stopped"){
    const now=new Date().toISOString();
    await runtime.jobs.put(await controlJob(input,{
      status:"completed",
      startedAt:input.requestedAt,
      finishedAt:now,
      progress:{percent:100,detail:"计划已取消、改期或失效；本次 Durable 唤醒安全跳过"},
    }));
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-schedule-stale-${cycle}`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      type:"JobProgress",
      source:"vercel-workflow-control",
      payload:{phase:"scheduled-trigger",scheduledFor,stale:true,cycle},
    }));
    return {control:"stop",result:result(input,{
      status:"completed",
      iterations:cycle,
      reason:"计划已取消、改期或已由其他执行路径处理，本次唤醒未执行 Mission。",
    })};
  }

  const now=new Date().toISOString();
  const targetRound=mission.campaign.executionMode==="manual"
    ? mission.campaign.currentRound+1
    : undefined;
  await runtime.missions.save({
    ...mission,
    campaign:{
      ...mission.campaign,
      status:"running",
      startedAt:mission.campaign.startedAt??now,
      completedAt:undefined,
      stopReason:undefined,
    },
    updatedAt:now,
  });
  await runtime.jobs.put(await controlJob(input,{
    status:"running",
    startedAt:input.requestedAt,
    progress:{percent:3,detail:targetRound?`计划触发：执行 Round ${targetRound}`:"计划触发：启动 Auto Campaign"},
  }));
  await runtime.events.append(createEvolutionEvent({
    id:`evt-${input.controlJobId}-schedule-trigger-${cycle}`,
    missionId:input.missionId,
    jobId:input.controlJobId,
    type:"JobProgress",
    source:"vercel-workflow-control",
    payload:{phase:"scheduled-trigger",scheduledFor,stale:false,cycle,targetRound,executionMode:mission.campaign.executionMode},
  }));
  return targetRound===undefined?{control:"run"}:{control:"run",targetRound};
}

export async function settleScheduledManualRoundStep(
  input:EvolutionWorkflowRunInput,
  targetRound:number,
  iteration:number,
):Promise<
  | {settled:false}
  | {settled:true;nextScheduledFor:string;sleepMs:number}
  | {settled:true;result:EvolutionWorkflowResult}
>{
  "use step";
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
  if(mission.campaign.currentRound<targetRound)return {settled:false};

  const nowDate=new Date();
  const now=nowDate.toISOString();
  const stopReason=campaignStopReason(mission);
  if(stopReason){
    const satisfied=campaignGoalSatisfied(mission);
    const champion=mission.searchChampion;
    const hasAcceptedChampion=Boolean(champion?.candidate&&champion.validation&&champion.artifactAcceptance?.status==="passed");
    const outputArtifacts=hasAcceptedChampion
      ? materializeAcceptedChampionPackage(mission,now)
      : mission.outputArtifacts;
    const updated={
      ...mission,
      campaign:{
        ...mission.campaign,
        status:satisfied?"completed" as const:"paused" as const,
        completedAt:satisfied?now:undefined,
        startedAt:undefined,
        stopReason,
        schedule:{
          ...withoutDurableScheduleBinding(mission.campaign.schedule),
          enabled:false,
          lastRunAt:now,
          nextRunAt:undefined,
        },
      },
      outputArtifacts,
      ...(champion?.candidate&&champion.validation&&champion.artifactAcceptance?{
        candidates:[champion.candidate,...mission.candidates.filter((item)=>item.id!==champion.candidate?.id)],
        experimentRun:{...mission.experimentRun,status:"completed" as const,winnerId:champion.candidate.id},
        validationRun:champion.validation,
        artifactAcceptance:champion.artifactAcceptance,
        gates:mission.gates.map((gate)=>gate.id==="artifact-ready"
          ?{...gate,status:"approved" as const,approvedAt:champion.artifactAcceptance?.acceptedAt??now,note:`Campaign 最终 Champion ${champion.versionLabel} · Artifact Acceptance ${champion.artifactAcceptance?.overallScore??0}`}
          :gate.id==="release-ready"
            ?{...gate,status:champion.validation?.recommendation==="release"?"ready" as const:"blocked" as const,approvedAt:undefined,note:`Campaign 完成，最终 Search Champion ${champion.versionLabel}`}
            :gate),
        stage:"validation" as const,
      }:{stage:"learning" as const}),
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.jobs.put(await controlJob(input,{
      status:"completed",
      startedAt:input.requestedAt,
      finishedAt:now,
      progress:{percent:100,detail:stopReason.slice(0,240)},
    }));
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-scheduled-round-stop-${iteration}`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      type:"JobProgress",
      source:"vercel-workflow-control",
      payload:{phase:"scheduled-round-settlement",targetRound,completed:satisfied,reason:stopReason},
    }));
    return {settled:true,result:result(input,{
      status:satisfied?"completed":"blocked",
      iterations:iteration+1,
      reason:stopReason,
    })};
  }

  const durableRunId=mission.campaign.schedule.durableRunId;
  const advanced=advanceCampaignScheduleAfterServerRun(mission.campaign.schedule,nowDate);
  const recurring=Boolean(advanced.enabled&&advanced.nextRunAt);
  const suffix=Date.parse(now)||iteration;
  const nextSchedule=recurring&&advanced.nextRunAt
    ? {
        ...advanced,
        durableJobId:input.controlJobId,
        ...(durableRunId?{durableRunId}:{}),
        durableScheduledFor:advanced.nextRunAt,
      }
    : advanced;
  const updated={
    ...mission,
    campaign:{
      ...mission.campaign,
      status:recurring?"scheduled" as const:"paused" as const,
      startedAt:undefined,
      stopReason:undefined,
      schedule:nextSchedule,
      checkpoint:undefined,
    },
    stage:"baseline" as const,
    candidates:[],
    selectedCandidateIds:[],
    baselineRun:{id:`baseline-r${targetRound+1}-${suffix}`,status:"idle" as const,suiteName:"Core Validation Suite",totalCases:mission.evalSuite.length,runs:[]},
    experimentRun:{id:`experiment-r${targetRound+1}-${suffix}`,status:"idle" as const,candidateResults:[]},
    validationRun:{id:`validation-r${targetRound+1}-${suffix}`,status:"idle" as const,checks:[],runs:[],baselineRuns:[]},
    artifactAcceptance:{
      ...mission.artifactAcceptance,
      id:`artifact-acceptance-r${targetRound+1}-${suffix}`,
      status:"idle" as const,
      candidateId:undefined,
      results:[],
      attempts:0,
      overallScore:0,
      coverageScore:0,
      integrityScore:0,
      pairwiseScore:0,
      hardGatePass:false,
      summary:"等待下一轮 Artifact Acceptance",
      acceptedAt:undefined,
      lastCheckedAt:undefined,
    },
    gates:mission.gates.map((gate)=>gate.id==="target-ready"?gate:{...gate,status:"pending" as const,approvedAt:undefined,note:undefined}),
    updatedAt:now,
  };
  await runtime.missions.save(updated);

  if(recurring&&advanced.nextRunAt){
    const sleepMs=Math.max(0,Date.parse(advanced.nextRunAt)-nowDate.getTime());
    await runtime.jobs.put(await controlJob(input,{
      status:"waiting",
      startedAt:input.requestedAt,
      progress:{percent:5,detail:`Round ${targetRound} 已完成；下一次计划 ${advanced.nextRunAt}`},
    }));
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-scheduled-round-rearm-${iteration}`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      type:"JobProgress",
      source:"vercel-workflow-control",
      payload:{phase:"scheduled-round-settlement",targetRound,nextScheduledFor:advanced.nextRunAt,sleepMs},
    }));
    return {settled:true,nextScheduledFor:advanced.nextRunAt,sleepMs};
  }

  await runtime.jobs.put(await controlJob(input,{
    status:"completed",
    startedAt:input.requestedAt,
    finishedAt:now,
    progress:{percent:100,detail:`计划 Round ${targetRound} 已完成`},
  }));
  return {settled:true,result:result(input,{
    status:"completed",
    iterations:iteration+1,
    reason:`计划 Round ${targetRound} 已完成；当前计划没有下一次触发。`,
  })};
}

export async function planMissionStep(input:EvolutionWorkflowRunInput,iteration:number):Promise<ServerHarnessPlan>{
  "use step";
  const runtime=getServerProductionRuntime();
  let mission=await runtime.missions.get(input.missionId);
  if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
  if(mission.targetConnection.adapter==="connector"
    &&mission.targetConnection.status==="connected"
    &&!mission.sourceArtifacts.some((artifact)=>artifact.role==="target")){
    const locked=await lockConnectorTargetSnapshot(mission);
    if(locked!==mission){
      await runtime.missions.save(locked);
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-connector-snapshot-lock`,
        missionId:input.missionId,jobId:input.controlJobId,
        type:"ActionCompleted",source:"connector-target",
        payload:{
          action:"snapshot-lock",
          connectorId:locked.targetConnection.connectorSnapshot?.connectorId,
          targetId:locked.targetConnection.connectorSnapshot?.targetId,
          versionRef:locked.targetConnection.connectorSnapshot?.versionRef,
          snapshotRef:locked.targetConnection.connectorSnapshot?.snapshotRef,
          artifactId:locked.targetConnection.connectorSnapshot?.artifactId,
        },
      }));
      mission=locked;
    }
    const materialized=await materializeLockedConnectorTargetSource(mission);
    if(materialized!==mission){
      const artifact=materialized.sourceArtifacts.find((item)=>item.id===materialized.targetConnection.connectorSnapshot?.artifactId);
      await runtime.missions.save(materialized);
      if(artifact){
        await runtime.events.append(createEvolutionEvent({
          id:`evt-${input.controlJobId}-connector-artifact-${artifact.id}`,
          missionId:input.missionId,jobId:input.controlJobId,
          type:"ArtifactParsed",source:"connector-target",
          payload:{
            artifactId:artifact.id,name:artifact.name,role:artifact.role,
            connectorId:materialized.targetConnection.connectorSnapshot?.connectorId,
            targetId:materialized.targetConnection.connectorSnapshot?.targetId,
            versionRef:materialized.targetConnection.connectorSnapshot?.versionRef,
            snapshotRef:materialized.targetConnection.connectorSnapshot?.snapshotRef,
            storageRef:artifact.storageRef,
          },
        }));
      }
      mission=materialized;
    }
  }
  if(mission.targetConnection.adapter==="git"
    &&mission.targetConnection.status==="connected"
    &&!mission.sourceArtifacts.some((artifact)=>artifact.role==="target")){
    const locked=await lockGitTargetSnapshot(mission);
    if(locked!==mission){
      await runtime.missions.save(locked);
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-git-snapshot-lock`,
        missionId:input.missionId,jobId:input.controlJobId,
        type:"ActionCompleted",source:"github-target",
        payload:{
          action:"snapshot-lock",
          repository:locked.targetConnection.git?locked.targetConnection.git.owner+"/"+locked.targetConnection.git.repo:undefined,
          commitSha:locked.targetConnection.gitSnapshot?.commitSha,
          treeSha:locked.targetConnection.gitSnapshot?.treeSha,
          artifactId:locked.targetConnection.gitSnapshot?.artifactId,
        },
      }));
      mission=locked;
    }
    const materialized=await materializeLockedGitTargetSource(mission);
    if(materialized!==mission){
      const artifact=materialized.sourceArtifacts.find((item)=>item.id===materialized.targetConnection.gitSnapshot?.artifactId);
      await runtime.missions.save(materialized);
      if(artifact){
        await runtime.events.append(createEvolutionEvent({
          id:`evt-${input.controlJobId}-git-artifact-${artifact.id}`,
          missionId:input.missionId,jobId:input.controlJobId,
          type:"ArtifactParsed",source:"github-target",
          payload:{
            artifactId:artifact.id,name:artifact.name,role:artifact.role,
            commitSha:materialized.targetConnection.gitSnapshot?.commitSha,
            treeSha:materialized.targetConnection.gitSnapshot?.treeSha,
            storageRef:artifact.storageRef,
          },
        }));
      }
      mission=materialized;
    }
  }
  if(serverControlAiWait(mission)||serverExperimentJudgeWait(mission)){
    const currentJob=await runtime.jobs.get(input.controlJobId);
    if(!currentJob || currentJob.missionId!==input.missionId || currentJob.generation!==1
      || !["queued","running","waiting"].includes(currentJob.status)){
      throw new FatalError("控制 Job 不再活动；未恢复模型等待状态。");
    }
    const recovered=await restoreServerControlAiWait(mission);
    if(recovered!==mission){
      await runtime.missions.save(recovered);
      mission=recovered;
    }
  }
  const plan=buildServerHarnessPlan(mission);
  await appendWorkflowControlEvent(runtime.events,createEvolutionEvent({
    id:`evt-${input.controlJobId}-plan-${iteration}`,
    missionId:input.missionId,
    jobId:input.controlJobId,
    checkpointId:plan.checkpoint.id,
    type:"ActionPlanned",
    source:"vercel-workflow-control",
    payload:{
      iteration,
      action:plan.decision.action,
      reason:plan.decision.reason,
      sourceRevision:plan.sourceRevision,
      policy:plan.policy.mode,
    },
  }));
  await appendWorkflowControlEvent(runtime.events,createEvolutionEvent({
    id:`evt-${input.controlJobId}-checkpoint-${iteration}`,
    missionId:input.missionId,
    jobId:input.controlJobId,
    checkpointId:plan.checkpoint.id,
    type:"CheckpointCreated",
    source:"vercel-workflow-control",
    payload:{iteration,stage:plan.checkpoint.stage,round:plan.checkpoint.round,sourceRevision:plan.sourceRevision},
  }));
  return plan;
}

function result(input:EvolutionWorkflowRunInput,args:Omit<EvolutionWorkflowResult,"missionId"|"controlJobId">):EvolutionWorkflowResult{
  return {missionId:input.missionId,controlJobId:input.controlJobId,...args};
}

// Compatibility shim: source budgeting belongs to Harness.
function compactArtifacts(project:Awaited<ReturnType<ReturnType<typeof getServerProductionRuntime>["missions"]["get"]>>){
  return compactServerSourceArtifacts(project);
}

export async function executeServerControlStep(
  input:EvolutionWorkflowRunInput,
  plan:ServerHarnessPlan,
  iteration:number,
):Promise<{control:"continue"|"stop";result?:EvolutionWorkflowResult;sleepMs?:number}>{
  "use step";
  try {
    return await executeServerControlAction(input,plan,iteration);
  } catch (error) {
    if (!(error instanceof ServerControlAiUnavailableError)) throw error;
    const runtime=getServerProductionRuntime();
    const currentJob=await runtime.jobs.get(input.controlJobId);
    // An old Step must not reopen a cancelled, settled or replaced control generation.
    if(!currentJob || currentJob.missionId!==input.missionId || currentJob.generation!==1
      || ["completed","partial","failed","cancelled"].includes(currentJob.status)) {
      return {control:"stop",result:result(input,{
        status:"blocked",iterations:iteration+1,nextAction:plan.decision.action,
        checkpointId:plan.checkpoint.id,reason:"控制 Job 已结束或被替换；未写入能力等待状态。",
      })};
    }
    const mission=await runtime.missions.get(input.missionId);
    if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
    const waitPlan=serverControlCapabilityWaitPlan(plan,{
      stage:mission.stage,reason:error.message,at:new Date().toISOString(),
    });
    return executeServerControlAction(input,waitPlan,iteration);
  }
}

async function executeServerControlAction(
  input:EvolutionWorkflowRunInput,
  plan:ServerHarnessPlan,
  iteration:number,
):Promise<{control:"continue"|"stop";result?:EvolutionWorkflowResult;sleepMs?:number}>{
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
  const now=new Date().toISOString();
  const action=plan.decision.action;

  if(action==="adopt-defaults"){
    const adoptedAt=now;
    const adopted=(plan.decision.autoClarifications??[]).map((item)=>({
      question:item.question,
      answer:item.defaultAnswer.trim(),
      answeredBy:"ai-assumption" as const,
      at:adoptedAt,
    }));
    const hasDownstream=mission.baselineRun.status!=="idle"
      || mission.candidates.length>0
      || mission.experimentRun.status!=="idle";
    const base=hasDownstream?resetDownstream(mission,{nowMs:Date.parse(adoptedAt)}):mission;
    const questions=new Set(adopted.map((item)=>item.question));
    const updated={
      ...base,
      inputClarifications:[
        ...base.inputClarifications.filter((item)=>!questions.has(item.question)),
        ...adopted,
      ],
      commandHistory:[
        ...base.commandHistory,
        {
          id:`cmd-auto-assumption-${Date.parse(adoptedAt)}`,
          role:"system" as const,
          content:`Server Workflow 采用 ${adopted.length} 条低风险默认假设：${adopted.map((item)=>`${item.question} → ${item.answer}`).join("；")}`,
          artifactIds:[],
          createdAt:adoptedAt,
        },
      ],
      updatedAt:adoptedAt,
    };
    await runtime.missions.save(updated);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-control",
      payload:{action,serverNative:true,adoptedCount:adopted.length},
    }));
    return {control:"continue"};
  }

  if(action==="approve-contract"){
    const updated={
      ...mission,
      acceptanceRubricState:{...mission.acceptanceRubricState,confirmedAt:now},
      gates:mission.gates.map((gate)=>gate.id==="target-ready"
        ? {...gate,status:"approved" as const,approvedAt:now,note:"Server Workflow：目标契约完整，自动批准离线 Target Ready"}
        : gate),
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-control",
      payload:{action,serverNative:true},
    }));
    return {control:"continue"};
  }

  if(action==="understand"&&serverAiConfigured()){
    const understood=await runServerAi("understand",{
      command:mission.evolutionCommand,
      goal:mission.goal,
      sourceContextInstruction:SERVER_SOURCE_CONTEXT_INSTRUCTION,
      semanticObject:mission.semanticEvolution?.semanticObject,
      artifacts:compactArtifacts(mission),
      answered:mission.inputClarifications,
    });
    const updated={
      ...mission,
      inputUnderstanding:{...understood,status:"ready" as const,updatedAt:now},
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-ai",
      payload:{action,serverNative:true,confidence:understood.confidence},
    }));
    return {control:"continue"};
  }

  if(action==="compile-contract"&&serverAiConfigured()){
    const generated=await runServerAi("rubric",{
      project:{
        name:mission.name,
        objectType:mission.objectType,
        goal:mission.goal,
        evolutionCommand:mission.evolutionCommand,
        acceptanceCriteria:mission.sourceUnderstanding?.acceptanceCriteria??[],
        protectedItems:mission.protectedItems,
        editableItems:mission.editableItems,
        metrics:mission.metrics,
        sourceUnderstanding:mission.sourceUnderstanding,
        semanticEvolution:mission.semanticEvolution,
      },
      targetArtifacts:compactArtifacts(mission).filter((artifact)=>artifact.role==="target"),
      sourceContextInstruction:SERVER_SOURCE_CONTEXT_INSTRUCTION,
    });
    const criteria=normalizeAcceptanceRubric(generated.criteria,mission);
    const validation=rubricValidation(criteria);
    const hasDownstream=mission.baselineRun.status!=="idle"||mission.evalSuite.length>0||mission.candidates.length>0||mission.gates.find((gate)=>gate.id==="target-ready")?.status==="approved";
    const base=hasDownstream?resetDownstream(mission,{nowMs:Date.parse(now)}):mission;
    const updated={
      ...base,
      acceptanceRubric:criteria,
      acceptanceRubricState:{
        status:validation.ready?"ready" as const:"invalid" as const,
        summary:validation.ready?`Server Workflow 已编译 ${criteria.length} 条项目专属验收标准；Target Ready 必须显式确认。`:"Rubric 仍有结构问题，不能通过 Target Ready。",
        version:mission.acceptanceRubricState.version+1,
        compiledAt:now,
        confirmedAt:undefined,
        weightTotal:validation.weightTotal,
        uncoveredCriterionIds:[],
        warnings:validation.warnings,
      },
      gates:base.gates.map((gate)=>gate.id==="target-ready"
        ? {...gate,status:validation.ready?"ready" as const:"blocked" as const,approvedAt:undefined,note:validation.ready?"Acceptance Rubric 已 Ready，等待确认":validation.warnings.join("；")}
        : gate),
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-ai",
      payload:{action,serverNative:true,criteriaCount:criteria.length,ready:validation.ready},
    }));
    return {control:"continue"};
  }

  if(action==="build-eval"&&serverAiConfigured()){
    const rubricCheck=rubricValidation(mission.acceptanceRubric);
    if(!rubricCheck.ready)throw new FatalError("Acceptance Rubric 尚未 Ready："+rubricCheck.warnings.join("；"));
    const generated=await runServerAi("eval-suite",{
      sourceContextInstruction:SERVER_SOURCE_CONTEXT_INSTRUCTION,
      project:{
        objectType:mission.objectType,
        department:mission.department,
        goal:mission.goal,
        problemStatement:mission.problemStatement,
        desiredOutcome:mission.desiredOutcome,
        metrics:mission.metrics,
        protectedItems:mission.protectedItems,
        editableItems:mission.editableItems,
        acceptanceRubric:mission.acceptanceRubric,
        artifacts:compactArtifacts(mission),
      },
    });
    const mappedRaw=mapTestsToRubric(mission.acceptanceRubric,generated.validationCases,generated.hiddenCases);
    const mapped=normalizeEvalSuiteForProject(mission,mappedRaw.validationCases,mappedRaw.hiddenCases);
    const coverage=rubricSuiteCoverage(mission.acceptanceRubric,mapped.validationCases,mapped.hiddenCases);
    const hiddenHardGates=coverage.hiddenHardGateMissing.map((criterion)=>criterion.id);
    const warnings=[
      ...(coverage.uncovered.length?[`${coverage.uncovered.length} 条 Criterion 未映射测试题`]:[]),
      ...(hiddenHardGates.length?[`Hard Gate 未覆盖 Hidden Holdout：${hiddenHardGates.join(", ")}`]:[]),
    ];
    const updated={
      ...mission,
      acceptanceRubricState:{
        ...mission.acceptanceRubricState,
        status:warnings.length?"invalid" as const:"ready" as const,
        summary:warnings.length?"Eval Suite 未完全覆盖 Acceptance Rubric。":`Rubric ${mission.acceptanceRubric.length} 条均已映射测试，Hard Gate 已进入 Hidden Holdout。`,
        weightTotal:rubricCheck.weightTotal,
        uncoveredCriterionIds:[...new Set([...coverage.uncovered,...hiddenHardGates])],
        warnings,
      },
      artifactAcceptance:{id:`artifact-acceptance-${plan.checkpoint.id}`,status:"idle" as const,overallScore:0,coverageScore:0,integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,maxRepairAttempts:mission.artifactAcceptance.maxRepairAttempts||3,summary:"等待 Best-Ever / Winner Artifact 验收"},
      evalSuite:mapped.validationCases,
      hiddenEvalSuite:mapped.hiddenCases,
      baselineRun:{...mission.baselineRun,status:"idle" as const,totalCases:mapped.validationCases.length,result:undefined,runs:[]},
      problems:[],selectedProblemId:undefined,diagnosis:undefined,candidates:[],selectedCandidateIds:[],
      experimentRun:{id:`experiment-${plan.checkpoint.id}`,status:"idle" as const,candidateResults:[]},
      validationRun:{id:`validation-${plan.checkpoint.id}`,status:"idle" as const,checks:[],runs:[],baselineRuns:[]},
      gates:mission.gates.map((gate)=>gate.id==="target-ready"
        ? {...gate,status:warnings.length?"blocked" as const:gate.status==="approved"?"approved" as const:"ready" as const,note:warnings.length?warnings.join("；"):"Acceptance Rubric 与 Eval/Hidden 映射完整"}
        : {...gate,status:"pending" as const,approvedAt:undefined,note:undefined}),
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-ai",
      payload:{action,serverNative:true,visibleCases:mapped.validationCases.length,hiddenCases:mapped.hiddenCases.length,coverageReady:warnings.length===0},
    }));
    return {control:"continue"};
  }

  if(action==="run-campaign"){
    if(!serverAiConfigured()){
      const reason="[server-campaign-ai-pending] Campaign Planning Server Step 已实现，但服务器 AI 尚未配置。";
      const updated={
        ...mission,
        campaign:{
          ...mission.campaign,
          status:"paused" as const,
          stopReason:reason,
          schedule:{...mission.campaign.schedule,enabled:false,nextRunAt:undefined},
        },
        stage:mission.stage,
        updatedAt:now,
      };
      await runtime.missions.save(updated);
      await runtime.jobs.put(await controlJob(input,{
        status:"waiting",
        startedAt:input.requestedAt,
        progress:{percent:20,detail:"Campaign Planning 已迁到 Server，等待 Server AI 配置"},
      }));
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-campaign-ai-pending-${iteration}`,
        missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
        type:"JobProgress",source:"vercel-workflow-control",
        payload:{action,serverNative:true,conditional:true,phase:"ai-config",reason},
      }));
      return {control:"stop",result:result(input,{
        status:"waiting-action",iterations:iteration+1,nextAction:action,
        checkpointId:plan.checkpoint.id,reason,
      })};
    }

    const scoringRouteFingerprint=serverAiScoringRouteFingerprint();
    const scoringRouteBlocker=serverCampaignScoringRouteBlocker(mission,scoringRouteFingerprint);
    const scoringBlocker=campaignScoringInputBlocker(mission)??scoringRouteBlocker;
    if(scoringBlocker){
      const updated={
        ...mission,
        campaign:{
          ...mission.campaign,
          status:"paused" as const,
          stopReason:scoringBlocker,
          schedule:{...mission.campaign.schedule,enabled:false,nextRunAt:undefined},
        },
        updatedAt:now,
      };
      await runtime.missions.save(updated);
      await runtime.jobs.put(await controlJob(input,{
        status:"waiting",
        startedAt:input.requestedAt,
        progress:{percent:20,detail:scoringBlocker.slice(0,240)},
      }));
      await runtime.events.append(createEvolutionEvent({
        id:"evt-"+input.controlJobId+"-campaign-scoring-contract-"+iteration,
        missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
        type:"JobProgress",source:"vercel-workflow-control",
        payload:{action,serverNative:true,conditional:true,phase:"scoring-contract",reason:scoringBlocker},
      }));
      return {control:"stop",result:result(input,{
        status:"waiting-action",iterations:iteration+1,nextAction:action,
        checkpointId:plan.checkpoint.id,reason:scoringBlocker,
      })};
    }
    let campaignMission=mission;
    if(!canReuseServerBaseline(campaignMission,scoringRouteFingerprint)){
      const baselineOutcome=await runServerMissionBaseline(campaignMission);
      campaignMission=baselineOutcome.project;
      await runtime.missions.save(campaignMission);
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-campaign-baseline-${iteration}`,
        missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
        type:baselineOutcome.ready?"ActionCompleted":"JobProgress",
        source:"vercel-workflow-control",
        payload:{
          action,
          phase:"baseline",
          serverNative:true,
          ready:baselineOutcome.ready,
          reason:baselineOutcome.reason,
          capabilityGaps:baselineOutcome.capabilityGaps,
          verified:baselineOutcome.baseline.runs.filter((run)=>run.verificationStatus==="verified").length,
          partial:baselineOutcome.baseline.runs.filter((run)=>run.verificationStatus==="partial").length,
          unverified:baselineOutcome.baseline.runs.filter((run)=>run.verificationStatus==="unverified").length,
          failed:baselineOutcome.baseline.runs.filter((run)=>run.verificationStatus==="failed").length,
        },
      }));
      if(!baselineOutcome.ready){
        await runtime.jobs.put(await controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:28,detail:baselineOutcome.reason.slice(0,240)},
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:baselineOutcome.reason,
        })};
      }
      await runtime.jobs.put(await controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:30,detail:"Server Baseline 已完成并达到诊断证据门槛"},
      }));
    }

    const round=campaignMission.campaign.currentRound+1;
    const campaignCheckpoint=campaignMission.campaign.checkpoint;
    if(campaignCheckpoint?.round===round
      && campaignCheckpoint.completedPhase==="experiment"
      && campaignMission.experimentRun.status==="completed"
      && (campaignMission.experimentRun.winnerId||campaignMission.experimentRun.pendingEvidenceCandidateId)){
      const candidateId=campaignMission.experimentRun.winnerId??campaignMission.experimentRun.pendingEvidenceCandidateId;
      const holdoutOutcome=await runServerMissionHoldout(campaignMission);
      campaignMission=holdoutOutcome.project;
      await runtime.missions.save(campaignMission);
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-campaign-holdout-${iteration}`,
        missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
        type:holdoutOutcome.control==="continue"?"ActionCompleted":"JobProgress",source:"vercel-workflow-control",
        payload:{
          action,serverNative:true,conditional:true,phase:"holdout",candidateId,
          readyForArtifactAcceptance:holdoutOutcome.readyForArtifactAcceptance,
          evidenceIncomplete:holdoutOutcome.evidenceIncomplete,
          recommendation:holdoutOutcome.validation.recommendation,
          reason:holdoutOutcome.reason,
        },
      }));
      if(holdoutOutcome.control==="stop"){
        await runtime.jobs.put(await controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:70,detail:holdoutOutcome.reason.slice(0,240)},
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:holdoutOutcome.reason,
        })};
      }
      await runtime.jobs.put(await controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:72,detail:holdoutOutcome.reason.slice(0,240)},
      }));
      return {control:"continue"};
    }

    if(campaignCheckpoint?.round===round
      && campaignCheckpoint.completedPhase==="validation"
      && campaignMission.validationRun.status==="completed"){
      const acceptanceOutcome=await runServerMissionArtifactAcceptance(campaignMission);
      campaignMission=acceptanceOutcome.project;
      await runtime.missions.save(campaignMission);
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-campaign-artifact-acceptance-${iteration}`,
        missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
        type:acceptanceOutcome.control==="continue"?"ActionCompleted":"JobProgress",source:"vercel-workflow-control",
        payload:{
          action,
          serverNative:true,
          conditional:true,
          phase:"artifact-acceptance",
          accepted:acceptanceOutcome.accepted,
          repaired:acceptanceOutcome.repaired,
          championChanged:acceptanceOutcome.championChanged,
          candidateId:campaignMission.artifactAcceptance.candidateId??campaignMission.validationRun.candidateId,
          reason:acceptanceOutcome.reason,
        },
      }));
      if(acceptanceOutcome.control==="stop"){
        await runtime.jobs.put(await controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:80,detail:acceptanceOutcome.reason.slice(0,240)},
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:acceptanceOutcome.reason,
        })};
      }
      await runtime.jobs.put(await controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:acceptanceOutcome.accepted?86:80,detail:acceptanceOutcome.reason.slice(0,240)},
      }));
      return {control:"continue"};
    }

    if(campaignCheckpoint?.round===round&&campaignCheckpoint.completedPhase==="plan"){
      const experimentOutcome=await runServerMissionExperiment(campaignMission);
      campaignMission=experimentOutcome.project;
      await runtime.missions.save(campaignMission);
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-campaign-experiment-${iteration}`,
        missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
        type:experimentOutcome.control==="continue"?"ActionCompleted":"JobProgress",
        source:"vercel-workflow-control",
        payload:{
          action,
          phase:"experiment",
          serverNative:true,
          readyForHoldout:experimentOutcome.readyForHoldout,
          winnerId:experimentOutcome.winnerId,
          pendingEvidenceCandidateId:experimentOutcome.pendingEvidenceCandidateId,
          builtCount:experimentOutcome.builtCount,
          buildFailureCount:experimentOutcome.buildFailureCount,
          reason:experimentOutcome.reason,
        },
      }));
      if(experimentOutcome.control==="stop"){
        await runtime.jobs.put(await controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:60,detail:experimentOutcome.reason.slice(0,240)},
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:experimentOutcome.reason,
        })};
      }
      await runtime.jobs.put(await controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{
          percent:experimentOutcome.readyForHoldout?64:58,
          detail:experimentOutcome.reason.slice(0,240),
        },
      }));
      return {control:"continue"};
    }
    const outcome=await advanceServerCampaignPreparation(campaignMission,{
      problemAnalysis:(payload)=>runServerAi("problem-analysis",payload),
      diagnose:(payload)=>runServerAi("diagnose",payload),
      plan:(payload)=>runServerAi("plan",payload),
    });
    await runtime.missions.save(outcome.project);
    const phasePercent=outcome.phase==="problem"?32:outcome.phase==="diagnose"?42:outcome.phase==="plan"?52:outcome.phase==="experiment"?60:outcome.phase==="settled"?80:24;
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-campaign-${iteration}-${outcome.phase}`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:outcome.control==="continue"?"ActionCompleted":"JobProgress",
      source:outcome.phase==="problem"||outcome.phase==="diagnose"||outcome.phase==="plan"?"vercel-workflow-ai":"vercel-workflow-control",
      payload:{
        action,
        serverNative:true,
        conditional:true,
        phase:outcome.phase,
        reason:outcome.reason,
        candidateCount:outcome.candidateCount,
        ungroundedCount:outcome.ungroundedCount,
        completed:outcome.completed,
      },
    }));

    if(outcome.completed){
      await runtime.jobs.put(await controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:phasePercent,detail:"Campaign 已满足停止条件；继续进入成果打包/学习闭环"},
      }));
      return {control:"continue"};
    }
    if(outcome.control==="continue"){
      await runtime.jobs.put(await controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:phasePercent,detail:`Server Campaign · ${outcome.phase} 已完成，继续下一阶段`},
      }));
      return {control:"continue"};
    }
    await runtime.jobs.put(await controlJob(input,{
      status:"waiting",
      startedAt:input.requestedAt,
      progress:{percent:phasePercent,detail:outcome.reason.slice(0,240)},
    }));
    return {control:"stop",result:result(input,{
      status:"waiting-action",iterations:iteration+1,nextAction:action,
      checkpointId:plan.checkpoint.id,reason:outcome.reason,
    })};
  }

  if(action==="revalidate"){
    const candidateId=mission.experimentRun.winnerId??mission.experimentRun.pendingEvidenceCandidateId??mission.validationRun.candidateId;
    const searchChampionCandidate=mission.searchChampion?.candidate;
    const candidate=mission.candidates.find((item)=>item.id===candidateId)??(searchChampionCandidate?.id===candidateId?searchChampionCandidate:undefined);
    const evaluation=mission.validationRun.evaluation;
    const pendingIds=evaluation?.unverifiedCriterionIds??[];
    const pendingCriteria=pendingIds.flatMap((id)=>{
      const criterion=mission.acceptanceRubric.find((item)=>item.id===id);
      return criterion?[criterion]:[];
    });
    const deterministicOnly=Boolean(
      candidate
      && evaluation
      && pendingCriteria.length
      && pendingCriteria.length===pendingIds.length
      && pendingCriteria.every((criterion)=>criterion.validationMethod==="format-roundtrip")
      && mission.artifactAcceptance.status!=="unverified",
    );
    if(deterministicOnly&&candidate&&evaluation){
      const pendingSet=new Set(pendingIds);
      const testCases=mission.hiddenEvalSuite.filter((testCase)=>testCase.criterionIds.some((id)=>pendingSet.has(id)));
      const seedRuns=testCases.map((testCase)=>({
        testCaseId:testCase.id,
        output:"SERVER SNAPSHOT EVIDENCE PENDING",
        latencyMs:0,
        cost:0,
        trace:[],
        verificationStatus:"unverified" as const,
      }));
      const deterministicRuns=normalizeLocallyVerifiableCandidateRuns(mission,candidate,testCases,seedRuns);
      const settlement=applyDeterministicRoundtripEvidence({
        criteria:mission.acceptanceRubric,
        testCases,
        runs:deterministicRuns,
        evaluation,
      });
      const settled=new Set(settlement.settledCriterionIds);
      if(pendingCriteria.every((criterion)=>settled.has(criterion.id))){
        const runById=new Map(mission.validationRun.runs.map((run)=>[run.testCaseId,run]));
        for(const run of deterministicRuns)runById.set(run.testCaseId,run);
        const settledTitles=pendingCriteria.map((criterion)=>criterion.title);
        const coverage=settlement.evaluation.verifiedRubricCoverage??0;
        const rubricScore=settlement.evaluation.rubricScore;
        const checks=mission.validationRun.checks
          .filter((check)=>!settledTitles.some((title)=>check.label.includes(title)&&check.status==="warning"))
          .map((check)=>check.label==="Project-specific Rubric"
            ? {...check,status:coverage===100&&rubricScore!==undefined&&rubricScore>=85?"pass" as const:"warning" as const,detail:`Rubric ${rubricScore??"待评"} / 85；真实证据覆盖 ${coverage}%。`}
            : check);
        for(const criterion of pendingCriteria){
          checks.push({
            label:`Deterministic · ${criterion.title}`,
            status:"pass" as const,
            detail:`Criterion ${criterion.id} 已由 Durable Workflow 对当前 Candidate Snapshot 执行原格式 Roundtrip 并逐字验证。`,
          });
        }
        const remaining=settlement.evaluation.unverifiedCriterionIds??[];
        const summary=remaining.length
          ? `Durable Workflow 已补齐 ${settlement.settledCriterionIds.length} 项确定性证据；仍有 ${remaining.length} 项需要其他验证能力。`
          : "Durable Workflow 已补齐全部确定性 Roundtrip 证据；最终 Release Review 仍需独立评审能力，未自动放行。";
        const updated={
          ...mission,
          validationRun:{
            ...mission.validationRun,
            evaluation:settlement.evaluation,
            runs:[...runById.values()],
            checks,
            recommendation:"hold" as const,
            summary,
          },
          campaign:{
            ...mission.campaign,
            status:"paused" as const,
            stopReason:`[server-release-review-required] ${summary}`,
          },
          stage:"validation" as const,
          updatedAt:now,
        };
        await runtime.missions.save(updated);
        await runtime.jobs.put(await controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:70,detail:"确定性 Snapshot 复验已完成；等待独立 Release Review"},
        }));
        await runtime.events.append(createEvolutionEvent({
          id:`evt-${input.controlJobId}-action-${iteration}-complete`,
          missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
          type:"ActionCompleted",source:"vercel-workflow-control",
          payload:{
            action,
            serverNative:true,
            conditional:true,
            evidenceMode:"deterministic-roundtrip",
            settledCriterionIds:settlement.settledCriterionIds,
            remainingCriterionIds:remaining,
          },
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:summary,
        })};
      }
    }
  }

  if(action==="distill"&&serverAiConfigured()){
    const winnerId=mission.experimentRun.winnerId??mission.searchChampion?.candidate?.id;
    const winner=mission.candidates.find((candidate)=>candidate.id===winnerId)??mission.searchChampion?.candidate;
    if(!winner)throw new FatalError("没有已验证 Winner，无法提炼经验");
    const hasLiveDecision=projectHasLiveReleaseDecision(mission);
    const releaseFreshness=productionOutcomeFreshness(mission);
    const releaseTrend=productionOutcomeTrend(mission);
    const hasStableLiveOutcome=hasLiveDecision&&mission.release.status==="promoted"&&projectHasStableHealthyProductionOutcome(mission);
    const hasOfflineAcceptance=!projectHasOnlineReleaseTarget(mission)
      &&mission.artifactAcceptance.status==="passed"
      &&mission.artifactAcceptance.candidateId===winner.id;
    if(!hasLiveDecision&&!hasOfflineAcceptance)throw new FatalError("尚未完成可用于经验提炼的成果验收");
    const parsed=await runServerAi("distill",{
      project:{goal:mission.goal,command:mission.evolutionCommand,artifacts:compactArtifacts(mission)},
      baseline:mission.baselineRun.result,
      winner,
      validation:mission.validationRun,
      release:mission.release,
      releaseFreshness,
      releaseTrend,
    });
    const lesson=!hasStableLiveOutcome&&parsed.status==="verified-skill"
      ? {...parsed,status:"lesson" as const,validatedOn:[...parsed.validatedOn,hasLiveDecision
        ?`Production Outcome 尚未达到稳定线上证据门槛：${releaseTrend.reason}`
        :"离线成果验收（尚无线上生产证据）"]}
      : parsed;
    const integrated=integrateDistilledLesson(mission,{id:`lesson-${plan.checkpoint.id}`,...lesson},{at:now});
    const learned=applyProductionLearningGovernance(
      {...mission,lessons:integrated.lessons,stage:"learning",updatedAt:now},
      {at:now,now:Date.parse(now)},
    );
    await runtime.missions.save(learned);
    const capabilitySync=await syncMissionCapabilities(learned).catch((error)=>({
      configured:true,
      workspaceId:undefined,
      missionId:learned.id,
      synced:0,
      archived:0,
      message:error instanceof Error?error.message:String(error),
    }));
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-ai",
      payload:{action,serverNative:true,lessonId:integrated.lesson.id,status:integrated.lesson.status,capabilitySync},
    }));
    return {control:"continue"};
  }

  if(action==="next-queue"&&serverAiConfigured()){
    if(!mission.lessons.length)throw new FatalError("请先提炼本轮 Lesson / Anti-pattern");
    const generated=await runServerAi("next-queue",{
      project:{
        goal:mission.goal,
        desiredOutcome:mission.desiredOutcome,
        problems:mission.problems.slice(0,12).map((item)=>({id:item.id,title:item.title,impact:item.impact,severity:item.severity,status:item.status,summary:item.summary})),
        lessons:mission.lessons.slice(0,8),
        validation:{recommendation:mission.validationRun.recommendation,summary:mission.validationRun.summary,failedChecks:mission.validationRun.checks.filter((item)=>item.status==="fail").slice(0,8)},
        artifactAcceptance:{status:mission.artifactAcceptance.status,score:mission.artifactAcceptance.overallScore,summary:mission.artifactAcceptance.summary},
        release:{status:mission.release.status,evidenceMode:mission.release.evidenceMode,healthy:mission.release.healthy,kpis:mission.release.kpis.slice(0,8)},
        lastGapAdvice:mission.campaign.lastGapAdvice,
      },
    });
    await runtime.missions.save({...mission,nextQueue:mergeGovernedNextQueue(mission.nextQueue,generated.items),stage:"learning",updatedAt:now});
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-ai",
      payload:{action,serverNative:true,itemCount:generated.items.length,recommendedId:generated.recommendedId},
    }));
    return {control:"continue"};
  }

  if(action==="package"){
    const artifacts=materializeAcceptedChampionPackage(mission,now);
    const serverRendered=await renderAcceptedProjectArtifacts(mission,artifacts);
    const updated={
      ...mission,
      outputArtifacts:serverRendered.outputArtifacts,
      artifactAcceptance:mission.searchChampion!.artifactAcceptance!,
      stage:"learning" as const,
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    const gitPublish=await publishAcceptedChampionToConfiguredGit(updated);
    const packaged=gitPublish?.mutation.commitSha?{
      ...updated,
      stage:"release" as const,
      release:{
        ...updated.release,
        candidateId:gitPublish.candidateId,
        sourceGitCommitSha:gitPublish.mutation.commitSha,
        sourceGitBranch:gitPublish.mutation.branch,
        sourceGitRepository:gitPublish.mutation.repository,
        sourceGitPullNumber:gitPublish.pullRequest?.pullNumber,
        sourceGitPullUrl:gitPublish.pullRequest?.pullUrl,
      },
      updatedAt:new Date().toISOString(),
    }:updated;
    if(packaged!==updated)await runtime.missions.save(packaged);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",
      source:"vercel-workflow-control",
      payload:{
        action,
        serverNative:true,
        artifactCount:artifacts.length,
        renderedCount:serverRendered.receipts.length,
        renderedArtifactRefs:serverRendered.receipts.map((item)=>item.artifactRef),
        renderedArtifactHashes:serverRendered.receipts.map((item)=>item.sha256),
        gitPublished:Boolean(gitPublish),
        gitBranch:gitPublish?.mutation.branch,
        gitCommitSha:gitPublish?.mutation.commitSha,
        gitRepository:gitPublish?.mutation.repository,
        gitPullNumber:gitPublish?.pullRequest?.pullNumber,
        gitPullUrl:gitPublish?.pullRequest?.pullUrl,
      },
    }));
    return {control:"continue"};
  }

  if(action==="run-release"){
    const releaseOutcome=await runServerMissionRelease(mission);
    await runtime.missions.save(releaseOutcome.project);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-release-${iteration}-${releaseOutcome.action??"blocked"}`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      checkpointId:plan.checkpoint.id,
      type:releaseOutcome.control==="continue"?"ActionCompleted":"JobProgress",
      source:"vercel-workflow-release",
      payload:{
        action,
        releaseAction:releaseOutcome.action,
        serverNative:true,
        terminal:releaseOutcome.terminal,
        releaseStatus:releaseOutcome.project.release.status,
        candidateId:releaseOutcome.project.release.candidateId,
        deploymentId:releaseOutcome.project.release.deploymentId,
        stableDeploymentId:releaseOutcome.project.release.stableDeploymentId,
        outcomeTelemetry:releaseOutcome.outcomeTelemetry,
        reason:releaseOutcome.reason,
      },
    }));
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-release-audit-${iteration}-${releaseOutcome.action??"blocked"}`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      checkpointId:plan.checkpoint.id,
      type:"ReleaseChanged",
      source:"vercel-workflow-release-audit",
      payload:{
        requestedAction:releaseOutcome.action,
        effectiveAction:releaseOutcome.project.release.recovery
          ?undefined
          :releaseOutcome.project.release.history.at(-1)?.action,
        releaseStatus:releaseOutcome.project.release.status,
        candidateId:releaseOutcome.project.release.candidateId,
        deploymentId:releaseOutcome.project.release.deploymentId,
        stableDeploymentId:releaseOutcome.project.release.stableDeploymentId,
        artifactHashes:releaseOutcome.project.release.artifactHashes,
        evidenceMode:releaseOutcome.project.release.evidenceMode,
        observedAt:releaseOutcome.project.release.observedAt,
        healthy:releaseOutcome.project.release.healthy,
        observationStatus:releaseOutcome.project.release.observationStatus,
        recovery:releaseOutcome.project.release.recovery,
        outcomeTelemetry:releaseOutcome.outcomeTelemetry,
        reason:releaseOutcome.reason,
      },
    }));
    if(releaseOutcome.control==="stop"){
      await runtime.jobs.put(await controlJob(input,{
        status:"waiting",
        startedAt:input.requestedAt,
        progress:{percent:88,detail:releaseOutcome.reason.slice(0,240)},
      }));
      return {control:"stop",result:result(input,{
        status:"waiting-action",iterations:iteration+1,nextAction:action,
        checkpointId:plan.checkpoint.id,reason:releaseOutcome.reason,
      })};
    }
    await runtime.jobs.put(await controlJob(input,{
      status:"running",
      startedAt:input.requestedAt,
      progress:{percent:releaseOutcome.terminal?94:90,detail:releaseOutcome.reason.slice(0,240)},
    }));
    return {control:"continue"};
  }

  if(action==="reconcile-release"){
    const reconcileOutcome=await runServerMissionReleaseReconciliation(mission);
    const monitor=nextProductionMonitorDelay(reconcileOutcome.project,reconcileOutcome.observedAt);
    const previewBindingPending=Boolean(
      reconcileOutcome.provider==="vercel"
      &&reconcileOutcome.project.release.sourceGitCommitSha
      &&reconcileOutcome.project.release.status==="idle"
      &&reconcileOutcome.project.release.recovery?.status==="pending"
      &&reconcileOutcome.project.release.recovery.action==="shadow"
      &&(!reconcileOutcome.project.release.deploymentId
        ||reconcileOutcome.previewReady!==true),
    );
    const nextDelayMs=monitor?.delayMs??(previewBindingPending?15_000:undefined);
    await runtime.missions.save(reconcileOutcome.project);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-release-reconcile-${iteration}`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      checkpointId:plan.checkpoint.id,
      type:"ReleaseChanged",
      source:"workflow-release-reconcile",
      payload:{
        provider:reconcileOutcome.provider,
        disposition:reconcileOutcome.disposition,
        releaseStatus:reconcileOutcome.project.release.status,
        candidateId:reconcileOutcome.project.release.candidateId,
        deploymentId:reconcileOutcome.project.release.deploymentId,
        stableDeploymentId:reconcileOutcome.project.release.stableDeploymentId,
        artifactHashes:reconcileOutcome.project.release.artifactHashes,
        evidenceMode:reconcileOutcome.project.release.evidenceMode,
        observedAt:reconcileOutcome.project.release.observedAt,
        recovery:reconcileOutcome.project.release.recovery,
        productionDeploymentId:reconcileOutcome.productionDeploymentId,
        boundDeploymentId:reconcileOutcome.boundDeploymentId,
        productionHealthReady:reconcileOutcome.productionHealthReady,
        boundHealthReady:reconcileOutcome.boundHealthReady,
        checkedAt:reconcileOutcome.observedAt,
        observationErrors:reconcileOutcome.observationErrors,
        reason:reconcileOutcome.reason,
        nextObservationDelayMs:nextDelayMs,
        productionTrend:monitor?.trend.status,
        productionMonitorReason:monitor?.reason,
      },
    }));
    if(reconcileOutcome.control==="stop"){
      await runtime.jobs.put(await controlJob(input,{
        status:"waiting",
        startedAt:input.requestedAt,
        progress:{percent:89,detail:reconcileOutcome.reason.slice(0,240)},
      }));
      return {control:"stop",result:result(input,{
        status:"waiting-human",iterations:iteration+1,nextAction:action,
        checkpointId:plan.checkpoint.id,reason:reconcileOutcome.reason,
      })};
    }
    await runtime.jobs.put(await controlJob(input,{
      status:"running",
      startedAt:input.requestedAt,
      progress:{
        percent:reconcileOutcome.disposition==="terminal-live-decision"?94:90,
        detail:(monitor?.reason??reconcileOutcome.reason).slice(0,240),
      },
    }));
    return {control:"continue",sleepMs:nextDelayMs};
  }

  if(action==="wait-human"){
    const updated={
      ...reconcileAttentionRequest(mission,plan.decision.attention),
      campaign:{...mission.campaign,status:"paused" as const,stopReason:plan.decision.reason},
      stage:plan.decision.stage,
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.jobs.put(await controlJob(input,{
      status:"waiting",
      startedAt:input.requestedAt,
      checkpointId:plan.checkpoint.id,
      progress:{percent:50,detail:`等待人工：${plan.decision.attention?.title??plan.decision.reason}`},
    }));
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-attention-${iteration}`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"AttentionRequired",source:"vercel-workflow-control",
      payload:{action,title:plan.decision.attention?.title,reason:plan.decision.reason},
    }));
    return {control:"stop",result:result(input,{
      status:"waiting-human",iterations:iteration+1,nextAction:action,
      checkpointId:plan.checkpoint.id,reason:plan.decision.reason,
    })};
  }

  if(action==="complete"){
    const completed=completeAutonomousMission(reconcileAttentionRequest(mission),{at:now,reason:plan.decision.reason});
    await runtime.missions.save(completed);
    await runtime.jobs.put(await controlJob(input,{
      status:"completed",startedAt:input.requestedAt,finishedAt:now,
      progress:{percent:100,detail:"Mission durable control loop 已完成"},
    }));
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-completed`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"JobCompleted",source:"vercel-workflow-control",
      payload:{iterations:iteration+1},
    }));
    return {control:"stop",result:result(input,{
      status:"completed",iterations:iteration+1,checkpointId:plan.checkpoint.id,reason:plan.decision.reason,
    })};
  }

  // Every other AutonomousAction has returned above. Reaching this point is therefore a
  // capability wait, never a "migration pending" state: five AI actions can wait for Server AI,
  // while revalidate can wait for non-deterministic Runner/visual/human evidence.
  const capabilityPendingAction:
    |"understand"
    |"compile-contract"
    |"build-eval"
    |"revalidate"
    |"distill"
    |"next-queue"=action;
  const aiCapabilityPending=capabilityPendingAction!=="revalidate"&&!serverAiConfigured();
  const actionJobId=`action:${input.missionId}:${plan.checkpoint.id}:${capabilityPendingAction}`;
  const existing=await runtime.jobs.get(actionJobId).catch(()=>undefined);
  await runtime.jobs.put(EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,
    id:actionJobId,
    missionId:input.missionId,
    type:"mission-action",
    status:"waiting",
    label:`Harness · ${capabilityPendingAction}`,
    idempotencyKey:`${input.missionId}:${plan.checkpoint.id}:${capabilityPendingAction}`,
    generation:existing?.generation??1,
    attempts:existing?.attempts??0,
    priority:60,
    checkpointId:plan.checkpoint.id,
    inputRef:capabilityPendingAction,
    progress:{percent:0,detail:aiCapabilityPending
      ?"Server AI Step 已实现，等待服务器 AI 配置"
      :"确定性 Roundtrip 可由 Server 自动复验；当前 Mission 仍需要 Runner / 视觉 / AI 或人工证据能力"},
    createdAt:existing?.createdAt??now,
    updatedAt:now,
  }));
  await runtime.jobs.put(await controlJob(input,{
    status:"waiting",
    startedAt:input.requestedAt,
    progress:{percent:25,detail:`下一动作 ${capabilityPendingAction} 已持久化，等待所需 Server capability`},
  }));
  await runtime.events.append(createEvolutionEvent({
    id:`evt-${input.controlJobId}-pending-${iteration}`,
    missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
    type:"JobProgress",source:"vercel-workflow-control",
    payload:{action:capabilityPendingAction,reason:plan.decision.reason,serverStepStatus:"capability-pending"},
  }));
  return {control:"stop",result:result(input,{
    status:"waiting-action",iterations:iteration+1,nextAction:capabilityPendingAction,
    checkpointId:plan.checkpoint.id,reason:aiCapabilityPending
      ?"该动作的 Server Step 已完成，但服务器 AI 尚未配置。"
      :"Server 已支持确定性 Roundtrip 复验；该 Mission 的剩余证据仍需 AI / Runner / 视觉或人工能力。",
  })};
}

export async function finalizeWorkflowResultStep(input:EvolutionWorkflowRunInput,result:EvolutionWorkflowResult){
  "use step";
  const runtime=getServerProductionRuntime();
  const now=new Date().toISOString();
  const current=await runtime.jobs.get(input.controlJobId);
  const settlement=planWorkflowResultFinalization(current,result,now);
  if(settlement.write&&settlement.job)await runtime.jobs.put(settlement.job);
  await runtime.events.append(createEvolutionEvent({
    id:`evt-${input.controlJobId}-finalized`,
    missionId:input.missionId,
    jobId:input.controlJobId,
    type:settlement.eventType,
    source:"vercel-workflow-finalizer",
    payload:{status:result.status,jobStatus:settlement.job?.status,iterations:result.iterations,checkpointId:result.checkpointId,reason:result.reason},
  }));
  return result;
}

export async function failLoopGuardStep(input:EvolutionWorkflowRunInput,iterations:number):Promise<EvolutionWorkflowResult>{
  "use step";
  const runtime=getServerProductionRuntime();
  const now=new Date().toISOString();
  const message=`Workflow control loop 超过安全上限 ${iterations}`;
  await runtime.jobs.put(await controlJob(input,{
    status:"failed",startedAt:input.requestedAt,finishedAt:now,error:message,
    progress:{percent:100,detail:message},
  }));
  await runtime.events.append(createEvolutionEvent({
    id:`evt-${input.controlJobId}-guard-failed`,
    missionId:input.missionId,jobId:input.controlJobId,
    type:"JobFailed",source:"vercel-workflow-control",payload:{iterations,error:message},
  }));
  return result(input,{status:"failed",iterations,reason:message});
}
