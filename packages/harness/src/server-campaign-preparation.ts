import type {
  DiagnosisAiResult,
  EvolveProject,
  PlanAiResult,
  ProblemAnalysisAiResult,
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
} from "@evolution/core";

import { retrieveTextContext } from "./context-retrieval";

export type ServerCampaignAiPort = {
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

/** A saved diagnose checkpoint records the attempt; its evidence still must pass before Plan. */
function diagnosisEvidenceReady(project: EvolveProject) {
  const diagnosis = project.diagnosis;
  return Boolean(diagnosis && diagnosis.confidence >= 0.55 && diagnosis.evidence.length
    && resolveEvidenceRefs(project, diagnosis.evidence).some(ref => ref.verified));
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
  return {
    id: project.baselineRun.id,
    status: project.baselineRun.status,
    result: project.baselineRun.result,
    runs: project.baselineRun.runs.slice(0, 16).map((run) => ({
      testCaseId: run.testCaseId,
      verificationStatus: run.verificationStatus,
      error: run.error,
      output: run.output.slice(0, 2400),
      trace: run.trace.slice(0, 8),
    })),
  };
}

function compactCampaignArtifacts(project: EvolveProject) {
  const problem = project.problems.find((item) => item.id === project.selectedProblemId) ?? project.problems[0];
  // Put specific evidence before general goals: retrieval limits query tokens as well as output.
  const query = [
    ...(problem?.evidence ?? []),
    ...(project.diagnosis?.evidence ?? []),
    problem?.title, problem?.summary, problem?.rootCause,
    project.diagnosis?.rootCause, project.diagnosis?.summary,
    ...(project.baselineRun.result?.failures ?? []),
    project.goal, project.evolutionCommand,
    ...project.acceptanceRubric.map((criterion) => criterion.requirement),
  ].filter(Boolean).join("\n");
  const championBySource = new Map((project.searchChampion?.candidate?.artifactSnapshots ?? []).map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
  const ordered = [...project.sourceArtifacts].sort((a, b) => Number(b.role === "target") - Number(a.role === "target"));
  let remaining = 48_000;
  return ordered.slice(0, 12).map((artifact) => {
    const champion = championBySource.get(artifact.id);
    const full = champion?.content || artifact.textContent || artifact.textExcerpt || "";
    const allowance = Math.max(0, Math.min(10_000, remaining));
    const content = retrieveTextContext(full, query, { maxChars: allowance, maxChunks: 4 });
    remaining = Math.max(0, remaining - content.length);
    return {
      id: artifact.id,
      name: artifact.name,
      role: artifact.role,
      artifactKind: artifact.artifactKind,
      structure: artifact.structure.slice(0, 40),
      content,
      contentSource: champion ? `search-champion:${project.searchChampion?.versionLabel ?? project.searchChampion?.id}` : "source",
      originalChars: full.length,
      truncated: content !== full,
    };
  });
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
      const generated = await ai.problemAnalysis({
        project: {
          goal: project.goal,
          evolutionCommand: project.evolutionCommand,
          metrics: project.metrics,
          protectedItems: project.protectedItems,
          editableItems: project.editableItems,
          acceptanceRubric: project.acceptanceRubric,
          inputUnderstanding: project.inputUnderstanding,
          artifacts: compactCampaignArtifacts(project),
        },
        baseline: compactBaseline(project),
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

  if (!completedAtLeast(project, round, "diagnose")
    || (!completedAtLeast(project, round, "plan") && !diagnosisEvidenceReady(project))) {
    const selected = project.problems.find((problem) => problem.id === project.selectedProblemId) ?? prioritizeProblems(project.problems)[0]?.problem;
    if (!selected) {
      const reason = "[server-campaign-problem-pending] 找不到本轮选中问题，无法进入根因诊断。";
      return { control: "stop", phase: "problem", project: capabilityPause(project, reason, "problem", now), reason };
    }
    const generated = await ai.diagnose({
      project: {
        goal: project.goal,
        evolutionCommand: project.evolutionCommand,
        metrics: project.metrics,
        protectedItems: project.protectedItems,
        editableItems: project.editableItems,
        acceptanceRubric: project.acceptanceRubric,
        artifacts: compactCampaignArtifacts(project),
      },
      problem: selected,
      baseline: compactBaseline(project),
      previousRounds: project.roundHistory.slice(-8),
    });
    const diagnosis = { ...generated, evidenceRefs: resolveEvidenceRefs(project, generated.evidence) };
    project = stamp(checkpoint({ ...project, diagnosis, stage: "diagnosis" }, round, "diagnose", now), now);
    if (!diagnosisEvidenceReady(project)) {
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
    const generated = await ai.plan({
      project: {
        goal: project.goal,
        evolutionCommand: project.evolutionCommand,
        protectedItems: project.protectedItems,
        editableItems: project.editableItems,
        inputClarifications: project.inputClarifications,
        inputUnderstanding: project.inputUnderstanding ? {
          intentRestatement: project.inputUnderstanding.intentRestatement,
          acceptanceFocus: project.inputUnderstanding.acceptanceFocus,
        } : undefined,
        sourceArtifacts: compactCampaignArtifacts(project),
      },
      diagnosis: project.diagnosis,
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
      existingLessons: project.lessons.slice(-6),
      gapAdvice: project.validationRun.aiAdvice ?? project.experimentRun.aiAdvice ?? project.campaign.lastGapAdvice,
    });
    const grounded = flagUngroundedCandidates(generated);
    const candidates = selectPlanCandidates(project, grounded.result);
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
