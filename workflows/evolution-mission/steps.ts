import { FatalError } from "workflow";
import {
  EvolutionJobSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  createEvolutionEvent,
  type EvolutionWorkflowResult,
  type EvolutionWorkflowRunInput,
} from "@evolution/contracts";
import { applyDeterministicRoundtripEvidence, baselineReadiness, mapTestsToRubric, materializeAcceptedChampionPackage, normalizeAcceptanceRubric, normalizeEvalSuiteForProject, resetDownstream, rubricSuiteCoverage, rubricValidation } from "@evolution/core";
import {
  advanceServerCampaignPreparation,
  buildServerHarnessPlan,
  normalizeLocallyVerifiableCandidateRuns,
  reconcileAttentionRequest,
  type ServerHarnessPlan,
} from "@evolution/harness";
import { getServerProductionRuntime } from "../../apps/backend/src/services/production-runtime";
import { runServerAi } from "../../apps/backend/src/services/ai-gateway";
import { runServerMissionBaseline } from "../../apps/backend/src/services/server-baseline";
import { runServerMissionExperiment } from "../../apps/backend/src/services/server-experiment";
import { runServerMissionHoldout } from "../../apps/backend/src/services/server-holdout";
import { serverAiConfigured } from "../../apps/backend/src/server-env";

function controlJob(input:EvolutionWorkflowRunInput,args:{
  status:"queued"|"running"|"waiting"|"completed"|"failed";
  createdAt?:string;
  startedAt?:string;
  finishedAt?:string;
  progress?:{percent?:number;detail?:string};
  error?:string;
}){
  const now=new Date().toISOString();
  return EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,
    id:input.controlJobId,
    missionId:input.missionId,
    type:"campaign",
    status:args.status,
    label:"Evolution Workflow Control",
    idempotencyKey:`workflow-control:${input.controlJobId}`,
    generation:1,
    attempts:1,
    priority:70,
    progress:args.progress,
    error:args.error,
    createdAt:args.createdAt??input.requestedAt,
    startedAt:args.startedAt,
    heartbeatAt:now,
    finishedAt:args.finishedAt,
    updatedAt:now,
  });
}

export async function initializeWorkflowControlStep(input:EvolutionWorkflowRunInput){
  "use step";
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
  const startedAt=new Date().toISOString();
  await runtime.jobs.put(controlJob(input,{
    status:"running",
    startedAt,
    progress:{percent:1,detail:"Durable Workflow 已接管 Mission control loop"},
  }));
  await runtime.events.append(createEvolutionEvent({
    id:`evt-${input.controlJobId}-started`,
    missionId:input.missionId,
    jobId:input.controlJobId,
    type:"JobStarted",
    source:"vercel-workflow-control",
    payload:{runtime:"workflow",phase:"control-loop"},
  }));
  return {missionId:mission.id};
}

export async function planMissionStep(input:EvolutionWorkflowRunInput,iteration:number):Promise<ServerHarnessPlan>{
  "use step";
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw new FatalError(`Mission 不存在：${input.missionId}`);
  const plan=buildServerHarnessPlan(mission);
  await runtime.events.append(createEvolutionEvent({
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
  await runtime.events.append(createEvolutionEvent({
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

function compactArtifacts(project:Awaited<ReturnType<ReturnType<typeof getServerProductionRuntime>["missions"]["get"]>>){
  if(!project)return[];
  let remaining=60_000;
  return project.sourceArtifacts.map((artifact)=>{
    const source=artifact.textContent||artifact.textExcerpt||"";
    const content=source.slice(0,Math.max(0,Math.min(source.length,remaining,20_000)));
    remaining=Math.max(0,remaining-content.length);
    return {id:artifact.id,name:artifact.name,role:artifact.role,artifactKind:artifact.artifactKind,content};
  }).filter((item)=>item.content||item.role==="target");
}

export async function executeServerControlStep(
  input:EvolutionWorkflowRunInput,
  plan:ServerHarnessPlan,
  iteration:number,
):Promise<{control:"continue"|"stop";result?:EvolutionWorkflowResult}>{
  "use step";
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
      await runtime.jobs.put(controlJob(input,{
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

    let campaignMission=mission;
    if(!baselineReadiness(campaignMission).ready){
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
        await runtime.jobs.put(controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:28,detail:baselineOutcome.reason.slice(0,240)},
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:baselineOutcome.reason,
        })};
      }
      await runtime.jobs.put(controlJob(input,{
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
        await runtime.jobs.put(controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:70,detail:holdoutOutcome.reason.slice(0,240)},
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:holdoutOutcome.reason,
        })};
      }
      await runtime.jobs.put(controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:72,detail:holdoutOutcome.reason.slice(0,240)},
      }));
      return {control:"continue"};
    }

    if(campaignCheckpoint?.round===round
      && campaignCheckpoint.completedPhase==="validation"
      && campaignMission.validationRun.status==="completed"){
      const candidateId=campaignMission.validationRun.candidateId??campaignMission.experimentRun.winnerId??campaignMission.experimentRun.pendingEvidenceCandidateId;
      const reason=`[server-campaign-artifact-acceptance-pending] Server Hidden Holdout 已完成 Candidate ${candidateId??"unknown"}；等待 Artifact Acceptance / Repair Server Step。`;
      const paused={
        ...campaignMission,
        campaign:{
          ...campaignMission.campaign,
          status:"paused" as const,
          stopReason:reason,
          schedule:{...campaignMission.campaign.schedule,enabled:false,nextRunAt:undefined},
        },
        stage:"validation" as const,
        updatedAt:now,
      };
      await runtime.missions.save(paused);
      await runtime.jobs.put(controlJob(input,{
        status:"waiting",
        startedAt:input.requestedAt,
        progress:{percent:78,detail:reason},
      }));
      await runtime.events.append(createEvolutionEvent({
        id:`evt-${input.controlJobId}-campaign-artifact-acceptance-pending-${iteration}`,
        missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
        type:"JobProgress",source:"vercel-workflow-control",
        payload:{action,serverNative:true,conditional:true,phase:"artifact-acceptance",candidateId,reason},
      }));
      return {control:"stop",result:result(input,{
        status:"waiting-action",iterations:iteration+1,nextAction:action,
        checkpointId:plan.checkpoint.id,reason,
      })};
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
        await runtime.jobs.put(controlJob(input,{
          status:"waiting",
          startedAt:input.requestedAt,
          progress:{percent:60,detail:experimentOutcome.reason.slice(0,240)},
        }));
        return {control:"stop",result:result(input,{
          status:"waiting-action",iterations:iteration+1,nextAction:action,
          checkpointId:plan.checkpoint.id,reason:experimentOutcome.reason,
        })};
      }
      await runtime.jobs.put(controlJob(input,{
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
      await runtime.jobs.put(controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:phasePercent,detail:"Campaign 已满足停止条件；继续进入成果打包/学习闭环"},
      }));
      return {control:"continue"};
    }
    if(outcome.control==="continue"){
      await runtime.jobs.put(controlJob(input,{
        status:"running",
        startedAt:input.requestedAt,
        progress:{percent:phasePercent,detail:`Server Campaign · ${outcome.phase} 已完成，继续下一阶段`},
      }));
      return {control:"continue"};
    }
    await runtime.jobs.put(controlJob(input,{
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
        await runtime.jobs.put(controlJob(input,{
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
    const hasLiveDecision=mission.release.evidenceMode==="live"&&(mission.release.status==="promoted"||mission.release.status==="rolled-back");
    const hasOfflineAcceptance=mission.artifactAcceptance.status==="passed"&&mission.artifactAcceptance.candidateId===winner.id;
    if(!hasLiveDecision&&!hasOfflineAcceptance)throw new FatalError("尚未完成可用于经验提炼的成果验收");
    const parsed=await runServerAi("distill",{
      project:{goal:mission.goal,command:mission.evolutionCommand,artifacts:compactArtifacts(mission)},
      baseline:mission.baselineRun.result,
      winner,
      validation:mission.validationRun,
      release:mission.release,
    });
    const lesson=!hasLiveDecision&&parsed.status==="verified-skill"
      ? {...parsed,status:"lesson" as const,validatedOn:[...parsed.validatedOn,"离线成果验收（尚无线上生产证据）"]}
      : parsed;
    const record={id:`lesson-${plan.checkpoint.id}`,...lesson};
    await runtime.missions.save({...mission,lessons:[record,...mission.lessons.filter((item)=>item.id!==record.id)],stage:"learning",updatedAt:now});
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",source:"vercel-workflow-ai",
      payload:{action,serverNative:true,lessonId:record.id,status:record.status},
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
    await runtime.missions.save({...mission,nextQueue:generated.items,stage:"learning",updatedAt:now});
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
    const updated={
      ...mission,
      outputArtifacts:artifacts,
      artifactAcceptance:mission.searchChampion!.artifactAcceptance!,
      stage:"learning" as const,
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.events.append(createEvolutionEvent({
      id:`evt-${input.controlJobId}-action-${iteration}-complete`,
      missionId:input.missionId,
      jobId:input.controlJobId,
      checkpointId:plan.checkpoint.id,
      type:"ActionCompleted",
      source:"vercel-workflow-control",
      payload:{action,serverNative:true,artifactCount:artifacts.length},
    }));
    return {control:"continue"};
  }

  if(action==="wait-human"){
    const updated={
      ...reconcileAttentionRequest(mission,plan.decision.attention),
      campaign:{...mission.campaign,status:"paused" as const,stopReason:plan.decision.reason},
      stage:plan.decision.stage,
      updatedAt:now,
    };
    await runtime.missions.save(updated);
    await runtime.jobs.put(controlJob(input,{
      status:"waiting",
      startedAt:input.requestedAt,
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
    await runtime.jobs.put(controlJob(input,{
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

  const actionJobId=`action:${input.missionId}:${plan.checkpoint.id}:${action}`;
  const existing=await runtime.jobs.get(actionJobId).catch(()=>undefined);
  await runtime.jobs.put(EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,
    id:actionJobId,
    missionId:input.missionId,
    type:"mission-action",
    status:"waiting",
    label:`Harness · ${action}`,
    idempotencyKey:`${input.missionId}:${plan.checkpoint.id}:${action}`,
    generation:existing?.generation??1,
    attempts:existing?.attempts??0,
    priority:60,
    checkpointId:plan.checkpoint.id,
    inputRef:action,
    progress:{percent:0,detail:(["understand","compile-contract","build-eval","distill","next-queue"].includes(action)&&!serverAiConfigured())?"Server AI Step 已实现，等待服务器 AI 配置":action==="revalidate"?"确定性 Roundtrip 可由 Server 自动复验；当前 Mission 仍需要其他验证能力":"等待后续 server step handler 接管"},
    createdAt:existing?.createdAt??now,
    updatedAt:now,
  }));
  await runtime.jobs.put(controlJob(input,{
    status:"waiting",
    startedAt:input.requestedAt,
    progress:{percent:25,detail:`下一动作 ${action} 已持久化，等待 server step handler`},
  }));
  await runtime.events.append(createEvolutionEvent({
    id:`evt-${input.controlJobId}-pending-${iteration}`,
    missionId:input.missionId,jobId:input.controlJobId,checkpointId:plan.checkpoint.id,
    type:"JobProgress",source:"vercel-workflow-control",
    payload:{action,reason:plan.decision.reason,serverStepStatus:"pending-migration"},
  }));
  return {control:"stop",result:result(input,{
    status:"waiting-action",iterations:iteration+1,nextAction:action,
    checkpointId:plan.checkpoint.id,reason:(["understand","compile-contract","build-eval","distill","next-queue"].includes(action)&&!serverAiConfigured())?"该动作的 Server Step 已完成，但服务器 AI 尚未配置。":action==="revalidate"?"Server 已支持确定性 Roundtrip 复验；该 Mission 的剩余证据仍需 AI / Runner / 视觉或人工能力。":"Durable control 已接管；该动作仍待迁入 server step。",
  })};
}

export async function failLoopGuardStep(input:EvolutionWorkflowRunInput,iterations:number):Promise<EvolutionWorkflowResult>{
  "use step";
  const runtime=getServerProductionRuntime();
  const now=new Date().toISOString();
  const message=`Workflow control loop 超过安全上限 ${iterations}`;
  await runtime.jobs.put(controlJob(input,{
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
