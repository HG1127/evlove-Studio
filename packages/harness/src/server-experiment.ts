import type {
  Candidate,
  EvolveProject,
  ExperimentRun,
  ExperimentCandidateCheckpoint,
} from "@evolution/contracts";
import {
  candidateWinnerDecision,
  experimentEvaluationScore,
  experimentEvidencePendingOnly,
  fallbackExperimentAdvice,
} from "@evolution/core";
import {
  executeServerExperimentCandidate,
  judgeServerExperimentCandidate,
  type ServerExperimentExecutionPorts,
} from "./server-experiment-runner";

import { recoverableServerExperimentRuns, restoreServerExperimentCandidate, serverExperimentBuildCheckpoint,
  serverExperimentExecutionCheckpoint, serverExperimentObservationBinding, ServerExperimentFrozenRecoveryError, type ServerExperimentRecoveryPorts } from "./server-experiment-recovery";

export type ServerExperimentPorts = ServerExperimentExecutionPorts & ServerExperimentRecoveryPorts & {
  buildCandidate(args: { project: EvolveProject; candidate: Candidate }): Promise<Candidate>;
};

export type ServerExperimentOutcome = {
  control: "continue" | "stop";
  project: EvolveProject;
  experiment: ExperimentRun;
  reason: string;
  readyForHoldout: boolean;
  winnerId?: string;
  pendingEvidenceCandidateId?: string;
  builtCount: number;
  buildFailureCount: number;
};

function archiveNoWinnerRound(
  project: EvolveProject,
  round: number,
  experiment: ExperimentRun,
  builtCandidates: Candidate[],
  now: string,
): EvolveProject {
  const advice = fallbackExperimentAdvice(project, experiment);
  const candidateById = new Map(builtCandidates.map((candidate) => [candidate.id, candidate]));
  const archive = experiment.candidateResults.flatMap((result) => {
    const candidate = candidateById.get(result.candidateId);
    if (!candidate) return [];
    const rawScore = experimentEvaluationScore(project, result.evaluation);
    return [{
      id: `server-archive-r${round}-${candidate.id}`,
      round,
      kind: result.evaluation.safety === "FAIL" ? "failure" as const : "stepping-stone" as const,
      niche: candidate.designRationale?.coveredCriteria.join(" / ") || candidate.title || candidate.name,
      score: Number.isFinite(rawScore) ? Number(rawScore.toFixed(2)) : -999,
      candidate,
      evaluation: result.evaluation,
      parentVersionId: project.searchChampion?.versionLabel ?? project.version,
      lineage: project.searchChampion?.id ? [project.searchChampion.id] : [],
      reason: result.winnerDecision?.summary ?? "本轮未达到 Winner 晋级线",
      createdAt: now,
    }];
  });
  const closest = [...experiment.candidateResults].sort((a, b) =>
    experimentEvaluationScore(project, b.evaluation) - experimentEvaluationScore(project, a.evaluation))[0];
  const closestScore = closest ? experimentEvaluationScore(project, closest.evaluation) : undefined;
  return {
    ...project,
    experimentRun: { ...experiment, aiAdvice: advice },
    evolutionArchive: [...project.evolutionArchive, ...archive].slice(-240),
    roundHistory: [...project.roundHistory, {
      id: `server-round-${round}`,
      round,
      status: "completed",
      parentVersionId: project.searchChampion?.versionLabel ?? project.version,
      startedAt: experiment.startedAt ?? now,
      completedAt: experiment.completedAt ?? now,
      selectedProblemTitle: project.problems.find((problem) => problem.id === project.selectedProblemId)?.title,
      candidateCount: builtCandidates.length,
      winnerScore: closestScore !== undefined && Number.isFinite(closestScore) ? Number(closestScore.toFixed(2)) : undefined,
      championChanged: false,
      globalChampionId: project.searchChampion?.id,
      improvement: 0,
      estimatedCost: 0,
      summary: `Round ${round} Server Experiment 没有 Candidate 达到 Winner 晋级线；已归档真实实验结果并生成下一轮 Gap Advice。`,
    }],
    campaign: {
      ...project.campaign,
      status: "running",
      currentRound: round,
      noImprovementRounds: project.campaign.noImprovementRounds + 1,
      lastGapAdvice: advice,
      stopReason: undefined,
      checkpoint: undefined,
    },
    stage: "experiment",
    updatedAt: now,
  };
}

export async function runServerExperiment(
  inputProject: EvolveProject,
  ports: ServerExperimentPorts,
  options?: { now?: () => string },
): Promise<ServerExperimentOutcome> {
  const now = options?.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const round = inputProject.campaign.checkpoint?.round ?? inputProject.campaign.currentRound + 1;
  const experimentGate = inputProject.gates.find((gate) => gate.id === "experiment-ready");
  if (experimentGate?.status !== "approved") throw new Error("Experiment Ready gate is not approved");
  if (inputProject.campaign.checkpoint?.round !== round || inputProject.campaign.checkpoint.completedPhase !== "plan") {
    throw new Error("Server Experiment requires a persisted Plan checkpoint for the current round");
  }
  if (!inputProject.baselineRun.result || inputProject.baselineRun.status !== "completed") {
    throw new Error("Server Experiment requires a completed Baseline evaluation");
  }
  if (new Set(inputProject.selectedCandidateIds).size !== inputProject.selectedCandidateIds.length
    || inputProject.selectedCandidateIds.some(id => inputProject.candidates.filter(c => c.id === id).length !== 1)) {
    throw new Error("Server Experiment requires unique, existing selected Candidate identities");
  }
  const selected = inputProject.selectedCandidateIds
    .flatMap((id) => inputProject.candidates.find((candidate) => candidate.id === id) ? [inputProject.candidates.find((candidate) => candidate.id === id)!] : []);
  if (!selected.length) throw new Error("Server Experiment has no selected Candidates");

  const checkpoints = new Map<string, ExperimentCandidateCheckpoint>();
  const recoveryFailures = new Set<string>();
  const built: Candidate[] = [];
  const buildFailures: Array<{ candidateId: string; message: string }> = [];
  for (const candidate of selected) {
    try {
      const restored = await restoreServerExperimentCandidate(inputProject, candidate, round, ports);
      const result = restored ?? await ports.buildCandidate({ project: inputProject, candidate });
      const targets = inputProject.sourceArtifacts.filter((artifact) => artifact.role === "target");
      const snapshots = new Map(result.artifactSnapshots.map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
      if (!targets.length || result.id !== candidate.id || result.artifactBuildStatus !== "ready"
        || new Set(targets.map(t => t.id)).size !== targets.length
        || new Set(result.artifactSnapshots.map(s => s.sourceArtifactId)).size !== targets.length
        || result.artifactSnapshots.some(s => s.frozenArtifact?.sourceArtifactId !== s.sourceArtifactId)
        || result.artifactSnapshots.length !== targets.length
        || targets.some((target) => !snapshots.get(target.id)?.frozenArtifact)) {
        throw new Error("Candidate Builder 未返回与全部 Target 绑定的已冻结实际文件");
      }
      built.push(result);
      const checkpoint = restored
        ? inputProject.experimentRun.executionCheckpoints?.find(c => c.candidateId === candidate.id)
        : await serverExperimentBuildCheckpoint(inputProject, result, ports);
      if (checkpoint) checkpoints.set(candidate.id, checkpoint);
    } catch (error) {
      if (error instanceof ServerExperimentFrozenRecoveryError) recoveryFailures.add(candidate.id);
      const prior = inputProject.experimentRun.executionCheckpoints?.filter(c => c.candidateId === candidate.id);
      if (prior?.length === 1) checkpoints.set(candidate.id, prior[0]!);
      buildFailures.push({ candidateId: candidate.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!built.length) {
    const reason = `[server-campaign-experiment-build-pending] ${selected.length} 个 Candidate 均未能生成并冻结实际成果：${buildFailures.map((item) => `${item.candidateId}: ${item.message}`).join("；")}`;
    const experiment: ExperimentRun = {
      id: `experiment-r${round}-server`,
      status: "failed",
      startedAt,
      completedAt: now(),
      candidateResults: [],
      comparisonSuite: inputProject.evalSuite,
      comparisonBaseline: inputProject.baselineRun,
      buildFailures,
      executionCheckpoints: [...checkpoints.values()],
      summary: reason,
    };
    const project: EvolveProject = {
      ...inputProject,
      candidates: inputProject.candidates.map((candidate) => {
        const failed = buildFailures.find((item) => item.candidateId === candidate.id);
        return failed && !recoveryFailures.has(candidate.id) ? { ...candidate, artifactBuildStatus: "failed", artifactBuildSummary: failed.message, status: "failed" } : candidate;
      }),
      experimentRun: experiment,
      campaign: {
        ...inputProject.campaign,
        status: "paused",
        stopReason: reason,
        schedule: { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined },
      },
      stage: "experiment",
      updatedAt: now(),
    };
    return { control: "stop", project, experiment, reason, readyForHoldout: false, builtCount: 0, buildFailureCount: buildFailures.length };
  }

  const candidateResults: ExperimentRun["candidateResults"] = [];
  for (const candidate of built) {
    const checkpoint = checkpoints.get(candidate.id);
    const reused = await recoverableServerExperimentRuns(inputProject, candidate, round, checkpoint, Date.parse(now()), ports);
    const binding = reused ? undefined : await serverExperimentObservationBinding(inputProject, candidate, checkpoint, ports);
    const runs = reused ?? await executeServerExperimentCandidate(inputProject, candidate, ports);
    if (!reused) {
      const executed = await serverExperimentExecutionCheckpoint(inputProject, candidate, checkpoint, runs, Date.parse(now()), ports, binding);
      if (executed) checkpoints.set(candidate.id, executed);
    }
    let evaluation;
    try {
      evaluation = await judgeServerExperimentCandidate(inputProject, candidate, runs, ports);
    } catch (error) {
      const reason = `[server-campaign-experiment-judge-pending] Candidate ${candidate.id} 已构造并执行，但独立 Server Judge 未完成：${error instanceof Error ? error.message : String(error)}`;
      const experiment: ExperimentRun = {
        id: `experiment-r${round}-server`,
        status: "failed",
        startedAt,
        completedAt: now(),
        candidateResults,
        comparisonSuite: inputProject.evalSuite,
        comparisonBaseline: inputProject.baselineRun,
        buildFailures,
        executionCheckpoints: [...checkpoints.values()],
        summary: reason,
      };
      const builtById = new Map(built.map((item) => [item.id, item]));
      const project: EvolveProject = {
        ...inputProject,
        candidates: inputProject.candidates.map((item) => {
          const actual = builtById.get(item.id);
          if (actual) return actual;
          const failed = buildFailures.find((failure) => failure.candidateId === item.id);
          return failed && !recoveryFailures.has(item.id) ? { ...item, status: "failed", artifactBuildStatus: "failed", artifactBuildSummary: failed.message } : item;
        }),
        experimentRun: experiment,
        campaign: {
          ...inputProject.campaign,
          status: "paused",
          stopReason: reason,
          schedule: { ...inputProject.campaign.schedule, enabled: false, nextRunAt: undefined },
        },
        stage: "experiment",
        updatedAt: now(),
      };
      return { control: "stop", project, experiment, reason, readyForHoldout: false, builtCount: built.length, buildFailureCount: buildFailures.length };
    }
    candidateResults.push({
      candidateId: candidate.id,
      evaluation,
      runs,
      artifactSnapshots: candidate.artifactSnapshots,
      artifactBuildSummary: candidate.artifactBuildSummary,
      experimentStage: "finalist",
      winnerDecision: candidateWinnerDecision(inputProject, evaluation, inputProject.baselineRun.result, candidate),
    });
  }

  const eligible = candidateResults
    .filter((result) => result.winnerDecision?.eligible)
    .sort((a, b) => experimentEvaluationScore(inputProject, b.evaluation) - experimentEvaluationScore(inputProject, a.evaluation));
  const winner = eligible[0];
  const closest = [...candidateResults]
    .sort((a, b) => experimentEvaluationScore(inputProject, b.evaluation) - experimentEvaluationScore(inputProject, a.evaluation))[0];
  const pendingEvidence = !winner && closest && candidateResults.every((result) => experimentEvidencePendingOnly(result.evaluation))
    ? closest
    : undefined;
  const completedAt = now();
  const experiment: ExperimentRun = {
    id: `experiment-r${round}-server`,
    status: "completed",
    startedAt,
    completedAt,
    candidateResults,
    comparisonSuite: inputProject.evalSuite,
    comparisonBaseline: inputProject.baselineRun,
    buildFailures,
    executionCheckpoints: [...checkpoints.values()],
    winnerId: winner?.candidateId,
    pendingEvidenceCandidateId: pendingEvidence?.candidateId,
    summary: winner
      ? `${winner.candidateId} 在 Server 全量 Candidate Experiment 中达到同卷 Baseline 晋级线，等待独立 Hidden Holdout。`
      : pendingEvidence
        ? `${pendingEvidence.candidateId} 没有已验证产品失败，仅缺真实证据；保留 exact Candidate Snapshot 进入 Hidden Holdout 补证。`
        : closest?.winnerDecision?.summary ?? "本轮没有 Candidate 达到 Winner 晋级线。",
  };
  const builtById = new Map(built.map((candidate) => [candidate.id, candidate]));
  const winnerId = winner?.candidateId ?? pendingEvidence?.candidateId;
  let project: EvolveProject = {
    ...inputProject,
    candidates: inputProject.candidates.map((candidate) => {
      const actual = builtById.get(candidate.id);
      if (!actual) {
        const failed = buildFailures.find((item) => item.candidateId === candidate.id);
        return failed && !recoveryFailures.has(candidate.id) ? { ...candidate, status: "failed", artifactBuildStatus: "failed", artifactBuildSummary: failed.message } : candidate;
      }
      return {
        ...actual,
        status: actual.id === winnerId ? "winner" : "passed",
        accuracy: candidateResults.find((result) => result.candidateId === actual.id)?.evaluation.accuracy ?? actual.accuracy,
        evidence: candidateResults.find((result) => result.candidateId === actual.id)?.evaluation.evidence ?? actual.evidence,
        riskCoverage: candidateResults.find((result) => result.candidateId === actual.id)?.evaluation.riskCoverage ?? actual.riskCoverage,
        safety: candidateResults.find((result) => result.candidateId === actual.id)?.evaluation.safety ?? actual.safety,
      };
    }),
    experimentRun: experiment,
    stage: "experiment",
    updatedAt: completedAt,
  };

  if (!winnerId) {
    project = archiveNoWinnerRound(project, round, experiment, built, completedAt);
    return {
      control: "continue",
      project,
      experiment: project.experimentRun,
      reason: `Round ${round} Server Experiment 无 Winner；已归档并生成下一轮 Gap Advice。`,
      readyForHoldout: false,
      builtCount: built.length,
      buildFailureCount: buildFailures.length,
    };
  }

  project = {
    ...project,
    campaign: {
      ...project.campaign,
      status: "running",
      stopReason: undefined,
      checkpoint: { round, completedPhase: "experiment", at: completedAt },
    },
    updatedAt: completedAt,
  };
  return {
    control: "continue",
    project,
    experiment,
    reason: winner
      ? `Round ${round} Server Experiment 已选出 Winner ${winner.candidateId}，进入 Hidden Holdout。`
      : `Round ${round} Server Experiment 保留待补证 Candidate ${pendingEvidence!.candidateId}，进入 Hidden Holdout。`,
    readyForHoldout: true,
    winnerId: winner?.candidateId,
    pendingEvidenceCandidateId: pendingEvidence?.candidateId,
    builtCount: built.length,
    buildFailureCount: buildFailures.length,
  };
}
