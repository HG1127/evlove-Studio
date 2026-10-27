import type {
  DiagnosisAiResult,
  EvolveProject,
  PlanAiResult,
  ProblemAnalysisAiResult,
  TestCase,
  IndependentFinalExecutionContract,
} from "@evolution/contracts";
import {
  baselineReadiness,
  campaignScoringInputBlocker,
  baselineRubricProblem,
  campaignGoalSatisfied,
  campaignPreflightStopReason,
  flagUngroundedCandidates,
  planGroundingContext,
  prioritizeProblems,
  resolveEvidenceRefs,
  selectPlanningLessons,
  planningDeferredCriterionIds,planningBaselineFailures,
  planningBaselineEvidence,PLANNING_EVIDENCE_INSTRUCTION,
  userGoalScopeContext,
} from "@evolution/core";

import {serverCampaignArtifacts,planningNarrative,type ServerPlanningDocumentLoader} from "./server-campaign-context";
import {scopeCandidateIdsForRound} from "./candidate-round-identity";
import {prepareServerIndependentFinalPaper} from "./server-final-paper";

export type ServerCampaignAiPort = {
  loadPlanningDocuments?:ServerPlanningDocumentLoader;
  finalHoldoutExecution?:IndependentFinalExecutionContract;
  reserveFinalHoldout?(payload:unknown):Promise<TestCase[]>;
  problemAnalysis(payload: unknown): Promise<ProblemAnalysisAiResult>;
  diagnose(payload: unknown): Promise<DiagnosisAiResult>;
  plan(payload: unknown): Promise<PlanAiResult>;
};

export type ServerCampaignPreparationOutcome = {
  control: "continue" | "stop";
  phase: "problem" | "diagnose" | "plan" | "baseline" | "experiment" | "settled";
  project: EvolveProject;
  reason: string;
  candidateCount?: number;
  ungroundedCount?: number;
  completed?: boolean;
};

const PHASE_ORDER = ["baseline", "problem", "diagnose", "plan", "experiment", "validation"] as const;

function completedAtLeast(project: EvolveProject, round: number, phase: typeof PHASE_ORDER[number]) {
  const checkpoint = project.campaign.checkpoint;
  if (!checkpoint || checkpoint.round !== round) return false;
  return PHASE_ORDER.indexOf(checkpoint.completedPhase) >= PHASE_ORDER.indexOf(phase);
}

function stamp(project: EvolveProject, now: string): EvolveProject {
  return { ...project, updatedAt: now };
}

function checkpoint(project: EvolveProject, round: number, phase: "problem" | "diagnose" | "plan", now: string) {
  return {
    ...project,
    campaign: {
      ...project.campaign,
      checkpoint: { round, completedPhase: phase, at: now },
    },
  };
}

function compactBaseline(project: EvolveProject) {
  // The original-side SYS-PAIRWISE is necessarily unmeasurable until a new
  // Candidate exists. Feed AI only actionable Baseline evidence; otherwise
  // Problem/Diagnosis agents can hallucinate a scoring-system fault from an
  // intentional comparison-only 0 / UNVERIFIED row.
  // Do not alter stored Baseline or the final Hidden/Pairwise safety contract.
  const pendingPairwiseIds=planningDeferredCriterionIds(project);
  const comparisonCaseIds=new Set(project.evalSuite.filter(test=>test.criterionIds.length>0
    &&test.criterionIds.every(id=>pendingPairwiseIds.has(id))).map(test=>test.id));
  const currentResult=project.baselineRun.result;
  const result=currentResult?{
    ...currentResult,
    criterionScores:currentResult.criterionScores?.filter(c=>!pendingPairwiseIds.has(c.criterionId)),
    unverifiedCriterionIds:currentResult.unverifiedCriterionIds?.filter(id=>!pendingPairwiseIds.has(id)),
    failures:planningBaselineFailures(project),
  }:undefined;
  return {
    id:project.baselineRun.id,
    status:project.baselineRun.status,
    result,
    comparisonOnlyDeferred:comparisonCaseIds.size>0
      ?"原版对照仅在实际 Candidate 与原始侧具备同卷证据之后核验。Baseline 已锁定的参照或原版 UNVERIFIED 不代表产品故障。"
      :undefined,
    runs:project.baselineRun.runs.filter(run=>!comparisonCaseIds.has(run.testCaseId))
      .slice(0,16).map(run=>({
        testCaseId:run.testCaseId,
        verificationStatus:run.verificationStatus,
        error:run.error,
        output:run.output.slice(0,2400),
        trace:run.trace.slice(0,8),
      })),
  };
}

function selectedCandidateCount(project: EvolveProject) {
  const configured = Math.max(1, project.campaign.candidateCount);
  return project.campaign.searchMode === "focused" ? Math.min(2, configured) : configured;
}

function groundedCandidate(candidate: PlanAiResult["candidates"][number]) {
  return Boolean(candidate.designRationale?.sourceEvidence.length && candidate.designRationale.mechanism);
}

function selectPlanCandidates(project: EvolveProject, plan: PlanAiResult) {
  const recommended = new Set(plan.recommendedCandidateIds);
  const ordered = [
    ...plan.candidates.filter((candidate) => recommended.has(candidate.id)),
    ...plan.candidates.filter((candidate) => !recommended.has(candidate.id)),
  ];
  const grounded = ordered.filter(groundedCandidate);
  const ungrounded = ordered.filter((candidate) => !groundedCandidate(candidate));
  return [...grounded, ...ungrounded].slice(0, selectedCandidateCount(project));
}

function campaignBase(project: EvolveProject, now: string) {
  return {
    ...project,
    searchAppliedPatches: project.searchChampion?.patches ?? project.searchAppliedPatches,
    campaign: {
      ...project.campaign,
      status: "running" as const,
      startedAt: project.campaign.startedAt ?? now,
      completedAt: undefined,
      stopReason: undefined,
    },
  };
}

function capabilityPause(project: EvolveProject, reason: string, stage: EvolveProject["stage"], now: string) {
  return stamp({
    ...project,
    stage,
    campaign: {
      ...project.campaign,
      status: "paused",
      stopReason: reason,
      schedule: { ...project.campaign.schedule, enabled: false, nextRunAt: undefined },
    },
  }, now);
}

async function planningArtifacts(project:EvolveProject,ai:ServerCampaignAiPort,phase:"problem"|"diagnose"|"plan",now:string,preservedProject=project){
  try{
    const artifacts=await serverCampaignArtifacts(project,ai.loadPlanningDocuments);
    const limit=campaignPreflightStopReason(preservedProject);
    if(limit)return {ready:false as const,outcome:{control:"stop" as const,phase:"settled" as const,project:capabilityPause(preservedProject,limit,preservedProject.stage,now),reason:limit}};
    return {ready:true as const,artifacts};
  }catch(error){
    const reason="[server-campaign-planning-context-pending] "+(error instanceof Error?error.message:String(error));
    return {ready:false as const,outcome:{control:"stop" as const,phase,project:capabilityPause(preservedProject,reason,phase==="diagnose"?"diagnosis":phase,now),reason}};
  }
}

/**
 * Advance exactly one durable Campaign preparation phase.
 *
 * Baseline execution, Candidate build/experiment, Hidden Validation and Artifact Acceptance are
 * separate capabilities. This function owns only Problem → Diagnosis → Plan and hands a durable
 * Plan checkpoint to the next Server Experiment step.
 */
export async function advanceServerCampaignPreparation(
  inputProject: EvolveProject,
  ai: ServerCampaignAiPort,
  options?: { now?: () => string },
): Promise<ServerCampaignPreparationOutcome> {
  const now = options?.now?.() ?? new Date().toISOString();
  const scoringInputBlocker = campaignScoringInputBlocker(inputProject);
  if (scoringInputBlocker) return { control: "stop", phase: "settled", project: capabilityPause(inputProject, scoringInputBlocker, inputProject.stage, now), reason: scoringInputBlocker, completed: false };
  const preflight = campaignPreflightStopReason(inputProject);
  if (preflight) {
    const completed = campaignGoalSatisfied(inputProject);
    const project = stamp({
      ...inputProject,
      campaign: {
        ...inputProject.campaign,
        status: completed ? "completed" : "paused",
        completedAt: completed ? now : undefined,
        stopReason: preflight,
        schedule: { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
    }, now);
    return { control: "stop", phase: "settled", project, reason: preflight, completed };
  }

  const targetGate = inputProject.gates.find((gate) => gate.id === "target-ready");
  if (targetGate?.status !== "approved") {
    const reason = "[server-campaign-contract-pending] Target Ready 尚未批准，禁止启动 Campaign。";
    return { control: "stop", phase: "baseline", project: capabilityPause(inputProject, reason, "target", now), reason };
  }
  if (!inputProject.evalSuite.length) {
    const reason = "[server-campaign-contract-pending] Eval Suite 为空，禁止启动 Campaign。";
    return { control: "stop", phase: "baseline", project: capabilityPause(inputProject, reason, "target", now), reason };
  }

  const readiness = baselineReadiness(inputProject);
  if (!readiness.ready) {
    const reason = `[server-campaign-baseline-pending] Campaign Planning 已迁到 Server，但 Baseline 执行仍需先完成：${readiness.blockers.join("；")}`;
    return { control: "stop", phase: "baseline", project: capabilityPause(inputProject, reason, "baseline", now), reason };
  }

  let project = stamp(campaignBase(inputProject, now), now);
  const round = project.campaign.currentRound + 1;
  if (round > project.campaign.stopCriteria.maxRounds) {
    const reason = `已达到最大进化轮数 ${project.campaign.stopCriteria.maxRounds}`;
    return { control: "stop", phase: "settled", project: capabilityPause(project, reason, project.stage, now), reason };
  }

  if (!completedAtLeast(project, round, "problem")) {
    const direct = baselineRubricProblem(project);
    let problems;
    let recommendedProblemId: string | undefined;
    if (direct) {
      problems = [{ ...direct, evidenceRefs: resolveEvidenceRefs(project, direct.evidence) }];
      recommendedProblemId = direct.id;
    } else {
      const context=await planningArtifacts(project,ai,"problem",now);
      if(!context.ready)return context.outcome;
      const generated = await ai.problemAnalysis({
        project: {
          goal: project.goal,
          problemStatement: project.problemStatement,
          desiredOutcome: project.desiredOutcome,
          evolutionCommand: project.evolutionCommand,
          metrics: project.metrics,
          protectedItems: project.protectedItems,
          editableItems: project.editableItems,
          acceptanceRubric: project.acceptanceRubric,
          inputUnderstanding: project.inputUnderstanding,
          artifacts: context.artifacts,
        },
        baseline: compactBaseline(project),
        planningBaseline:planningBaselineEvidence(project),planningInstruction:PLANNING_EVIDENCE_INSTRUCTION,
        previousRounds: project.roundHistory.slice(-8),
        archive: project.evolutionArchive.slice(-16).map((entry) => ({
          round: entry.round,
          kind: entry.kind,
          niche: entry.niche,
          score: entry.score,
          reason: entry.reason,
        })),
      });
      problems = generated.problems.map((problem) => ({ ...problem, evidenceRefs: resolveEvidenceRefs(project, problem.evidence) }));
      recommendedProblemId = generated.recommendedProblemId;
    }
    const ranked = prioritizeProblems(problems);
    const selectedProblemId = ranked[0]?.problem.id
      ?? (problems.some((problem) => problem.id === recommendedProblemId) ? recommendedProblemId : problems[0]?.id);
    if (!selectedProblemId) {
      const reason = "[server-campaign-problem-pending] Server AI 未形成可选择的问题。";
      return { control: "stop", phase: "problem", project: capabilityPause(project, reason, "problem", now), reason };
    }
    project = stamp(checkpoint({
      ...project,
      problems,
      selectedProblemId,
      stage: "problem",
      candidates: [],
      selectedCandidateIds: [],
      experimentRun: { id: `experiment-r${round}-server`, status: "idle", candidateResults: [] },
      validationRun: { id: `validation-r${round}-server`, status: "idle", checks: [], runs: [], baselineRuns: [] },
      gates: project.gates.map((gate) => gate.id === "target-ready" ? gate : { ...gate, status: "pending", approvedAt: undefined, note: undefined }),
    }, round, "problem", now), now);
    return { control: "continue", phase: "problem", project, reason: `Round ${round} Server Problem Analysis 已完成` };
  }

  if (!completedAtLeast(project, round, "diagnose")) {
    const selected = project.problems.find((problem) => problem.id === project.selectedProblemId) ?? prioritizeProblems(project.problems)[0]?.problem;
    if (!selected) {
      const reason = "[server-campaign-problem-pending] 找不到本轮选中问题，无法进入根因诊断。";
      return { control: "stop", phase: "problem", project: capabilityPause(project, reason, "problem", now), reason };
    }
    const context=await planningArtifacts(project,ai,"diagnose",now);
    if(!context.ready)return context.outcome;
    const generated = await ai.diagnose({
      project: {
        goal: project.goal,
        problemStatement: project.problemStatement,
        desiredOutcome: project.desiredOutcome,
        evolutionCommand: project.evolutionCommand,
        metrics: project.metrics,
        protectedItems: project.protectedItems,
        editableItems: project.editableItems,
        acceptanceRubric: project.acceptanceRubric,
        artifacts: context.artifacts,
      },
      problem: planningNarrative(project,selected),
      baseline: compactBaseline(project),
      planningBaseline:planningBaselineEvidence(project),planningInstruction:PLANNING_EVIDENCE_INSTRUCTION,
      previousRounds: project.roundHistory.slice(-8),
    });
    const diagnosis = { ...generated, evidenceRefs: resolveEvidenceRefs(project, generated.evidence) };
    project = stamp(checkpoint({ ...project, diagnosis, stage: "diagnosis" }, round, "diagnose", now), now);
    if (diagnosis.confidence < 0.55 || !diagnosis.evidence.length || !diagnosis.evidenceRefs.some((ref) => ref.verified)) {
      const reason = "[server-campaign-diagnosis-pending] 根因证据不足或无法定位到当前 Source / Baseline Trace；保留本轮断点，禁止继续生成 Candidate。";
      return { control: "stop", phase: "diagnose", project: capabilityPause(project, reason, "diagnosis", now), reason };
    }
    return { control: "continue", phase: "diagnose", project, reason: `Round ${round} Server Diagnosis 已完成并绑定真实证据` };
  }

  if (!completedAtLeast(project, round, "plan")) {
    if (!project.diagnosis) {
      const reason = "[server-campaign-diagnosis-pending] 缺少已持久化 Diagnosis。";
      return { control: "stop", phase: "diagnose", project: capabilityPause(project, reason, "diagnosis", now), reason };
    }
    if(ai.reserveFinalHoldout){
      try{
      const originalContext=await planningArtifacts({...project,searchChampion:undefined,problems:[],diagnosis:undefined,selectedProblemId:undefined,
        problemStatement:"",baselineRun:{...project.baselineRun,result:undefined}},ai,"plan",now,project);
      if(!originalContext.ready)return originalContext.outcome;
      const prepared=await prepareServerIndependentFinalPaper(project,{round,at:now,reserve:ai.reserveFinalHoldout,
        executionContract:ai.finalHoldoutExecution,
        artifacts:originalContext.artifacts,
      });
      if(prepared.reserved)return {control:"continue",phase:"plan",project:prepared.project,reason:"独立终验题集已在 Candidate 规划前预留并持久化。"};
      }catch(error){
        const reason="[server-campaign-final-holdout-contract-pending] "+(error instanceof Error?error.message:String(error));
        return {control:"stop",phase:"plan",project:capabilityPause(project,reason,"plan",now),reason};
      }
    }
    const context=await planningArtifacts(project,ai,"plan",now);
    if(!context.ready)return context.outcome;
    const generated = await ai.plan({
      ...(userGoalScopeContext(project)?{winnerGoalScope:userGoalScopeContext(project)}:{}),
      project: {
        goal: project.goal,
        problemStatement: project.problemStatement,
        desiredOutcome: project.desiredOutcome,
        evolutionCommand: project.evolutionCommand,
        protectedItems: project.protectedItems,
        editableItems: project.editableItems,
        inputClarifications: project.inputClarifications,
        inputUnderstanding: project.inputUnderstanding ? {
          intentRestatement: project.inputUnderstanding.intentRestatement,
          acceptanceFocus: project.inputUnderstanding.acceptanceFocus,
        } : undefined,
        sourceArtifacts: context.artifacts,
      },
      diagnosis: planningNarrative(project,project.diagnosis),
      baseline:compactBaseline(project),
      ...planGroundingContext(project, project.selectedProblemId),
      candidateCount: selectedCandidateCount(project),
      search: {
        baseVersionId: project.searchChampion?.versionLabel ?? project.version,
        parentStrategy: project.campaign.parentStrategy,
        exploreRatio: project.campaign.exploreRatio,
        champion: project.searchChampion ? {
          id: project.searchChampion.id,
          versionLabel: project.searchChampion.versionLabel,
          round: project.searchChampion.round,
          score: project.searchChampion.score,
          patches: project.searchChampion.patches,
          reason: project.searchChampion.reason,
        } : undefined,
        recentArchive: project.evolutionArchive.slice(-12).map((entry) => ({
          id: entry.id,
          round: entry.round,
          kind: entry.kind,
          niche: entry.niche,
          score: entry.score,
          candidateId: entry.candidate.id,
          patches: entry.candidate.patches,
          reason: entry.reason,
        })),
      },
      existingLessons: selectPlanningLessons(project.lessons),
      gapAdvice: project.validationRun.aiAdvice ?? project.experimentRun.aiAdvice ?? project.campaign.lastGapAdvice,
    });
    const grounded = flagUngroundedCandidates(generated);
    const candidates = scopeCandidateIdsForRound(project,selectPlanCandidates(project, grounded.result),round)
      .map(candidate=>({...candidate,...(project.finalHoldout?.round===round?{finalHoldoutPaperHash:project.finalHoldout.paperHash}:{})}));
    if (!candidates.length || !candidates.some(groundedCandidate)) {
      const reason = "[server-campaign-plan-grounding-pending] Candidate 方案缺少源成果证据或因果机制，禁止进入实验。";
      return {
        control: "stop",
        phase: "plan",
        project: capabilityPause({ ...project, candidates, selectedCandidateIds: candidates.map((candidate) => candidate.id), stage: "plan" }, reason, "plan", now),
        reason,
        candidateCount: candidates.length,
        ungroundedCount: grounded.ungroundedCount,
      };
    }
    const selectedCandidateIds = candidates.map((candidate) => candidate.id);
    project = stamp(checkpoint({
      ...project,
      candidates,
      selectedCandidateIds,
      stage: "plan",
      gates: project.gates.map((gate) => gate.id === "experiment-ready"
        ? {
            ...gate,
            status: project.campaign.autoApproveOfflineExperiment ? "approved" : "ready",
            approvedAt: project.campaign.autoApproveOfflineExperiment ? now : undefined,
            note: project.campaign.autoApproveOfflineExperiment ? `Server Campaign Round ${round} 自动批准离线实验` : "等待人工确认",
          }
        : gate),
    }, round, "plan", now), now);
    if (!project.campaign.autoApproveOfflineExperiment) {
      const reason = "[server-campaign-experiment-approval] Experiment Ready 等待人工确认；Server 已保留 Candidate 与 Plan 断点。";
      return { control: "stop", phase: "plan", project: capabilityPause(project, reason, "plan", now), reason, candidateCount: candidates.length, ungroundedCount: grounded.ungroundedCount };
    }
    return {
      control: "continue",
      phase: "experiment",
      project,
      reason: `Round ${round} Server Plan 已完成且 Experiment Ready 已批准；进入 Server Candidate Build / Experiment。`,
      candidateCount: candidates.length,
      ungroundedCount: grounded.ungroundedCount,
    };
  }

  return {
    control: "continue",
    phase: "experiment",
    project,
    reason: "Server Campaign Plan checkpoint 已就绪；进入 Server Candidate Build / Experiment。",
    candidateCount: project.selectedCandidateIds.length,
  };
}
