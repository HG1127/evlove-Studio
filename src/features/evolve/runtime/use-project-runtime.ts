import { campaignObservesLiveTarget, campaignRootBaselineForMeasurement, campaignScoringInputBlocker, campaignScoringInputFingerprint, applyProductionLearningGovernance, applyReleaseResultToProject, beginReleaseCycle, completeAutonomousMission, experimentNeedsEvidenceRepair, buildExperimentGapAdvicePayload, buildGapAdvicePayload, fallbackExperimentAdvice, integrateDistilledLesson, mergeGovernedNextQueue, nextDurableReleaseAction, prepareCampaignRetry, productionOutcomeFreshness, productionOutcomeTrend, projectHasStableHealthyProductionOutcome, projectHasLiveReleaseDecision, projectHasOnlineReleaseTarget, projectUsesConnectorRelease, projectUsesHttpRelease, projectUsesVercelRelease, transitionReleaseTarget } from "@evolution/core";
import { deliveryReadiness } from "./delivery-readiness";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopilotAiResultSchema,
  DiagnosisAiResultSchema,
  EvalSuiteAiResultSchema,
  DistillAiResultSchema,
  GapAdviceAiResultSchema,
  NextQueueAiResultSchema,
  PlanAiResultSchema,
  ProblemAnalysisAiResultSchema,
  UnderstandAiResultSchema,
  type CopilotAiResult,
} from "../ai/schemas";
import type { AcceptanceCriterion, ArtifactAcceptance, Candidate, CampaignCheckpointPhase, EvolveProject, EvolvedVersion, GateId, Stage, SupplementalValidationEvidence, TestCase } from "../schemas";
import { BaselineEvaluationError, CandidateArtifactBuildError, runAi as runAiRaw, runBaseline, runExperiment, runRelease, retryFailedExperimentCases, runValidation } from "./api";
import { abortRunScope, beginRunScope, endRunScope, isRunScopeAborted } from "./abort-scope";

import { resetDownstream, resetForProblem } from "./downstream";
import { goalReadiness } from "./goal-readiness";
import { restoreVersionArtifacts } from "./restore-artifacts";
import { getLocalProject, saveLocalProject } from "./local-store";
import {
  beginRunTask,
  endRunTask,
  getLiveRun,
  getLiveStatus,
  getRunTask,
  getTaskRuntimeStatus,
  heartbeatRunTask,
  publishLiveStatus,
  shouldResumeTask,
  subscribeLiveRuns,
  updateRunTaskProgress,
  RUN_HEARTBEAT_INTERVAL_MS,
  type RunTaskKind,
  type RuntimeStatus,
} from "./run-manager";
import { advanceCampaignScheduleAfterRun, buildRoundArchive, buildRoundRecord, campaignGoalSatisfied, campaignPreflightStopReason, campaignScheduleIssue, campaignStopReason, computeFitness, estimateRoundCost, materializeChampionOutputs, maybeUpdateSearchChampion, nextScheduledAt, selectDiverseCandidates, selectParentPool } from "./evolution-search";
import { buildSearchMemory, nextExploreRatio } from "./search-memory";
import { baselineFingerprint, baselineScoringRouteFingerprint, campaignScoringRouteBlocker, canReuseVisibleBaseline, canReusePriorDiagnosis, getVisibleBaseline, setVisibleBaseline } from "./round-cache";
import { flagUngroundedCandidates } from "./plan-grounding";
import { baselineRubricProblem, buildFocusedPlanPayload, focusedTask, focusedSourceContext, prioritizeProblems, limitPlanToTask } from "./focused-task";
import { compactProblemAnalysisInput } from "./problem-analysis-input";
import { baselineReadiness } from "./baseline-readiness";
import { resolveEvidenceRefs } from "./evidence-provenance";
import { acceptanceArtifacts, ensureAcceptanceRubric } from "./artifact-quality";
import { mapTestsToRubric, normalizeAcceptanceRubric, rubricSuiteCoverage, rubricValidation } from "./acceptance-rubric";
import { normalizeEvalSuiteForProject } from "./eval-suite-normalization";
import { runArtifactAcceptanceLoop } from "./artifact-loop";
import { resolveProjectOperationConnections } from "../ai/providers/registry";
import { resolveProjectArtifactStrategy } from "./artifact-strategy";
import { repositoryGoalCoverage } from "../sources/repository-intelligence";
import { getArtifactBlob } from "./artifact-blob-store";
import { extractSource } from "../sources/source-loader";
import { compileSemanticEvolution } from "./semantic-evolution";
import { projectAtSearchChampion } from "./search-base";
import { evidenceFingerprint } from "./evidence-binding";
import { getVisualEvidence } from "./visual-evidence";
import { LOCAL_REVIEW_CONTRACT_VERSION, reconcileAttentionRequest } from "./autonomous-orchestrator";
import { evolutionHarness, type HarnessPlan } from "./evolution-harness";
import { createHarnessActionExecutor, isLocalBaselineEvidencePause, isLocalBaselineJudgePause, isLocalDemoBaselinePause } from "@evolution/harness";
import { getProductionRuntime, productionRuntimeMode } from "./production-runtime";
import { localProductionPorts } from "./local-production-adapters";
import { shouldUseServerAutoPilot, startServerEvolutionWorkflow } from "./server-workflow-client";
import { flushProductionMissionSync } from "./production-sync";
import { classifyRuntimeFailure, retryDelayMs } from "./failure-router";
import { reconcileServerRelease } from "./server-release-client";
import { getAiProviderStatus, withProjectAiProfile } from "../ai/service";
import { automaticEvidenceKey, ensureAutomaticEvidence } from "./automatic-evidence";

const stageOrder: Stage[] = ["target", "baseline", "problem", "diagnosis", "plan", "experiment", "validation", "release", "learning"];

export type { RuntimeStatus };

export type ValidationRequestDisposition = "run-now" | "already-running" | "pause-campaign-and-queue" | "queue-after-current";

/** Decide what a user-initiated revalidation click should do instead of silently disabling the button. */
export function validationRequestDisposition(status: RuntimeStatus, campaignStatus: EvolveProject["campaign"]["status"]): ValidationRequestDisposition {
  if (!status.busy) return "run-now";
  if (/(Hidden Validation|Artifact Acceptance|重新验收|验收|验证)/i.test(status.label ?? status.phase ?? "")) return "already-running";
  if (campaignStatus === "running") return "pause-campaign-and-queue";
  return "queue-after-current";
}

// 可续跑动作登记表：run(label) 的 label 即动作身份。刷新后按 actionId 自动重新执行对应节点。
// 「发布动作」「Evolve Copilot」刻意不登记：真实流量动作与交互式问答不允许自动重放。
const RESUMABLE_RUNS: Record<string, { kind: RunTaskKind; actionId?: string }> = {
  "AI 编译 Acceptance Rubric": { kind: "action", actionId: "rubric" },
  "AI 生成 Eval Suite": { kind: "action", actionId: "eval-suite" },
  "重新深度解析输入": { kind: "action", actionId: "parser-refresh" },
  "运行 Baseline": { kind: "action", actionId: "baseline" },
  "AI 分析问题": { kind: "action", actionId: "problems" },
  "AI 根因诊断": { kind: "action", actionId: "diagnosis" },
  "AI 生成进化方案": { kind: "action", actionId: "plan" },
  "运行 Candidate 实验": { kind: "action", actionId: "experiment" },
  "补考实验失败题": { kind: "action", actionId: "experiment-retry" },
  "运行 Hidden Validation": { kind: "action", actionId: "validation" },
  "Gate F · Artifact Acceptance": { kind: "action", actionId: "validation" },
  "补考失败题": { kind: "action", actionId: "validation-retry" },
  "补考后 Artifact Acceptance": { kind: "action", actionId: "validation-retry" },
  "AI 提炼经验": { kind: "action", actionId: "distill" },
  "AI 生成下一轮建议": { kind: "action", actionId: "next-queue" },
  "运行一轮 Evolution Search": { kind: "campaign" },
};

function now() {
  return new Date().toISOString();
}

// 轮内阶段顺序表：断点记「已完成到哪个阶段」，恢复时按序号跳过已完成阶段，从下一步接着跑。
const CHECKPOINT_PHASES: CampaignCheckpointPhase[] = ["baseline", "problem", "diagnose", "plan", "experiment", "validation"];
export const CHECKPOINT_PHASE_LABELS: Record<CampaignCheckpointPhase, string> = {
  baseline: "基线体检",
  problem: "问题分析",
  diagnose: "根因诊断",
  plan: "方案生成",
  experiment: "沙箱实验",
  validation: "盲测验证",
};

/** 把盲测后的差距归因与 AI 优化建议打包进方案生成输入：让候选直接针对建议动作，而不是从零开始猜。 */
function gapPlanContext(project: EvolveProject) {
  const v = project.validationRun;
  if (v.status === "completed" && v.evaluation) return {
    gapContext: buildGapAdvicePayload({ project, checks: v.checks, evaluation: v.evaluation, baselineEvaluation: v.baselineEvaluation, runs: v.runs, baselineRuns: v.baselineRuns }),
    gapAdvice: v.aiAdvice,
  };
  if (project.experimentRun.status === "completed" && !project.experimentRun.winnerId && !project.experimentRun.pendingEvidenceCandidateId) return {
    gapContext: buildExperimentGapAdvicePayload(project, project.experimentRun),
    gapAdvice: project.experimentRun.aiAdvice,
  };
  if (project.campaign.currentRound > 0 && project.campaign.lastGapAdvice) return {
    gapContext: { phase: "campaign-gap-memory", previousRound: project.campaign.currentRound, note: "上一轮未形成新 Champion；以下建议必须在本轮 Candidate 中被回应。" },
    gapAdvice: project.campaign.lastGapAdvice,
  };
  return undefined;
}

function rubricSuiteState(project: EvolveProject, evalSuite: TestCase[], hiddenEvalSuite: TestCase[]) {
  const validation = rubricValidation(project.acceptanceRubric);
  const coverage = rubricSuiteCoverage(project.acceptanceRubric, evalSuite, hiddenEvalSuite);
  const hiddenHard = coverage.hiddenHardGateMissing.map((criterion) => criterion.id);
  const uncoveredCriterionIds = [...new Set([...coverage.uncovered, ...hiddenHard])];
  const warnings = [
    ...validation.warnings,
    ...(coverage.uncovered.length ? [`${coverage.uncovered.length} 条 Criterion 没有测试覆盖`] : []),
    ...(hiddenHard.length ? [`Hard Gate 没有 Hidden Holdout：${hiddenHard.join(", ")}`] : []),
  ];
  return {
    ...project.acceptanceRubricState,
    status: validation.ready && !uncoveredCriterionIds.length ? "ready" as const : "invalid" as const,
    weightTotal: validation.weightTotal,
    uncoveredCriterionIds,
    warnings,
    summary: warnings.length ? "Rubric / Eval Mapping 需要修复。" : "Acceptance Rubric 与 Eval/Hidden 映射完整。",
  };
}

function compactStructuredContent(project: EvolveProject, artifact: EvolveProject["sourceArtifacts"][number]) {
  const value = artifact.structuredContent as Record<string, unknown> | undefined;
  if (!value) return undefined;
  if (artifact.artifactKind === "codebase" && value.kind === "package") {
    const goal = repositoryGoalCoverage({ artifact, command: project.evolutionCommand });
    const repo = goal.intelligence;
    return {
      kind: "repository-summary",
      inventory: value.inventory,
      manifestSample: artifact.structure.slice(0, 260),
      repository: {
        totalEntries: repo.totalEntries,
        eligibleEntries: repo.eligibleEntries,
        deepIndexedEntries: repo.deepIndexedEntries,
        codeFiles: repo.codeFiles,
        parsedCodeFiles: repo.parsedCodeFiles,
        indexedSymbols: repo.indexedSymbols,
        internalImports: repo.internalImports,
        resolvedInternalImports: repo.resolvedInternalImports,
        entrypoints: repo.entrypoints.slice(0, 12),
        criticalModules: repo.criticalModules.slice(0, 20),
        featureClusters: repo.featureClusters.slice(0, 16).map((item)=>({id:item.id,label:item.label,count:item.paths.length,paths:item.paths.slice(0,12)})),
      },
      userGoalEvidence: goal.anchors.map((anchor)=>({id:anchor.id,label:anchor.label,coverage:anchor.coverage,evidencePaths:anchor.evidencePaths})),
      coverage: {
        deepIndex: goal.deepIndexCoverage,
        criticalModules: goal.criticalModuleCoverage,
        dependencies: goal.dependencyCoverage,
        userGoalEvidence: goal.requirementEvidenceCoverage,
        semantic: goal.semanticCoverage,
      },
      parserPolicy: value.parserPolicy,
    };
  }
  if (artifact.artifactKind === "presentation") {
    const slides = (value.slides as Array<Record<string,unknown>> | undefined) ?? [];
    return { kind:value.kind, slideCount:slides.length, slides:slides.slice(0,40).map((slide)=>({number:slide.number,path:slide.path,textRuns:Array.isArray(slide.textRuns)?slide.textRuns.slice(0,40):undefined})) };
  }
  if (artifact.artifactKind === "spreadsheet") {
    const sheets = (value.sheets as Array<Record<string,unknown>> | undefined) ?? [];
    return { kind:value.kind, sheetCount:sheets.length, sheets:sheets.slice(0,12).map((sheet)=>({name:sheet.name,cells:Array.isArray(sheet.cells)?sheet.cells.slice(0,250):undefined,csv:typeof sheet.csv==="string"?sheet.csv.slice(0,8000):undefined})) };
  }
  if (artifact.artifactKind === "document") return { kind:value.kind, parts:Array.isArray(value.parts)?value.parts.slice(0,40):undefined };
  return { kind:value.kind ?? "structured", keys:Object.keys(value).slice(0,40) };
}

function sourceEvidence(project: EvolveProject, focus = "") {
  const workingProject = projectAtSearchChampion(project);
  const query = [project.evolutionCommand, project.goal, focus, ...project.acceptanceRubric.map(c => c.requirement)].join(" ");
  const context = focusedSourceContext(workingProject, query);
  return {
    aiProfile: project.aiProfile, evolutionCommand: project.evolutionCommand,
    sourceUnderstanding: project.sourceUnderstanding,
    inputUnderstanding: project.inputUnderstanding,
    inputClarifications: project.inputClarifications,
    searchBaseVersion: project.searchChampion?.versionLabel ?? project.version,
    adaptiveStrategy: resolveProjectArtifactStrategy(workingProject),
    sourceArtifacts: context.sources.map(source => {
      const artifact = workingProject.sourceArtifacts.find(a => a.id === source.id)!;
      return { ...source, artifactDescriptor: artifact.artifactDescriptor,
        structuredContent: compactStructuredContent(workingProject, artifact), parseStatus: artifact.parseStatus };
    }),
    contextCoverage: { totalArtifacts: context.totalArtifacts, omittedArtifactIds: context.omittedArtifactIds,
      usedChars: context.usedChars, budget: context.budget, limitation: context.limitation },
    readFocus: focus,
  };
}

// 实时活动日志：多轮编排 / 定时任务运行时，每个关键动作写入一条，编排页据此展示"现在做到哪了"。
// 模块级单例 + 本地存储持久化：切 tab / 组件卸载 / 页面刷新都不清空——刷新后自动续跑时，
// 用户还能看到中断前跑到哪一步、每一步耗时多少。按项目分组，上限 80 条。
// ms 为该动作耗时（毫秒）：完成/失败类条目带上耗时，编排页做分阶段耗时统计。
export type RunActivityEntry = { at: string; label: string; ms?: number; projectId?: string };
const ACTIVITY_KEY = "evolve-studio:run-activity:v1";
function loadActivity(): RunActivityEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVITY_KEY) ?? "[]") as RunActivityEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 80) : [];
  } catch { return []; }
}
const RUN_ACTIVITY: RunActivityEntry[] = loadActivity();
export function getRunActivity(projectId?: string): RunActivityEntry[] {
  return projectId ? RUN_ACTIVITY.filter((entry) => entry.projectId === projectId) : RUN_ACTIVITY;
}
function pushActivity(label: string, ms?: number, projectId?: string) {
  RUN_ACTIVITY.unshift({ at: new Date().toISOString(), label, ms, projectId });
  if (RUN_ACTIVITY.length > 80) RUN_ACTIVITY.length = 80;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(RUN_ACTIVITY)); } catch { /* 存储满时日志仅保留在内存 */ }
  }
}

export function useProjectRuntime(initialProject: EvolveProject) {
  const projectId = initialProject.id;
  const [project, setProjectState] = useState(initialProject);
  const projectRef = useRef(initialProject);
  const [stage, setStage] = useState<Stage>(initialProject.stage);
  // 挂载时接管仍在运行的任务状态：退出项目界面再进来，后台任务没停，状态也不能丢。
  const runStartedMsRef = useRef<number>(Date.now());

  const [status, setStatusLocal] = useState<RuntimeStatus>(() => {
    const live = typeof window === "undefined" ? undefined : getLiveStatus(projectId);
    const persisted = typeof window === "undefined" ? undefined : getTaskRuntimeStatus(projectId);
    return live?.busy ? live : persisted?.busy ? persisted : { busy: false };
  });
  const [validationRequestQueued, setValidationRequestQueued] = useState(false);
  // 所有状态变更同步发布到内存镜像：重新进入界面的新实例、以及页面上任何订阅方都能接上。
  const setStatus = useCallback((next: RuntimeStatus) => {
    setStatusLocal(next);
    publishLiveStatus(projectId, next);
    if (next.busy) updateRunTaskProgress(projectId, next);
  }, [projectId]);
  useEffect(() => subscribeLiveRuns(() => {
    const live = getLiveStatus(projectId);
    if (live) setStatusLocal(live);
  }), [projectId]);
  // 任务运行中按秒刷新已用时间：进度原本只在阶段点上报，AI 长等待期间
  // 界面会一直停在「已用 0s」，容易被误判成卡死。
  useEffect(() => {
    if (!status.busy) return;
    const timer = window.setInterval(() => {
      setStatusLocal((current) => {
        if (!current.busy) return current;
        const persistedStart = current.startedAt ? new Date(current.startedAt).getTime() : NaN;
        const startedAtMs = Number.isFinite(persistedStart) ? persistedStart : runStartedMsRef.current;
        return { ...current, elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)) };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status.busy]);

  const commit = useCallback((updater: EvolveProject | ((current: EvolveProject) => EvolveProject)) => {
    // Make confirmation immediately visible to the next async action. React may
    // defer a state updater; persistence must not run inside that updater either.
    const next = typeof updater === "function" ? updater(projectRef.current) : updater;
    const withTimestamp = { ...next, updatedAt: now() };
    projectRef.current = withTimestamp;
    saveLocalProject(withTimestamp);
    setProjectState(withTimestamp);
  }, []);

  // Repair local projects persisted by older builds with campaign=running after the task ended.
  // On refresh the transient error text is gone, so the absence of both a live run and a
  // resumable task registration is the reliable signal. Never touch a real in-flight task.
  useEffect(() => {
    if (productionRuntimeMode() !== "local" || status.busy || getLiveRun(projectId) || getRunTask(projectId)) return;
    if (projectRef.current.campaign.status !== "running") return;
    const candidateBuildFailed = /所选 \d+ 个 Candidate 均未生成可运行文件|build-candidate生成未完成/.test(status.error ?? "");
    commit((current) => ({
      ...current,
      campaign: { ...current.campaign, status: "paused", stopReason: candidateBuildFailed
        ? "候选文件构造未完成；已保留本轮断点。请检查模型连接后继续自主进化。"
        : "上次本地进化已中断；已保留本轮断点。请检查运行记录后继续自主进化。" },
    }));
  }, [commit, projectId, status.busy, status.error]);

  const backgroundEvidenceKey = automaticEvidenceKey(project);
  useEffect(() => {
    let mounted = true;
    const snapshot = projectRef.current;
    void ensureAutomaticEvidence(snapshot).then((result) => {
      if (!mounted || !result.connection) return;
      commit((current) => current.targetConnection.adapter === result.connection!.adapter
        ? current
        : { ...current, targetConnection: result.connection! });
    }).catch(() => {
      // Evidence jobs keep their own failed/unavailable state; project work must not be blocked.
    });
    return () => { mounted = false; };
  }, [backgroundEvidenceKey, commit]);

  // 所有项目内 AI 调用统一从这里进入。runEvolveAi 会从 payload 中解析 projectAiProfile；
  // 由 Runtime 自动注入当前最新项目配置，避免某个节点构造精简 payload 时漏掉 aiProfile，
  // 造成“界面已切模型、实际调用仍走全局路由”的双真相问题。
  const runProjectAi = useCallback(<T,>(operation: Parameters<typeof runAiRaw>[0], payload: unknown, onAttemptNotice?: Parameters<typeof runAiRaw>[2]) => {
    return runAiRaw<T>(operation, withProjectAiProfile(payload, projectRef.current.aiProfile), onAttemptNotice);
  }, []);

  // 后台任务在界面卸载后仍会继续把进展写入本地存储；重新进入的实例监听存储变化，
  // 把最新项目数据同步进来——回到界面就能看到任务推进，而不是停在离开时的画面。
  useEffect(() => {
    const onProjectsChanged = () => {
      if (!getLiveRun(projectId)) return; // 只接管「后台仍在跑」的项目，避免覆盖本地编辑
      const fresh = getLocalProject(projectId);
      if (!fresh || fresh.updatedAt === projectRef.current.updatedAt) return;
      projectRef.current = fresh;
      setProjectState(fresh);
      setStage(fresh.stage);
    };
    window.addEventListener("evolve-projects-changed", onProjectsChanged);
    return () => window.removeEventListener("evolve-projects-changed", onProjectsChanged);
  }, [projectId]);

  // resume 登记：刷新后内存全丢，但本地存储里的任务登记还在。
  // 重新进入项目时按登记自动续跑（多轮编排从检查点继续，单节点动作重新执行）。
  const run = useCallback(async <T,>(label: string, task: () => Promise<T>, resume?: { kind: RunTaskKind; actionId?: string }) => {
    const resumeInfo = resume ?? RESUMABLE_RUNS[label];
    runStartedMsRef.current = Date.now();
    // 每个动作开一个打断作用域：暂停键按下时，在途 AI 请求立刻中止，不必等当前一步跑完。
    beginRunScope(projectId);
    setStatus({ busy: true, label, phase: label, startedAt: new Date(runStartedMsRef.current).toISOString(), percent: 0 });
    if (resumeInfo) beginRunTask(projectId, { ...resumeInfo, label });
    const heartbeat = resumeInfo && typeof window !== "undefined"
      ? window.setInterval(() => heartbeatRunTask(projectId), RUN_HEARTBEAT_INTERVAL_MS)
      : undefined;
    pushActivity(label, undefined, projectId);
    const startedAtMs = Date.now();
    let attempt = 0;
    try {
      while (true) {
        attempt += 1;
        try {
          const result = await task();
          // 任务正常返回但作用域被打断：说明是用户暂停（轮内已自行收敛成 paused 结果），按「已暂停」收尾。
          if (isRunScopeAborted(projectId)) {
            pushActivity(`${label} · 已暂停（断点已保存，可从断点继续）`, Date.now() - startedAtMs, projectId);
            setStatus({ busy: false, message: `${label}已暂停` });
          } else {
            pushActivity(`${label} · 完成`, Date.now() - startedAtMs, projectId);
            setStatus({ busy: false, message: `${label}完成` });
          }
          return result;
        } catch (error) {
          // 打断以异常形式冒泡上来（任务没有自行捕获）：同样按暂停收尾，不当作失败弹红条。
          if (isRunScopeAborted(projectId)) {
            pushActivity(`${label} · 已暂停（断点已保存）`, Date.now() - startedAtMs, projectId);
            setStatus({ busy: false, message: `${label}已暂停` });
            return undefined as T;
          }
          const disposition = classifyRuntimeFailure(error);
          // 只自动重试可恢复的离线动作。连接真实 HTTP Runner 时禁止自动重复执行，避免副作用型 E2E 被重复触发。
          const canRetry = Boolean(resumeInfo && projectRef.current.targetConnection.adapter !== "http" && disposition.retryable && attempt < disposition.maxAttempts);
          if (canRetry) {
            const delay = retryDelayMs(disposition, attempt);
            pushActivity(`${label} · ${disposition.reason}，自动重试 ${attempt + 1}/${disposition.maxAttempts}`, Date.now() - startedAtMs, projectId);
            setStatus({ busy: true, label, phase: `${label} · 自动恢复`, detail: `${disposition.reason}，${Math.ceil(delay / 1000)} 秒后重试`, startedAt: new Date(runStartedMsRef.current).toISOString() });
            await new Promise((resolve) => window.setTimeout(resolve, delay));
            continue;
          }
          const message = error instanceof Error ? error.message : "操作失败";
          pushActivity(`${label} · 失败：${message}`, Date.now() - startedAtMs, projectId);
          setStatus({ busy: false, error: message });
          throw error;
        }
      }
    } finally {
      if (heartbeat) window.clearInterval(heartbeat);
      if (resumeInfo) endRunTask(projectId);
      endRunScope(projectId);
    }
  }, [projectId, setStatus]);

  const reportProgress = useCallback((label: string, done: number, total: number, phase?: string, operation?: import("../ai/schemas").AiOperation, actualRoute?: { provider?: string; model?: string }) => {
    const elapsedSeconds = Math.max(0, (Date.now() - runStartedMsRef.current) / 1000);
    const percent = total > 0 ? Math.min(100, Math.round(done / total * 100)) : undefined;
    const etaSeconds = done > 0 && total > done ? Math.round(elapsedSeconds / done * (total - done)) : undefined;
    const route = operation ? resolveProjectOperationConnections(operation, projectRef.current.aiProfile)[0] : undefined;
    setStatus({ busy: true, label, phase: phase ?? label, done, total, percent, elapsedSeconds: Math.round(elapsedSeconds), etaSeconds, startedAt: new Date(runStartedMsRef.current).toISOString(), provider: actualRoute?.provider ?? route?.connection.label, model: actualRoute?.model ?? route?.model, operation });
  }, [setStatus]);

  const gate = useCallback((id: GateId) => project.gates.find((item) => item.id === id), [project.gates]);

  const approveGate = useCallback((id: GateId, note?: string) => {
    let blocked: string | undefined;
    if (id === "target-ready") {
      const rubricState = rubricValidation(project.acceptanceRubric);
      if (!goalReadiness(project).ready) blocked = goalReadiness(project).blockers.join("；");
      else if (!project.goal || project.metrics.length < 2) blocked = "目标与验收指标还不完整";
      else if (project.acceptanceRubricState.status !== "ready" || !rubricState.ready) blocked = `Project-specific Acceptance Rubric 尚未 Ready：${rubricState.warnings.join("；") || "请先 AI 编译并确认验收标准"}`;
    }
    if (id === "experiment-ready" && (!project.diagnosis || project.selectedCandidateIds.length === 0)) blocked = "请先完成根因诊断并选择至少一个 Candidate";
    if (id === "artifact-ready" && !deliveryReadiness(project).ready) blocked = "最终 Artifact 尚未通过 Gate F · Artifact Ready";
    if (id === "release-ready" && !deliveryReadiness(project).ready) blocked = deliveryReadiness(project).reasons.join("；");
    if (blocked) { setStatus({ busy: false, error: blocked }); return false; }
    const approvedAt = now();
    commit((current) => {
      const releaseCandidateId=current.experimentRun.winnerId??current.searchChampion?.candidate?.id;
      const shouldBeginReleaseCycle=id==="release-ready"
        &&projectHasOnlineReleaseTarget(current)
        &&Boolean(releaseCandidateId)
        &&(current.release.candidateId!==releaseCandidateId||current.release.status!=="idle");
      return {
        ...current,
        acceptanceRubricState: id === "target-ready" ? { ...current.acceptanceRubricState, confirmedAt: approvedAt } : current.acceptanceRubricState,
        release:shouldBeginReleaseCycle&&releaseCandidateId?beginReleaseCycle(current.release,releaseCandidateId):current.release,
        gates: current.gates.map((item) => item.id === id ? { ...item, status: "approved", approvedAt, note } : item),
      };
    });
    setStatus({ busy: false, message: `${id} 已确认` });
    return true;
  }, [commit, project, setStatus]);

  const goNext = useCallback(() => {
    const index = stageOrder.indexOf(stage);
    if (index < stageOrder.length - 1) {
      const next = stageOrder[index + 1]!;
      setStage(next);
      commit((current) => ({ ...current, stage: next }));
    }
  }, [stage, commit]);

  const compileAcceptanceRubric = useCallback(async (force = false) => {
    const criteria = await run("AI 编译 Acceptance Rubric", async () => { reportProgress("等待 Acceptance Designer 返回",0,1,"定义验收标准","rubric"); const result=await ensureAcceptanceRubric(projectRef.current,{force}); reportProgress("Acceptance Rubric 已生成",1,1,"定义验收标准","rubric"); return result; });
    const validation = rubricValidation(criteria);
    const compiledAt = now();
    commit((current) => {
      // Rubric is part of the Evolve Contract. Recompiling it invalidates every downstream
      // score/candidate, because an old Winner must not survive a changed objective.
      const base = (current.baselineRun.status !== "idle" || current.evalSuite.length || current.candidates.length || current.gates.find((gate) => gate.id === "target-ready")?.status === "approved")
        ? resetDownstream(current)
        : current;
      return {
        ...base,
        acceptanceRubric: criteria,
        acceptanceRubricState: {
          status: validation.ready ? "ready" : "invalid",
          summary: validation.ready ? `已编译 ${criteria.length} 条项目专属验收标准；Target Ready 必须显式确认。` : "Rubric 仍有结构问题，不能通过 Target Ready。",
          version: current.acceptanceRubricState.version + 1,
          compiledAt,
          confirmedAt: undefined,
          weightTotal: validation.weightTotal,
          uncoveredCriterionIds: [],
          warnings: validation.warnings,
        },
        gates: base.gates.map((gate) => gate.id === "target-ready" ? { ...gate, status: validation.ready ? "ready" : "blocked", approvedAt: undefined, note: validation.ready ? "Acceptance Rubric 已 Ready，等待确认" : validation.warnings.join("；") } : gate),
      };
    });
    return criteria;
  }, [commit, reportProgress, run]);

  const setRubricCriteria = useCallback((criteria: AcceptanceCriterion[], summary: string) => {
    const normalized = criteria;
    const validation = rubricValidation(normalized);
    commit((current) => {
      const base = (current.baselineRun.status !== "idle" || current.evalSuite.length || current.candidates.length || current.gates.find((gate) => gate.id === "target-ready")?.status === "approved")
        ? resetDownstream(current)
        : current;
      return {
        ...base,
        acceptanceRubric: normalized,
        acceptanceRubricState: {
          ...current.acceptanceRubricState,
          status: validation.ready ? "ready" : "invalid",
          summary,
          version: current.acceptanceRubricState.version + 1,
          compiledAt: current.acceptanceRubricState.compiledAt ?? now(),
          confirmedAt: undefined,
          weightTotal: validation.weightTotal,
          uncoveredCriterionIds: [],
          warnings: validation.warnings,
        },
        gates: base.gates.map((gate) => gate.id === "target-ready" ? { ...gate, status: validation.ready ? "ready" : "blocked", approvedAt: undefined, note: validation.ready ? "Rubric 已更新，等待重新确认" : validation.warnings.join("；") } : gate),
      };
    });
  }, [commit]);

  const updateAcceptanceCriterion = useCallback((criterionId: string, patch: Partial<AcceptanceCriterion>) => {
    setRubricCriteria(projectRef.current.acceptanceRubric.map((criterion) => criterion.id === criterionId ? { ...criterion, ...patch } : criterion), "Rubric 已人工修改；需要重新确认 Target Ready。");
  }, [setRubricCriteria]);

  const deleteAcceptanceCriterion = useCallback((criterionId: string) => {
    if (criterionId.startsWith("SYS-") || criterionId.startsWith("PROTECT-")) throw new Error("系统完整性/保护项 Criterion 不能直接删除；请修改项目保护边界。 ");
    setRubricCriteria(projectRef.current.acceptanceRubric.filter((criterion) => criterion.id !== criterionId), "Rubric 已删除一条验收标准；需要重新确认。");
  }, [setRubricCriteria]);

  const addAcceptanceCriterion = useCallback(() => {
    const current = projectRef.current.acceptanceRubric;
    const id = `REQ-MANUAL-${Date.now()}`;
    setRubricCriteria([...current, { id, title: "新增验收标准", requirement: "请填写可验证的用户要求", source: "user-command", weight: 5, hardGate: false, judgeType: "llm", validationMethod: "semantic-judge", minScore: 85, evidenceExpected: ["可定位的成果证据"], protectedConstraint: false, artifactIds: [], category: "outcome" }], "已新增手工 Criterion；请完善并校准权重。");
  }, [setRubricCriteria]);

  const normalizeRubricWeights = useCallback(() => {
    setRubricCriteria(normalizeAcceptanceRubric(projectRef.current.acceptanceRubric, projectRef.current), "Rubric 权重已归一到 100；等待确认 Target Ready。");
  }, [setRubricCriteria]);

  const refreshParsing = useCallback(async () => {
    return run("重新深度解析输入", async () => {
      const current = projectRef.current;
      const refreshed = [] as EvolveProject["sourceArtifacts"];
      let reparsed = 0;
      for (const [index, artifact] of current.sourceArtifacts.entries()) {
        reportProgress(`重新解析 ${artifact.name}`, index, current.sourceArtifacts.length, "输入解析", "intake");
        const blob = await getArtifactBlob(artifact.id).catch(() => undefined);
        if (!blob) {
          refreshed.push({ ...artifact, warnings: [...artifact.warnings, "无法找到原始二进制 Blob；保留旧解析结果。重新上传该成果可获得 V2.8 Deep Index。"] });
          continue;
        }
        try {
          const parsed = await extractSource({ name: artifact.name, mimeType: artifact.mimeType, buffer: new Uint8Array(await blob.arrayBuffer()) });
          refreshed.push({
            ...artifact,
            artifactKind: parsed.artifactKind,
            artifactDescriptor: parsed.artifactDescriptor,
            parseStatus: parsed.extractedText || parsed.structuredContent ? "ready" : artifact.parseStatus,
            textContent: parsed.extractedText,
            textExcerpt: parsed.excerpt,
            structure: parsed.structure,
            structuredContent: parsed.structuredContent,
            parsingProfile: parsed.parsingProfile,
            warnings: parsed.warnings,
            extension: parsed.extension || artifact.extension,
          });
          reparsed += 1;
        } catch (error) {
          refreshed.push({ ...artifact, warnings: [...artifact.warnings, `V2.8 深度解析失败：${error instanceof Error ? error.message : String(error)}`] });
        }
      }
      const compiled = compileSemanticEvolution({ artifacts: refreshed, command: current.evolutionCommand });
      commit((state) => ({
        ...resetDownstream(state, {invalidateUnderstanding:true}),
        sourceArtifacts: refreshed,
        artifactGraph: compiled.artifactGraph,
        semanticEvolution: compiled.semanticEvolution,
        goal: compiled.semanticEvolution.intent.desiredChanges.join("；") || state.goal,
        stage: "target",
      }));
      setStage("target");
      reportProgress(`深度解析完成 ${reparsed}/${refreshed.length}`, refreshed.length, refreshed.length, "输入解析", "intake");
      return { reparsed, total: refreshed.length };
    });
  }, [commit, reportProgress, run, setStage]);

  const generateEvalSuite = useCallback(async () => {
    const currentProject = projectRef.current;
    const rubricCheck = rubricValidation(currentProject.acceptanceRubric);
    if (!rubricCheck.ready) {
      throw new Error(`请先完成 Project-specific Acceptance Rubric：${rubricCheck.warnings.join("；") || "Rubric 尚未 Ready"}`);
    }
    const rubric = currentProject.acceptanceRubric;
    const result = await run("AI 生成 Eval Suite", async () => { reportProgress("等待 Eval Designer 出题",0,1,"生成项目专属测试","eval-suite"); const output=EvalSuiteAiResultSchema.parse(await runProjectAi("eval-suite", {
      project: {
        objectType: currentProject.objectType, department: currentProject.department, goal: currentProject.goal,
        problemStatement: currentProject.problemStatement, desiredOutcome: currentProject.desiredOutcome,
        metrics: currentProject.metrics, protectedItems: currentProject.protectedItems, editableItems: currentProject.editableItems,
        acceptanceRubric: rubric,
        ...sourceEvidence(currentProject, "根据用户进化目标生成专属验收题，优先读取与验收标准直接相关的成果内容和结构"),
      },
      evaluatorInstruction: "Acceptance Rubric is the PRIMARY contract. Keep the suite compact. Every test must list criterionIds, executionMode and evidenceScope. For self-contained HTML, external-runner tests MUST include browserSteps with explicit click/fill/visible/text/count actions, selectors grounded in actual source markup, and at least one observable assertion. Do not invent selectors; use visual-review or manual when no executable assertion can be established. Tests describe user/business outcomes; source filenames/functions may be cited as evidence but must not become the objective unless explicitly requested. Cover every criterion at least once and every hardGate in Hidden Holdout. If the project lacks browser/E2E/visual capability, select external-runner/visual-review truthfully; the runtime will mark UNVERIFIED instead of fabricating a failure.",
    })); reportProgress("Eval Suite 已生成",1,1,"生成项目专属测试","eval-suite"); return output; });
    const mappedRaw = mapTestsToRubric(rubric, result.validationCases, result.hiddenCases);
    const mapped = normalizeEvalSuiteForProject({ ...currentProject, acceptanceRubric: rubric }, mappedRaw.validationCases, mappedRaw.hiddenCases);
    const coverage = rubricSuiteCoverage(rubric, mapped.validationCases, mapped.hiddenCases);
    const hiddenHardGates = coverage.hiddenHardGateMissing.map((criterion) => criterion.id);
    const warnings = [
      ...(coverage.uncovered.length ? [`${coverage.uncovered.length} 条 Criterion 未映射测试题`] : []),
      ...(hiddenHardGates.length ? [`Hard Gate 未覆盖 Hidden Holdout：${hiddenHardGates.join(", ")}`] : []),
    ];
    commit((current) => ({
      ...current,
      acceptanceRubric: rubric,
      acceptanceRubricState: {
        ...current.acceptanceRubricState,
        status: warnings.length ? "invalid" : "ready",
        summary: warnings.length ? "Eval Suite 未完全覆盖 Acceptance Rubric。" : `Rubric ${rubric.length} 条均已映射测试，Hard Gate 已进入 Hidden Holdout。`,
        weightTotal: rubricCheck.weightTotal,
        uncoveredCriterionIds: [...new Set([...coverage.uncovered, ...hiddenHardGates])],
        warnings,
      },
      artifactAcceptance: { id: `artifact-acceptance-${Date.now()}`, status: "idle", overallScore: 0, coverageScore: 0, integrityScore: 0, pairwiseScore: 0, hardGatePass: false, results: [], attempts: 0, maxRepairAttempts: current.artifactAcceptance.maxRepairAttempts || 3, summary: "等待 Best-Ever / Winner Artifact 验收" },
      evalSuite: mapped.validationCases,
      hiddenEvalSuite: mapped.hiddenCases,
      baselineRun: { ...current.baselineRun, status: "idle", totalCases: mapped.validationCases.length, result: undefined, runs: [] },
      problems: [], selectedProblemId: undefined, diagnosis: undefined, candidates: [], selectedCandidateIds: [],
      experimentRun: { id: `experiment-${Date.now()}`, status: "idle", candidateResults: [] },
      validationRun: { id: `validation-${Date.now()}`, status: "idle", checks: [], runs: [], baselineRuns: [] },
      gates: current.gates.map((gate) => gate.id === "target-ready"
        ? { ...gate, status: warnings.length ? "blocked" : gate.status === "approved" ? "approved" : "ready", note: warnings.length ? warnings.join("；") : "Acceptance Rubric 与 Eval/Hidden 映射完整" }
        : { ...gate, status: "pending", approvedAt: undefined, note: undefined }),
    }));
    if (warnings.length) throw new Error(`Eval Suite Coverage 不完整：${warnings.join("；")}`);
    return { ...result, validationCases: mapped.validationCases, hiddenCases: mapped.hiddenCases };
  }, [commit, reportProgress, run, runProjectAi]);

  const updateTestCase = useCallback((caseId: string, patch: Pick<TestCase, "title" | "input"> & Partial<Pick<TestCase, "expected" | "tags" | "criterionIds" | "executionMode" | "evidenceScope">>) => {
    commit((current) => {
      const evalSuite = current.evalSuite.map((item) => item.id === caseId ? { ...item, ...patch } : item);
      const hiddenEvalSuite = current.hiddenEvalSuite.map((item) => item.id === caseId ? { ...item, ...patch } : item);
      return { ...current, evalSuite, hiddenEvalSuite, acceptanceRubricState: rubricSuiteState(current, evalSuite, hiddenEvalSuite) };
    });
  }, [commit]);

  const deleteTestCase = useCallback((caseId: string) => {
    commit((current) => {
      const evalSuite = current.evalSuite.filter((item) => item.id !== caseId);
      const hiddenEvalSuite = current.hiddenEvalSuite.filter((item) => item.id !== caseId);
      return { ...current, evalSuite, hiddenEvalSuite, acceptanceRubricState: rubricSuiteState(current, evalSuite, hiddenEvalSuite) };
    });
  }, [commit]);

  const addTestCase = useCallback((input: { title: string; input: string; expected: string[]; hidden: boolean; criterionIds?: string[]; executionMode?: TestCase["executionMode"]; evidenceScope?: TestCase["evidenceScope"] }) => {
    const item: TestCase = { id: `case-${Date.now()}`, title: input.title, input: input.input, expected: input.expected.length ? input.expected : ["给出完整、有依据的回答"], tags: ["manual"], criterionIds: input.criterionIds ?? [], hidden: input.hidden, executionMode: input.executionMode ?? "artifact-runtime", evidenceScope: input.evidenceScope ?? "product-behavior" };
    commit((current) => {
      const evalSuite = input.hidden ? current.evalSuite : [...current.evalSuite, item];
      const hiddenEvalSuite = input.hidden ? [...current.hiddenEvalSuite, item] : current.hiddenEvalSuite;
      return { ...current, evalSuite, hiddenEvalSuite, acceptanceRubricState: rubricSuiteState(current, evalSuite, hiddenEvalSuite) };
    });
  }, [commit]);

  const executeBaseline = useCallback(async (retryIncompleteOnly = false) => {
    let source = projectRef.current;
    const suiteCoverage = rubricSuiteCoverage(source.acceptanceRubric, source.evalSuite, source.hiddenEvalSuite);
    if (!suiteCoverage.ready) {
      pushActivity("检测到 Eval Suite 与最新 Acceptance Rubric 不一致 · 系统先自动补齐测试映射", undefined, projectId);
      await generateEvalSuite();
      source = projectRef.current;
    }
    setStage("baseline");
    const baseline = await run("运行 Baseline", () => runBaseline(source, (done, total, phase) => reportProgress(`${phase ?? "运行 Baseline"}`, done, total, phase, "execute-artifact"), { retryIncompleteOnly }));
    if (!baseline) return;
    const ready = baselineReadiness({ ...source, baselineRun: baseline }).ready;
    commit((current) => ({
      ...current,
      baselineRun: baseline,
      metrics: baseline.result ? current.metrics.map((metric) => {
        if (metric.key === "evidence") return { ...metric, value: baseline.result!.evidence };
        if (metric.key === "risk" || metric.key === "robustness") return { ...metric, value: baseline.result!.riskCoverage };
        if (metric.key === "success" || metric.key === "completeness") return { ...metric, value: baseline.result!.completeness };
        if (metric.key === "quality" || metric.key === "accuracy") return { ...metric, value: baseline.result!.accuracy };
        if (metric.key === "cost") return { ...metric, value: baseline.result!.averageCost };
        return metric;
      }) : current.metrics,
      stage: ready ? "problem" : "baseline",
    }));
    setStage(ready ? "problem" : "baseline");
    const readiness = baselineReadiness({ ...source, baselineRun: baseline });
    return { ...baseline, recoverySummary: ready ? "当前证据已足够进行问题分析；低评分将作为改进依据。" : `补跑已完成，仍待补证：${readiness.blockers.join("；")}。重复执行不能替代缺少的材料或运行证据。` };
  }, [commit, generateEvalSuite, projectId, run, reportProgress, setStage]);

  const analyzeProblems = useCallback(async () => {
    const readiness = baselineReadiness(project);
    if (!readiness.ready) throw new Error(`当前版本基线不足以诊断成果问题：${readiness.blockers.join("；")}`);
    const result = ProblemAnalysisAiResultSchema.parse(await run("AI 分析问题", async () => { reportProgress("正在把失败 Trace 聚类成问题",0,1,"问题发现","problem-analysis"); const output=await runProjectAi("problem-analysis", compactProblemAnalysisInput({
      project: {
        goal: project.goal,
        protectedItems: project.protectedItems,
        editableItems: project.editableItems,
        metrics: project.metrics,
        baselineRun: project.baselineRun,
        ...sourceEvidence(project, "从当前成果和真实运行结果中找出最值得改的问题，优先读取失败相关内容、流程节点和用户目标证据"),
      },
    })); reportProgress("问题地图已生成",1,1,"问题发现","problem-analysis"); return output; }));
    const problems = result.problems.map((problem) => ({ ...problem, evidenceRefs: resolveEvidenceRefs(projectAtSearchChampion(project), problem.evidence) }));
    commit((current) => ({ ...current, problems, selectedProblemId: prioritizeProblems(problems)[0]?.problem.id ?? result.recommendedProblemId, stage: "problem" }));
    setStage("problem");
    return { ...result, problems };
  }, [commit, project, reportProgress, run, runProjectAi, setStage]);

  const selectProblem = useCallback((problemId: string) => {
    if (projectRef.current.selectedProblemId === problemId) return;
    commit((current) => resetForProblem(current, problemId));
    setStage("problem");
  }, [commit]);

  const diagnose = useCallback(async () => {
    const selected = project.problems.find((problem) => problem.id === project.selectedProblemId) ?? project.problems[0];
    if (!selected) throw new Error("请先选择一个问题");
    const result = DiagnosisAiResultSchema.parse(await run("AI 根因诊断", async () => { reportProgress("正在对比成功 / 失败 Trace",0,1,"根因诊断","diagnose"); const output=await runProjectAi("diagnose", {
      project: { goal: project.goal, metrics: project.metrics, protectedItems: project.protectedItems, editableItems: project.editableItems, ...sourceEvidence(project, `围绕问题 ${selected.title} 定位根因，读取相关成果片段、结构、Trace 和依赖`) },
      problem: selected,
      baseline: project.baselineRun,
    }, (notice) => reportProgress(notice.kind === "retry"
      ? `连接 ${notice.model} 失败：${notice.message.slice(0, 120)}；自动重试/换下一个连接`
      : `真实连接均失败，回落内置演示引擎：${notice.message.slice(0, 120)}`, 0, 1, "根因诊断", "diagnose", notice)); reportProgress("根因诊断已完成",1,1,"根因诊断","diagnose"); return output; }));
    const diagnosis = { ...result, evidenceRefs: resolveEvidenceRefs(projectAtSearchChampion(project), result.evidence) };
    commit((current) => ({ ...current, diagnosis, stage: "diagnosis" }));
    setStage("diagnosis");
    return diagnosis;
  }, [commit, project, reportProgress, run, runProjectAi]);

  const generatePlan = useCallback(async (sourceProject: EvolveProject = project) => {
    const diagnosis = sourceProject.diagnosis;
    if (!diagnosis) throw new Error("请先完成根因诊断");
    if (diagnosis.evidenceRefs.length > 0 && !diagnosis.evidenceRefs.some((ref) => ref.verified)) {
      throw new Error("根因仍没有可定位的来源、测试或 Trace 证据。请先补充证据或重新诊断，再生成方案。");
    }
    // 用户点的是「生成进化方案」而不是继续诊断。立即把可见流程切到 Plan，保证上方
    // 节点模型选择器、步骤条和下方运行状态都指向同一个真实 AI 操作；失败时也留在
    // Plan 节点，用户可直接调整该节点模型后重新生成。
    if (sourceProject.stage !== "plan") {
      setStage("plan");
      commit((current) => ({ ...current, stage: "plan" }));
    }
    // 如果上一轮盲测/实验已给出结论，把失败详情一并交给 AI，让它基于失败重新出方案而不是重复犯错
    const failedAttempt = sourceProject.validationRun.status === "completed" && sourceProject.validationRun.recommendation !== "release"
      ? { candidateId: sourceProject.validationRun.candidateId, recommendation: sourceProject.validationRun.recommendation, summary: sourceProject.validationRun.summary, checks: sourceProject.validationRun.checks }
      : sourceProject.experimentRun.status === "completed"
        ? { summary: sourceProject.experimentRun.summary, safetyFailures: sourceProject.candidates.filter((candidate) => candidate.safety === "FAIL").map((candidate) => ({ id: candidate.id, title: candidate.title, notes: candidate.notes })) }
        : undefined;
    const parsed = PlanAiResultSchema.parse(await run("AI 生成进化方案", async () => { reportProgress("正在生成本轮重点改进方案",0,1,"进化方案","plan"); const output=await runProjectAi("plan", buildFocusedPlanPayload(sourceProject, {
      searchMemory: buildSearchMemory(sourceProject),
      ...(failedAttempt ? { previousAttemptFailed: failedAttempt } : {}),
      ...(gapPlanContext(sourceProject) ?? {}),
    }), (notice) => reportProgress(notice.kind === "retry"
      ? `连接 ${notice.model} 失败：${notice.message.slice(0, 120)}；自动重试/换下一个连接`
      : `真实连接均失败，回落内置演示引擎：${notice.message.slice(0, 120)}`, 0, 1, "进化方案", "plan", notice)); reportProgress("Candidate Population 已生成",1,1,"进化方案","plan"); return output; }));
    const { result, ungroundedCount } = flagUngroundedCandidates(limitPlanToTask(sourceProject, parsed));
    if (ungroundedCount > 0) pushActivity(`${ungroundedCount} 个候选缺少源成果证据引用，已在方案卡标记`, undefined, sourceProject.id);
    commit((current) => ({
      ...current,
      candidates: result.candidates,
      selectedCandidateIds: result.recommendedCandidateIds,
      experimentRun: { id: `experiment-${Date.now()}`, status: "idle" as const, candidateResults: [] },
      gates: current.gates.map((gate) => gate.id === "experiment-ready"
        ? { ...gate, status: "ready" as const, approvedAt: undefined, note: "新方案已生成，请确认后运行实验" }
        : gate.id === "artifact-ready" || gate.id === "release-ready"
          ? { ...gate, status: "blocked" as const, approvedAt: undefined, note: "等待新方案选出 Winner" }
          : gate),
      stage: "plan",
    }));
    setStage("plan");
    return result;
  }, [commit, project, reportProgress, run, runProjectAi]);

  const toggleCandidate = useCallback((candidateId: string) => {
    commit((current) => {
      const selectedCandidateIds = current.selectedCandidateIds.includes(candidateId)
        ? current.selectedCandidateIds.filter((id) => id !== candidateId)
        : [...current.selectedCandidateIds, candidateId];
      return {
        ...current,
        selectedCandidateIds,
        gates: current.gates.map((gate) => gate.id === "experiment-ready" && gate.status === "approved"
          ? { ...gate, status: "ready" as const, approvedAt: undefined, note: "方案选择已变化，请重新确认后再运行实验" }
          : gate),
      };
    });
  }, [commit]);

  const updateExperimentPolicy = useCallback((patch: Partial<EvolveProject["experimentPolicy"]>) => {
    commit((current) => ({
      ...current,
      experimentPolicy: { ...current.experimentPolicy, ...patch },
      gates: current.gates.map((gate) => gate.id === "experiment-ready" && gate.status === "approved"
        ? { ...gate, status: "ready" as const, approvedAt: undefined, note: "验证设置已变化，请重新确认后再运行实验" }
        : gate),
    }));
  }, [commit]);

  const recordSupplementalValidationEvidence = useCallback((input: { criterionId: string; verdict: "pass" | "fail"; note: string; screenshotIds?: string[] }) => {
    const current = projectRef.current;
    const candidateId = current.experimentRun.winnerId ?? current.experimentRun.pendingEvidenceCandidateId;
    const candidate = current.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("当前没有可补证的获胜版本，请先完成新版比较");
    const criterion = current.acceptanceRubric.find((item) => item.id === input.criterionId);
    if (!criterion) throw new Error("找不到对应验收标准");
    if (criterion.validationMethod !== "visual-review" && criterion.validationMethod !== "manual-review") throw new Error("该验收项不能用人工确认替代其真实验证方式");
    const note = input.note.trim();
    if (!note) throw new Error("请填写本次验收看到的结果或判断依据");
    const screenshotIds = [...new Set(input.screenshotIds ?? [])];
    const currentHashes = new Set(candidate.artifactSnapshots.map((item) => item.contentHash).filter((value): value is string => Boolean(value)));
    const artifactHashes: string[] = [];
    if (criterion.validationMethod === "visual-review") {
      if (!screenshotIds.length) throw new Error("视觉验收至少需要上传 1 张当前版本截图");
      const store = getVisualEvidence(current.id);
      const selected = screenshotIds.map((id) => store.items.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (selected.length !== screenshotIds.length) throw new Error("部分截图已不存在，请重新上传");
      for (const item of selected) {
        if (item.candidateId !== candidate.id) throw new Error("截图不是当前获胜版本的证据，请重新上传当前版本截图");
        if (!item.artifactHash || (currentHashes.size > 0 && !currentHashes.has(item.artifactHash))) throw new Error("截图未绑定当前成果快照，不能作为本轮通过证据");
        artifactHashes.push(item.artifactHash);
      }
    }
    const record: SupplementalValidationEvidence = {
      id: `supplemental-evidence-${Date.now()}`,
      criterionId: criterion.id,
      candidateId: candidate.id,
      evidenceFingerprint: evidenceFingerprint(current, candidate),
      method: criterion.validationMethod,
      verdict: input.verdict,
      note,
      screenshotIds,
      artifactHashes: [...new Set(artifactHashes)],
      createdAt: new Date().toISOString(),
    };
    commit((project) => ({
      ...project,
      supplementalValidationEvidence: [
        ...project.supplementalValidationEvidence.filter((item) => !(item.criterionId === record.criterionId && item.candidateId === record.candidateId && item.evidenceFingerprint === record.evidenceFingerprint)),
        record,
      ],
      validationRun: { ...project.validationRun, recommendation: "hold", summary: `已记录「${criterion.title}」补充证据；等待重新验收后结算。` },
      artifactAcceptance: { ...project.artifactAcceptance, status: "idle", hardGatePass: false, acceptedAt: undefined, frozenArtifacts: undefined, summary: "补充验收证据已变化，等待重新验收" },
      outputArtifacts: project.outputArtifacts.map((artifact) => artifact.candidateId === candidate.id ? { ...artifact, accepted: false } : artifact),
      gates: project.gates.map((gate) => gate.id === "artifact-ready" || gate.id === "release-ready" ? { ...gate, status: "blocked" as const, approvedAt: undefined, note: "补充验收证据已变化，等待重新验收" } : gate),
    }));
    return record;
  }, [commit]);

  // 实验结果落库（完整实验与补考共用）：按最新评审刷新候选分数、Winner 与状态。
  const applyExperiment = useCallback((experiment: Awaited<ReturnType<typeof runExperiment>>) => {
    const resultMap = new Map(experiment.candidateResults.map((item) => [item.candidateId, item.evaluation]));
    commit((current) => {
      // 补考后 Winner 可能换人：旧的盲测结论只对被换下的候选有效，必须作废并重新锁定发布。
      const nextCandidateId = experiment.winnerId ?? experiment.pendingEvidenceCandidateId;
      const currentCandidateId = current.experimentRun.winnerId ?? current.experimentRun.pendingEvidenceCandidateId;
      const winnerChanged = experiment.id !== current.experimentRun.id || nextCandidateId !== currentCandidateId;
      return {
        ...current,
        experimentRun: experiment,
        evalSuite: experiment.comparisonSuite ?? current.evalSuite,
        baselineRun: experiment.comparisonBaseline ?? current.baselineRun,
        candidates: current.candidates.map((candidate) => {
          const evaluation = resultMap.get(candidate.id);
          if (!evaluation) return candidate;
          const resultRecord = experiment.candidateResults.find((item) => item.candidateId === candidate.id);
          return {
            ...candidate,
            artifactSnapshots: resultRecord?.artifactSnapshots ?? candidate.artifactSnapshots,
            artifactBuildStatus: resultRecord?.artifactSnapshots?.length ? "ready" : candidate.artifactBuildStatus,
            artifactBuildSummary: resultRecord?.artifactBuildSummary ?? candidate.artifactBuildSummary,
            accuracy: evaluation.accuracy,
            evidence: evaluation.evidence,
            riskCoverage: evaluation.riskCoverage,
            costDelta: current.baselineRun.result ? Number((((evaluation.averageCost / current.baselineRun.result.averageCost) - 1) * 100).toFixed(1)) : 0,
            speedDelta: current.baselineRun.result ? Number(((1 - evaluation.averageLatencyMs / current.baselineRun.result.averageLatencyMs) * 100).toFixed(1)) : 0,
            safety: evaluation.safety,
            recommended: experiment.winnerId === candidate.id,
            status: experiment.winnerId === candidate.id ? "winner" : resultRecord?.experimentStage === "screened" ? "queued" : evaluation.safety === "FAIL" ? "failed" : "passed",
            notes: resultRecord?.experimentStage === "screened" ? [...evaluation.notes, `预筛得分 ${resultRecord.screeningScore ?? "—"}，本轮未进入 Finalist 重型实验`] : evaluation.notes,
          };
        }),
        ...(winnerChanged ? {
          validationRun: { id: `validation-${Date.now()}`, status: "idle" as const, checks: [], runs: [], baselineRuns: [] },
          artifactAcceptance: { ...current.artifactAcceptance, status: "idle" as const, results: [], attempts: 0, summary: "Winner 已变更，需要重新运行 Hidden Validation 与 Artifact Acceptance" },
          gates: current.gates.map((item) => item.id === "artifact-ready" || item.id === "release-ready" ? { ...item, status: "blocked" as const, approvedAt: undefined, note: "实验 Winner 已变更，旧验证/成果验收结论作废" } : item),
        } : {}),
        stage: "experiment",
      };
    });
    setStage("experiment");
  }, [commit]);

  const generateExperimentAdvice = useCallback(async (experimentOverride?: EvolveProject["experimentRun"]) => {
    const current = projectRef.current;
    const experiment = experimentOverride ?? current.experimentRun;
    if (experiment.status !== "completed" || experiment.winnerId || experiment.pendingEvidenceCandidateId) throw new Error("仅在实验完成且没有可继续验收的候选时生成优化建议");
    const adviceProject = { ...current, evalSuite: experiment.comparisonSuite ?? current.evalSuite, baselineRun: experiment.comparisonBaseline ?? current.baselineRun, experimentRun: experiment };
    const fallback = fallbackExperimentAdvice(adviceProject, experiment);
    if (experimentNeedsEvidenceRepair(experiment)) {
      commit((latest) => latest.experimentRun.id !== experiment.id ? latest : ({ ...latest, experimentRun: { ...latest.experimentRun, aiAdvice: fallback } }));
      return fallback;
    }
    const advice = await run("分析无 Winner 原因", async () => {
      reportProgress("正在定位未胜出的关键原因", 0, 1, "无 Winner 诊断", "gap-advice");
      try {
        const result = GapAdviceAiResultSchema.parse(await runProjectAi("gap-advice", buildExperimentGapAdvicePayload(adviceProject, experiment)));
        reportProgress("优化建议已生成", 1, 1, "无 Winner 诊断", "gap-advice");
        return result.actions.length ? result : fallback;
      } catch (error) {
        pushActivity(`AI 优化建议暂不可用，已根据真实实验差距生成本地建议：${error instanceof Error ? error.message : "unknown"}`, undefined, current.id);
        reportProgress("已根据实验证据生成兜底建议", 1, 1, "无 Winner 诊断", "gap-advice");
        return fallback;
      }
    });
    commit((latest) => latest.experimentRun.id !== experiment.id ? latest : ({ ...latest, experimentRun: { ...latest.experimentRun, aiAdvice: advice } }));
    return advice;
  }, [commit, reportProgress, run, runProjectAi]);

  const adoptExperimentAdvice = useCallback(async () => {
    const current = projectRef.current;
    const advice = current.experimentRun.aiAdvice;
    if (!advice?.actions.length || current.experimentRun.winnerId || current.experimentRun.pendingEvidenceCandidateId) throw new Error("当前没有可采纳的无候选优化建议");
    const block = `[本轮无 Winner 自动优化建议]\n${advice.overall}\n${advice.actions.map((action, index) => `${index + 1}. ${action.title}（${action.target}）：${action.detail}`).join("\n")}`;
    const evolutionCommand = current.evolutionCommand.includes(block) ? current.evolutionCommand : [current.evolutionCommand, block].filter(Boolean).join("\n\n");
    const next: EvolveProject = {
      ...current,
      evolutionCommand,
      commandHistory: current.evolutionCommand.includes(block) ? current.commandHistory : [
        ...current.commandHistory,
        { id: `cmd-no-winner-${Date.now()}`, role: "system" as const, content: "已一键采纳无 Winner 诊断，下一轮 Candidate 必须逐条回应这些动作，并保留本轮已通过的能力。", artifactIds: [], createdAt: now() },
      ],
    };
    commit(() => next);
    return generatePlan(next);
  }, [commit, generatePlan]);

  const executeExperiment = useCallback(async () => {
    const candidates = project.candidates.filter((candidate) => project.selectedCandidateIds.includes(candidate.id));
    if (candidates.length === 0) throw new Error("至少选择一个 Candidate");
    const operationForPhase = (phase?: string): import("../ai/schemas").AiOperation => {
      if (/构造/.test(phase ?? "")) return "build-candidate";
      if (/预筛.*Judge|快速预筛/.test(phase ?? "")) return /Judge/.test(phase ?? "") ? "evaluate-population" : "execute-artifact-batch";
      if (/完整实验/.test(phase ?? "")) return project.experimentPolicy.batchArtifactRuntime ? "execute-artifact-batch" : "execute-artifact";
      return "evaluate";
    };
    try {
      const experiment = await run("运行 Candidate 实验", () => runExperiment(project, candidates, (done, total, phase) => reportProgress(`${phase ?? "运行 Candidate 实验"}`, done, total, phase, operationForPhase(phase))));
      applyExperiment(experiment);
      if (!experiment.winnerId && !experiment.pendingEvidenceCandidateId) {
        const aiAdvice = await generateExperimentAdvice(experiment);
        return { ...experiment, aiAdvice };
      }
      return experiment;
    } catch (error) {
      if (error instanceof CandidateArtifactBuildError) {
        const failed = new Map(error.candidates.map((candidate) => [candidate.id, candidate]));
        commit((current) => ({
          ...current,
          candidates: current.candidates.map((candidate) => {
            const build = failed.get(candidate.id);
            return build ? { ...candidate, artifactBuildStatus: "failed" as const, artifactBuildSummary: build.artifactBuildSummary } : candidate;
          }),
        }));
      }
      throw error;
    }
  }, [applyExperiment, commit, generateExperimentAdvice, project, reportProgress, run]);

  // 实验失败题补考：只重跑各候选执行失败的题并重排 Winner，成功作答不重复付费。
  const retryFailedExperiment = useCallback(async () => {
    const candidates = project.candidates.filter((candidate) => project.selectedCandidateIds.includes(candidate.id));
    if (candidates.length === 0) throw new Error("至少选择一个 Candidate");
    const experiment = await run("补考实验失败题", () => retryFailedExperimentCases(project, candidates, (done, total, phase) => reportProgress(`${phase ?? "补考实验失败题"}`, done, total, phase, "evaluate")));
    applyExperiment(experiment);
    if (!experiment.winnerId && !experiment.pendingEvidenceCandidateId) {
      const aiAdvice = await generateExperimentAdvice(experiment);
      return { ...experiment, aiAdvice };
    }
    return experiment;
  }, [applyExperiment, generateExperimentAdvice, project, reportProgress, run]);

  const winner = useMemo(() => {
    const candidateId = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
    return project.candidates.find((candidate) => candidate.id === candidateId);
  }, [project.candidates, project.experimentRun.pendingEvidenceCandidateId, project.experimentRun.winnerId]);

  // V2.1：Hidden Validation 之后必须对“被测试的同一 Candidate Artifact Snapshot”执行 Gate F。
  // 只有 Behavioral Holdout + Artifact Acceptance 都通过，Release Ready 才能解锁。
  const applyArtifactValidated = useCallback((args: { validation: Awaited<ReturnType<typeof runValidation>>; candidate: Candidate; acceptance: ArtifactAcceptance; rubric: EvolveProject["acceptanceRubric"] }) => {
    const { validation, candidate, acceptance, rubric } = args;
    commit((current) => {
      const accepted = deliveryReadiness({ ...current, acceptanceRubric: rubric, candidates: current.candidates.map((item) => item.id === candidate.id ? candidate : item), experimentRun: { ...current.experimentRun, winnerId: candidate.id }, validationRun: validation, artifactAcceptance: acceptance }).ready;
      const versionSnapshot: EvolvedVersion | undefined = accepted
        ? {
            id: `version-artifact-${Date.now()}`,
            label: `Artifact Ready · ${candidate.title || candidate.name}`,
            createdAt: now(),
            source: "validation",
            candidateTitle: candidate.title || candidate.name,
            recommendation: validation.recommendation,
            scores: validation.evaluation ? { accuracy: validation.evaluation.accuracy, completeness: validation.evaluation.completeness } : undefined,
            summary: `Gate F 通过：Acceptance ${acceptance.overallScore}/100；Coverage ${acceptance.coverageScore}；Integrity ${acceptance.integrityScore}；Pairwise ${acceptance.pairwiseScore}。`,
            artifacts: candidate.artifactSnapshots.map((artifact, index) => ({ id: `vart-artifact-${Date.now()}-${index}`, name: artifact.name, sourceArtifactId: artifact.sourceArtifactId, content: artifact.content, frozenArtifact: acceptance.frozenArtifacts?.find((item) => item.sourceArtifactId === artifact.sourceArtifactId) })),
          }
        : undefined;
      // 单轮流程同样结算 Champion：Hidden Validation 给出 release 建议且 Gate F 通过，
      // 就把「刚被测试的快照」登记为当前最佳版本；否则跑完一轮成果中心仍会认为没有成果。
      const championUpdate = accepted
        ? maybeUpdateSearchChampion({
          current: current.searchChampion,
          round: current.roundHistory.length + 1,
          winner: candidate,
          validation,
          artifactAcceptance: acceptance,
          baseline: current.campaign.rootBaseline ?? current.baselineRun.result,
          parentVersionId: current.searchChampion?.versionLabel ?? current.version,
          minImprovement: current.campaign.stopCriteria.minImprovement,
        })
        : { champion: current.searchChampion, changed: false, improvement: 0 };
      const settled: EvolveProject = {
        ...current,
        acceptanceRubric: rubric,
        artifactAcceptance: acceptance,
        experimentRun: accepted
          ? { ...current.experimentRun, winnerId: candidate.id, pendingEvidenceCandidateId: undefined }
          : current.experimentRun,
        searchChampion: championUpdate.champion,
        searchAppliedPatches: championUpdate.champion?.patches ?? current.searchAppliedPatches,
        validationRun: { ...validation, versionSnapshot: versionSnapshot ?? validation.versionSnapshot },
        candidates: current.candidates.map((item) => item.id === candidate.id ? candidate : item),
        adviceLedger: validation.settledAdvice ? [...current.adviceLedger, validation.settledAdvice].slice(-3) : current.adviceLedger,
        versions: versionSnapshot ? [...current.versions, versionSnapshot].slice(-12) : current.versions,
        currentVersionId: versionSnapshot ? versionSnapshot.id : current.currentVersionId,
        gates: current.gates.map((item) => {
          if (item.id === "artifact-ready") return { ...item, status: accepted ? "approved" as const : "blocked" as const, approvedAt: accepted ? now() : undefined, note: acceptance.summary };
          if (item.id === "release-ready") return { ...item, status: validation.recommendation === "release" && accepted ? "ready" as const : "blocked" as const, approvedAt: undefined, note: accepted ? "Hidden Validation + Gate F 已通过" : "Artifact Ready 未通过" };
          return item;
        }),
        stage: "validation",
      };
      // 成果包一次冻齐：主成果始终用真实通过验收的 Candidate 快照，manifest / scorecard / lineage
      // 等元数据按 Champion 补齐，与「准备发布最佳版本」和 Campaign 结算的包结构保持一致。
      const outputArtifacts = accepted
        ? [...acceptanceArtifacts(settled, candidate, acceptance), ...materializeChampionOutputs(settled).filter((artifact) => artifact.kind !== "primary").map((artifact) => ({ ...artifact, accepted: true }))]
        : current.outputArtifacts.filter((artifact) => !artifact.isChampion);
      return { ...settled, outputArtifacts };
    });
    setStage("validation");
  }, [commit]);

  const markValidationFailed = useCallback((candidateId: string, message: string) => {
    commit((current) => ({ ...current,
      validationRun: { ...current.validationRun, id: `validation-${Date.now()}`, status: "failed", candidateId, error: message, evaluation: undefined, checks: [], recommendation: undefined },
      artifactAcceptance: { ...current.artifactAcceptance, status: "unverified", candidateId, summary: `验证未能完成：${message}`, lastCheckedAt: now() },
      gates: current.gates.map((item) => item.id === "artifact-ready" || item.id === "release-ready" ? { ...item, status: "blocked", approvedAt: undefined, note: "Hidden Validation 未通过" } : item),
      stage: "validation",
    }));
    setStage("validation");
  }, [commit]);

  const executeValidation = useCallback(async () => {
    const current = projectRef.current;
    const currentCandidateId = current.experimentRun.winnerId ?? current.experimentRun.pendingEvidenceCandidateId;
    const currentWinner = current.candidates.find((candidate) => candidate.id === currentCandidateId);
    if (!currentWinner) {
      setStatus({ busy: false, error: "没有可验证的 Winner，请先完成新版比较并选出可验证版本" });
      return undefined;
    }
    try {
      const validation = await run("运行 Hidden Validation", () => runValidation(current, currentWinner, (done, total, phase) => reportProgress(`${phase ?? "运行 Hidden Validation"}`, done, total, phase, "evaluate")));
      const loopProject = projectRef.current;
      const loopCandidate = loopProject.candidates.find((candidate) => candidate.id === currentWinner.id) ?? currentWinner;
      const loop = await run(validation.recommendation === "release" ? "Gate F · Artifact Acceptance" : "失败项自动修复与复验", () => runArtifactAcceptanceLoop({
        project: loopProject,
        candidate: loopCandidate,
        validation,
        onProgress: (label) => setStatus((() => { const elapsedSeconds=Math.round((Date.now()-runStartedMsRef.current)/1000); return { busy:true,label,phase:label,elapsedSeconds,startedAt:new Date(runStartedMsRef.current).toISOString(), provider:resolveProjectOperationConnections("artifact-acceptance",projectRef.current.aiProfile)[0]?.connection.label, model:resolveProjectOperationConnections("artifact-acceptance",projectRef.current.aiProfile)[0]?.model }; })()),
      }));
      applyArtifactValidated(loop);
      return loop.validation;
    } catch (error) {
      markValidationFailed(currentWinner.id, error instanceof Error ? error.message : "验证/成果验收运行失败");
      return undefined;
    }
  }, [applyArtifactValidated, markValidationFailed, reportProgress, run, setStatus]);

  const retryFailedValidation = useCallback(async () => {
    if (!winner) throw new Error("没有可验证的 Winner");
    try {
      const validation = await run("补考失败题", () => runValidation(project, winner, (done, total, phase) => reportProgress(`${phase ?? "补考失败题"}`, done, total, phase, "evaluate"), { retryFailedOnly: true }));
      const loop = await run("补考后 Artifact Acceptance", () => runArtifactAcceptanceLoop({ project, candidate: winner, validation, onProgress: (label) => setStatus((() => { const elapsedSeconds=Math.round((Date.now()-runStartedMsRef.current)/1000); return { busy:true,label,phase:label,elapsedSeconds,startedAt:new Date(runStartedMsRef.current).toISOString(), provider:resolveProjectOperationConnections("artifact-acceptance",projectRef.current.aiProfile)[0]?.connection.label, model:resolveProjectOperationConnections("artifact-acceptance",projectRef.current.aiProfile)[0]?.model }; })()) }));
      applyArtifactValidated(loop);
      return loop.validation;
    } catch (error) {
      markValidationFailed(winner.id, error instanceof Error ? error.message : "补考/成果验收运行失败");
      return undefined;
    }
  }, [applyArtifactValidated, markValidationFailed, project, reportProgress, run, setStatus, winner]);

  // 版本回滚：把所选历史版本的成果物内容固化为新的进化对象；回滚前自动快照当前状态，保证随时能回去。
  // 回滚改变进化输入，旧评测/实验结论作废（resetDownstream），需重跑流程。
  const rollbackToVersion = useCallback(async (versionId: string) => {
    const current = projectRef.current;
    const version = current.versions.find((item) => item.id === versionId);
    if (!version) { setStatus({busy:false,error:"要恢复的版本不存在"}); return; }
    const result = await run("恢复历史成果文件", () => restoreVersionArtifacts(current,version));
    if (!result) return;
    const stampedAt = now();
    const preSnapshot: EvolvedVersion = {id:"version-pre-"+Date.now(),label:"回滚前原文件备份",createdAt:stampedAt,source:"rollback-snapshot",summary:"恢复前保存的原格式文件，可下载或恢复。",artifacts:result.backups};
    commit((state) => resetDownstream({...state,sourceArtifacts:result.sources,inputUnderstanding:undefined,inputClarifications:[],versions:[...state.versions,preSnapshot].slice(-12),currentVersionId:version.id,
      commandHistory:[...state.commandHistory,{id:"cmd-rollback-"+Date.now(),role:"system",content:"已恢复历史版本 "+version.label+" 的实际文件并重新解析；旧评测已失效，请重新确认目标。",artifactIds:[],createdAt:stampedAt}]}));
    setStage("target");
  }, [commit,run,setStatus]);

  const releaseAction = useCallback(async (action: "shadow" | "canary-5" | "canary-20" | "canary-50" | "promote" | "rollback") => {
    if (!winner) throw new Error("没有 Release Candidate");
    const result = await run(`发布动作：${action}`, () => runRelease(project, winner, action));
    const effectiveAction = result.action;
    const durableOnlineRelease=projectUsesVercelRelease(project)||projectUsesHttpRelease(project)||projectUsesConnectorRelease(project);
    commit((current) => {
      const base:EvolveProject=durableOnlineRelease
        ?applyReleaseResultToProject({
          project:current,
          candidate:winner,
          requestedAction:action,
          result,
          at:result.observedAt??now(),
        })
        :{
          ...current,
          version: effectiveAction === "promote" ? `V${Number(current.version.replace(/\D/g, "") || "12") + 1}` : current.version,
          appliedPatches: effectiveAction === "promote" ? [...current.appliedPatches, ...winner.patches] : current.appliedPatches,
          versions: effectiveAction === "promote" ? current.versions.map((version) => (version.id === current.currentVersionId ? { ...version, releasedAt: now() } : version)) : current.versions,
          release: {
            ...current.release,
            status: effectiveAction === "shadow" ? "shadow" : effectiveAction === "canary-5" ? "canary-5" : effectiveAction === "canary-20" ? "canary-20" : effectiveAction === "canary-50" ? "canary-50" : effectiveAction === "promote" ? "promoted" : "rolled-back",
            candidateId: winner.id,trafficPercent: result.trafficPercent,healthy: result.healthy,observationStatus: result.observationStatus,
            kpis: result.kpis,evidenceMode: result.evidenceMode,deploymentId: result.deploymentId,stableDeploymentId: result.stableDeploymentId,
            artifactHash: result.artifactHash,artifactHashes: result.artifactHashes,environment: result.environment,observedAt: result.observedAt ?? now(),
            sampleSize: result.sampleSize,windowMinutes: result.windowMinutes,
            history: [...current.release.history, { at: now(), action: effectiveAction, note: action === effectiveAction ? result.note : `${action} → ${effectiveAction}：${result.note}` }],
          },
          stage: effectiveAction === "promote" || effectiveAction === "rollback" ? "learning" as const : "release" as const,
        };
      const settled:EvolveProject={
        ...base,
        campaign:(current.campaign.stopReason??"").includes("[server-release-")
          ?{...base.campaign,status:"idle" as const,stopReason:undefined}
          :base.campaign,
      };
      const governedAt=result.observedAt??now();
      return applyProductionLearningGovernance(settled,{at:governedAt,now:Date.parse(governedAt)});
    });
    const terminal=durableOnlineRelease
      ?result.ok&&result.healthy===true&&result.observationStatus==="healthy"&&(effectiveAction==="promote"||effectiveAction==="rollback")
      :effectiveAction==="promote"||effectiveAction==="rollback";
    setStage(terminal?"learning":"release");
    if(result.outcomeTelemetry?.status==="failed"){
      setStatus({busy:false,message:"发布已结算；Outcome 样本未保存，请执行线上核对以重试采集"});
    }
    return result;
  }, [commit, project, run, setStatus, winner]);

  const reconcileRelease = useCallback(async () => {
    const missionId=projectRef.current.id;
    const response=await run("核对线上 Release 状态",()=>reconcileServerRelease(missionId));
    const persisted=await getProductionRuntime().missions.get(missionId).catch(()=>undefined);
    if(persisted){
      commit(persisted);
      setStage(persisted.stage);
    }
    const telemetryNote=response.outcomeTelemetry?.status==="failed"
      ?"；Outcome 样本未保存，请重试线上核对"
      :response.outcomeTelemetry?.warningCount
        ?`；Outcome 采集有 ${response.outcomeTelemetry.warningCount} 项警告`
        :"";
    setStatus({busy:false,message:response.reason+telemetryNote});
    pushActivity(`Release Reconcile · ${response.disposition} · ${response.reason}${telemetryNote}`,undefined,projectId);
    return response;
  },[commit,projectId,run,setStatus]);

  const distill = useCallback(async () => {
    const current = projectRef.current;
    const winnerId = current.experimentRun.winnerId ?? current.searchChampion?.candidate?.id;
    const currentWinner = current.candidates.find((candidate) => candidate.id === winnerId) ?? current.searchChampion?.candidate;
    if (!currentWinner) throw new Error("没有已验证 Winner");
    const hasLiveDecision = projectHasLiveReleaseDecision(current);
    const releaseFreshness = productionOutcomeFreshness(current);
    const releaseTrend = productionOutcomeTrend(current);
    const hasStableLiveOutcome = hasLiveDecision && current.release.status === "promoted" && projectHasStableHealthyProductionOutcome(current);
    const hasOfflineAcceptance = !projectHasOnlineReleaseTarget(current)
      && current.artifactAcceptance.status === "passed"
      && current.artifactAcceptance.candidateId === currentWinner.id;
    if (!hasLiveDecision && !hasOfflineAcceptance) throw new Error("请先完成成果验收；线上能力还需要真实发布平台给出 Promote / Rollback 证据");
    const parsed = DistillAiResultSchema.parse(await run("AI 提炼经验", async () => {
      reportProgress("正在提炼本轮可复用经验", 0, 1, "经验提炼", "distill");
      const output = await runProjectAi("distill", {
        project: { goal: current.goal, baseline: current.baselineRun.result, ...sourceEvidence(current, "提炼真正有效的改动机制、线上证据和适用边界") },
        winner: currentWinner,
        validation: current.validationRun,
        release: current.release,
        releaseFreshness,
        releaseTrend,
      }, (notice) => reportProgress(`模型切换：${notice.model} · ${notice.message.slice(0, 100)}`, 0, 1, "经验提炼", "distill", notice));
      reportProgress("本轮经验已提炼", 1, 1, "经验提炼", "distill");
      return output;
    }));
    const result = !hasStableLiveOutcome && parsed.status === "verified-skill"
      ? { ...parsed, status: "lesson" as const, validatedOn: [...parsed.validatedOn, hasLiveDecision
        ? `Production Outcome 尚未达到稳定线上证据门槛：${releaseTrend.reason}`
        : "离线成果验收（尚无线上生产证据）"] }
      : parsed;
    const governedAt=now();
    const integrated=integrateDistilledLesson(current,{ id: `lesson-${Date.now()}`, ...result },{at:governedAt});
    commit((state) => applyProductionLearningGovernance(
      {...state,lessons:integrated.lessons,stage:"learning"},
      {at:governedAt,now:Date.parse(governedAt)},
    ));
    setStage("learning");
    return integrated.lesson;
  }, [commit, reportProgress, run, runProjectAi]);

  const generateNextQueue = useCallback(async () => {
    const current = projectRef.current;
    if (current.lessons.length === 0) throw new Error("请先提炼本轮 Lesson / Anti-pattern");
    const result = NextQueueAiResultSchema.parse(await run("AI 生成下一轮建议", async () => {
      reportProgress("正在根据剩余问题与本轮经验生成下一轮建议", 0, 1, "下一轮建议", "next-queue");
      // Next Queue 是课程规划，不需要再次搬运完整成果正文。只提供已经结算的目标、问题、
      // Lesson、验证摘要和发布状态，避免小上下文模型因重复源码/文档证据触发 token limit。
      const output = await runProjectAi("next-queue", {
        project: {
          goal: current.goal,
          desiredOutcome: current.desiredOutcome,
          problems: current.problems.slice(0, 12).map((item) => ({ id: item.id, title: item.title, impact: item.impact, severity: item.severity, status: item.status, summary: item.summary })),
          lessons: current.lessons.slice(0, 8),
          validation: { recommendation: current.validationRun.recommendation, summary: current.validationRun.summary, failedChecks: current.validationRun.checks.filter((item) => item.status === "fail").slice(0, 8) },
          artifactAcceptance: { status: current.artifactAcceptance.status, score: current.artifactAcceptance.overallScore, summary: current.artifactAcceptance.summary },
          release: { status: current.release.status, evidenceMode: current.release.evidenceMode, healthy: current.release.healthy, kpis: current.release.kpis.slice(0, 8) },
          lastGapAdvice: current.campaign.lastGapAdvice,
        },
      }, (notice) => reportProgress(`模型切换：${notice.model} · ${notice.message.slice(0, 100)}`, 0, 1, "下一轮建议", "next-queue", notice));
      reportProgress("下一轮建议已生成", 1, 1, "下一轮建议", "next-queue");
      return output;
    }));
    commit((state) => ({ ...state, nextQueue: mergeGovernedNextQueue(state.nextQueue,result.items), stage: "learning" }));
    return result;
  }, [commit, reportProgress, run, runProjectAi]);

  // 深度输入理解：intake 之后在后台再完整读一遍材料，复述意图 / 挖隐含要求 / 把歧义变成可回答的确认题。
  // background=true 时不占用运行状态（界面不进入 busy），结果落盘后界面自行刷新。
  const deepenUnderstanding = useCallback(async (options?: { background?: boolean }) => {
    const execute = async () => {
      const current = projectRef.current;
      if (!current.sourceArtifacts.length) throw new Error("请先接入进化材料，再做深度理解");
      commit((state) => ({
        ...state,
        inputUnderstanding: {
          status: "running" as const,
          error: undefined,
          intentRestatement: state.inputUnderstanding?.intentRestatement ?? "",
          implicitRequirements: state.inputUnderstanding?.implicitRequirements ?? [],
          assumptions: state.inputUnderstanding?.assumptions ?? [],
          clarifications: state.inputUnderstanding?.clarifications ?? [],
          acceptanceFocus: state.inputUnderstanding?.acceptanceFocus ?? [],
          confidence: state.inputUnderstanding?.confidence ?? 0,
        },
      }));
      try {
        const result = UnderstandAiResultSchema.parse(await runProjectAi("understand", {
          project: { ...sourceEvidence(current, "深度理解用户输入：复述真实意图、挖掘隐含要求、给出需要用户确认的歧义与默认假设"), goal: current.goal },
          answered: current.inputClarifications,
        }));
        commit((state) => ({ ...state, inputUnderstanding: { ...result, status: "ready" as const, updatedAt: now() } }));
        return result;
      } catch (error) {
        commit((state) => ({
          ...state,
          inputUnderstanding: {
            status: "failed" as const,
            error: error instanceof Error ? error.message : "理解失败",
            intentRestatement: state.inputUnderstanding?.intentRestatement ?? "",
            implicitRequirements: state.inputUnderstanding?.implicitRequirements ?? [],
            assumptions: state.inputUnderstanding?.assumptions ?? [],
            clarifications: state.inputUnderstanding?.clarifications ?? [],
            acceptanceFocus: state.inputUnderstanding?.acceptanceFocus ?? [],
            confidence: state.inputUnderstanding?.confidence ?? 0,
          },
        }));
        throw error;
      }
    };
    if (options?.background) {
      void execute().catch(() => undefined);
      return undefined;
    }
    return run("AI 深度理解输入", execute);
  }, [commit, run, runProjectAi]);

  // 回答一条「待确认歧义」：用户亲答或自动驾驶采用默认假设都记入项目口径，
  // 并写一条系统命令记录，让后续验收 / 出题 / 方案都按同一口径执行。
  const answerClarification = useCallback((question: string, answer: string, answeredBy: "user" | "ai-assumption" = "user") => {
    const trimmed = answer.trim();
    if (!trimmed) throw new Error("请先填写回答再提交");
    commit((current) => ({
      ...resetDownstream(current),
      inputClarifications: [...current.inputClarifications.filter((item) => item.question !== question), { question, answer: trimmed, answeredBy, at: now() }],
      commandHistory: [
        ...current.commandHistory,
        { id: `cmd-clarify-${Date.now()}`, role: "system" as const, content: `输入确认${answeredBy === "user" ? "" : "（AI 默认假设）"}：「${question}」→「${trimmed}」。后续验收标准与进化方案均按此口径执行。`, artifactIds: [], createdAt: now() },
      ],
    }));
  }, [commit]);

  const startNextRound = useCallback((queueId?: string) => {
    if (["shadow", "canary-5", "canary-20", "canary-50"].includes(project.release.status)) throw new Error("当前版本仍在灰度验证中。请先 Promote 或 Rollback，再开始下一轮。");
    const selected = project.nextQueue.find((item) => item.id === queueId) ?? project.nextQueue[0];
    if (!selected) throw new Error("请先生成下一轮 Evolve Queue");
    commit((current) => ({
      ...current,
      stage: "baseline",
      problemStatement: `${selected.title}：${selected.reason}`,
      selectedProblemId: undefined,
      diagnosis: undefined,
      candidates: [],
      selectedCandidateIds: [],
      baselineRun: { id: `baseline-${Date.now()}`, status: "idle", suiteName: "Core Validation Suite", totalCases: 0, runs: [] },
      experimentRun: { id: `experiment-${Date.now()}`, status: "idle", candidateResults: [] },
      validationRun: { id: `validation-${Date.now()}`, status: "idle", checks: [], runs: [], baselineRuns: [] },
      // Production truth belongs to the project, not to a single optimization round.
      // Keep the deployment state/history so the next round still knows which version is serving traffic.
      release: current.release,
      campaign: { ...current.campaign, lastGapAdvice: undefined },
      gates: current.gates.map((gate) => gate.id === "target-ready" ? gate : { ...gate, status: "pending", approvedAt: undefined, note: undefined }),
      problems: [],
      nextQueue: current.nextQueue,
    }));
    setStage("baseline");
  }, [commit, project.nextQueue, project.release.status]);


  const updateCampaign = useCallback((nextCampaign: EvolveProject["campaign"]) => {
    commit((current) => ({ ...current, campaign: nextCampaign }));
  }, [commit]);

  const updateAiProfile = useCallback((aiProfile: EvolveProject["aiProfile"]) => {
    commit((current) => ({ ...current, aiProfile }));
    setStatus({ busy: false, message: "AI 模型路由已更新；下一次节点执行将使用新选择。" });
    pushActivity("当前项目 AI 模型路由已更新 · 旧运行错误已清除，等待按新路由重试", undefined, projectId);
  }, [commit, projectId, setStatus]);

  // 证据连接：把项目切到/切出真实 Target Runner（HTTP Target Gateway）。
  const setTargetConnection = useCallback((nextConnection: EvolveProject["targetConnection"]) => {
    commit((current) => ({ ...current, targetConnection: nextConnection }));
  }, [commit]);

  const setReleaseTarget = useCallback((releaseTarget: NonNullable<EvolveProject["releaseTarget"]>) => {
    commit((current) => transitionReleaseTarget(current,releaseTarget));
  }, [commit]);

  const bindReleaseDeployment = useCallback((deploymentId: string) => {
    const current = projectRef.current;
    const currentWinnerId = current.experimentRun.winnerId ?? current.searchChampion?.candidate?.id;
    if (!currentWinnerId) throw new Error("没有可绑定 Preview Deployment 的 Release Candidate");
    if (current.release.status !== "idle") throw new Error("Release 已经开始，不能中途更换 Candidate Deployment");
    commit((state) => ({
      ...state,
      release: {
        ...state.release,
        candidateId: currentWinnerId,
        deploymentId,
      },
    }));
  }, [commit]);

  const materializeOutputs = useCallback(async () => {
    const current = projectRef.current;
    const champion = current.searchChampion;
    if (!champion?.candidate) throw new Error("还没有 Search Champion，无法生成进化成果物");
    if (champion.artifactAcceptance?.status !== "passed") throw new Error("Search Champion 尚未通过 Gate F · Artifact Ready，禁止生成正式成果包");
    if (!champion.candidate.artifactSnapshots.length) throw new Error("Search Champion 缺少已测试的 Candidate Artifact Snapshot");
    // V2.1: 不再在这里重新生成另一份内容。直接交付被 Hidden Validation + Gate F 测试过的同一快照。
    const primaryAndAcceptance = acceptanceArtifacts(current, champion.candidate, champion.artifactAcceptance);
    const metadata = materializeChampionOutputs(current).filter((artifact) => artifact.kind !== "primary").map((artifact) => ({ ...artifact, accepted: true }));
    const artifacts = [...primaryAndAcceptance, ...metadata];
    commit((state) => ({ ...state, outputArtifacts: artifacts, artifactAcceptance: champion.artifactAcceptance! }));
    return artifacts;
  }, [commit]);

  const pauseCampaign = useCallback(() => {
    // 打断式暂停：先中止在途 AI 请求（立即生效，不等当前一步跑完），
    // 轮内进度已随各阶段断点落盘，之后点「继续」从断点接着跑。
    abortRunScope(projectId);
    commit((current) => ({ ...current, campaign: { ...current.campaign, status: "paused", startedAt: undefined, stopReason: "用户暂停（断点已保存，可继续）", schedule: { ...current.campaign.schedule, enabled: false, nextRunAt: undefined } } }));
  }, [commit, projectId]);

  const requestValidation = useCallback(async () => {
    const current = projectRef.current;
    const currentCandidateId = current.experimentRun.winnerId ?? current.experimentRun.pendingEvidenceCandidateId;
    const currentWinner = current.candidates.find((candidate) => candidate.id === currentCandidateId);
    if (!currentWinner) {
      setStatus({ busy: false, error: "当前没有可重新验收的 Winner，请先完成新版比较" });
      return undefined;
    }
    const activeTask = getRunTask(projectId);
    if (status.busy && activeTask?.kind === "action" && (activeTask.actionId === "validation" || activeTask.actionId === "validation-retry")) {
      setStatus({ ...status, message: "当前验收已经在执行，无需重复点击；完成后页面会自动更新结果。" });
      return undefined;
    }
    const disposition = validationRequestDisposition(status, current.campaign.status);
    if (disposition === "run-now") return executeValidation();
    if (disposition === "already-running") {
      setStatus({ ...status, message: "当前验收已经在执行，无需重复点击；完成后页面会自动更新结果。" });
      return undefined;
    }
    setValidationRequestQueued(true);
    if (disposition === "pause-campaign-and-queue") {
      pushActivity("用户请求重新验收 · 已安全暂停自动进化，等待当前步骤收尾后自动执行", undefined, projectId);
      abortRunScope(projectId);
      commit((state) => ({ ...state, campaign: { ...state.campaign, status: "paused", startedAt: undefined, stopReason: "用户请求重新验收（断点已保存）", schedule: { ...state.campaign.schedule, enabled: false, nextRunAt: undefined } } }));
    } else {
      pushActivity(`重新验收已排队 · 等待「${status.label ?? status.phase ?? "当前任务"}」完成`, undefined, projectId);
      setStatus({ ...status, message: "重新验收已排队；当前任务完成后会自动执行。" });
    }
    return undefined;
  }, [commit, executeValidation, projectId, setStatus, status]);

  useEffect(() => {
    if (!validationRequestQueued || status.busy) return;
    setValidationRequestQueued(false);
    const timer = window.setTimeout(() => {
      pushActivity("开始执行已排队的重新验收", undefined, projectId);
      void executeValidation();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [executeValidation, projectId, status.busy, validationRequestQueued]);

  const scheduleCampaign = useCallback((enabled = true) => {
    const current = projectRef.current;
    if (!enabled) {
      commit((state) => ({
        ...state,
        campaign: {
          ...state.campaign,
          // 取消定时只取消计划，不能把 paused/completed/running 等真实执行状态抹成 idle。
          status: state.campaign.status === "scheduled" ? "idle" : state.campaign.status,
          schedule: { ...state.campaign.schedule, enabled: false, nextRunAt: undefined, durableJobId: undefined, durableRunId: undefined, durableScheduledFor: undefined },
        },
      }));
      // 取消计划不能篡改正在执行节点的 busy 状态；只记录控制面动作。
      if (productionRuntimeMode() !== "local") void flushProductionMissionSync().catch((error) => {
        console.error("Durable schedule cancellation sync failed", error);
      });
      pushActivity("定时计划已取消 · 当前 Campaign 执行状态保持不变", undefined, projectId);
      return true;
    }
    if (status.busy || current.campaign.status === "running") {
      setStatus({ busy: false, error: "当前 Campaign 正在运行，不能同时启用新的定时计划。请先等待本轮完成或暂停。" });
      return false;
    }
    if (current.campaign.status === "paused") {
      setStatus({ busy: false, error: "当前 Campaign 处于暂停状态，请先从断点恢复或重置搜索，再启用定时。" });
      return false;
    }
    if (current.campaign.status === "completed" || current.campaign.status === "stopped") {
      setStatus({ busy: false, error: "当前 Campaign 已结束；如需再次定时运行，请先重置搜索或开始新的进化任务。" });
      return false;
    }
    const schedule = {
      ...current.campaign.schedule,
      enabled: true,
      timezone: current.campaign.schedule.timezone === "local"
        ? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
        : current.campaign.schedule.timezone,
      durableJobId: undefined,
      durableRunId: undefined,
      durableScheduledFor: undefined,
      daysOfWeek: current.campaign.schedule.mode === "weekly" && current.campaign.schedule.daysOfWeek.length === 0 ? [1] : current.campaign.schedule.daysOfWeek,
    };
    const issue = campaignScheduleIssue(schedule);
    if (issue) {
      setStatus({ busy: false, error: issue });
      return false;
    }
    const nextRunAt = nextScheduledAt(schedule);
    if (!nextRunAt) {
      setStatus({ busy: false, error: "无法计算下一次执行时间，定时任务未启用。" });
      return false;
    }
    commit((state) => ({ ...state, campaign: { ...state.campaign, status: "scheduled", stopReason: undefined, schedule: { ...schedule, nextRunAt } } }));
    setStatus({ busy: false, message: `定时计划已启用：${new Date(nextRunAt).toLocaleString()}` });
    if (productionRuntimeMode() !== "local") {
      void (async () => {
        try {
          await flushProductionMissionSync();
          const armed = await startServerEvolutionWorkflow(projectId, { scheduledFor: nextRunAt });
          const latest = projectRef.current;
          if (!latest.campaign.schedule.enabled || latest.campaign.schedule.nextRunAt !== nextRunAt) return;
          commit((state) => state.campaign.schedule.nextRunAt !== nextRunAt ? state : ({
            ...state,
            campaign: {
              ...state.campaign,
              schedule: {
                ...state.campaign.schedule,
                durableJobId: armed.controlJobId,
                durableRunId: armed.runId,
                durableScheduledFor: nextRunAt,
              },
            },
          }));
          pushActivity(`Durable Scheduler 已接管：${new Date(nextRunAt).toLocaleString()}`, undefined, projectId);
        } catch (error) {
          pushActivity(`Durable Scheduler 未能武装，保留浏览器定时兜底：${error instanceof Error ? error.message : String(error)}`, undefined, projectId);
        }
      })();
    }
    return true;
  }, [commit, projectId, setStatus, status.busy]);

  const runCampaignRound = useCallback(async () => {
    return run("运行一轮 Evolution Search", async () => {
      let working = projectRef.current;
      const settleBeforeRound = (reason: string, forcePause = false) => {
        const satisfied = !forcePause && campaignGoalSatisfied(working);
        const settled: EvolveProject = {
          ...working,
          campaign: {
            ...working.campaign,
            status: satisfied ? "completed" : "paused",
            completedAt: satisfied ? now() : undefined,
            stopReason: reason,
            schedule: { ...working.campaign.schedule, enabled: false, nextRunAt: undefined },
          },
        };
        commit(settled);
        working = projectRef.current;
        pushActivity(`${satisfied ? "Campaign 已满足停止条件" : "Campaign 启动前触发安全边界"}：${reason}`, undefined, projectId);
        return { round: working.campaign.currentRound, stopped: true, paused: !satisfied, stopReason: reason, champion: working.searchChampion };
      };
      const scoringInputBlocker = campaignScoringInputBlocker(working);
      if (scoringInputBlocker) return settleBeforeRound(scoringInputBlocker, true);
      const scoringRouteBlocker = campaignScoringRouteBlocker(working);
      if (scoringRouteBlocker) return settleBeforeRound(scoringRouteBlocker, true);
      const existingBoundary = campaignStopReason(working);
      if (existingBoundary) return settleBeforeRound(existingBoundary);
      const initialSuiteCoverage = rubricSuiteCoverage(working.acceptanceRubric, working.evalSuite, working.hiddenEvalSuite);
      if (!initialSuiteCoverage.ready) {
        pushActivity("Campaign 检测到 Eval Suite 已落后于最新验收标准 · 自动补齐后再继续", undefined, projectId);
        await generateEvalSuite();
        working = projectRef.current;
      }
      const preflightBoundary = campaignPreflightStopReason(working);
      if (preflightBoundary) return settleBeforeRound(preflightBoundary);
      const targetGate = working.gates.find((gate) => gate.id === "target-ready");

      if (targetGate?.status !== "approved") throw new Error("请先确认 Target Ready，再启动多轮进化");
      if (working.evalSuite.length === 0) throw new Error("请先生成 Eval Suite");
      const round = working.campaign.currentRound + 1;
      if (round > working.campaign.stopCriteria.maxRounds) throw new Error("已达到最大进化轮数");
      const startedAt = now();
      // First repair round after a miss stays on the same accepted baseline. Reuse the evidence-backed
      // problem/root cause once and spend the model budget on a different mutation instead of paying
      // for identical problem-analysis + diagnosis again. A second miss reaches the default patience
      // boundary and therefore does not silently keep a stale diagnosis forever.
      const reusePriorDiagnosis = canReusePriorDiagnosis(working);
      // 轮内断点续跑：同一轮上次被打断（暂停键 / 页面刷新）时，已完成阶段直接复用落盘数据，
      // 从下一步接着跑——昂贵的基线、诊断、候选生成、沙箱实验都不会白做第二遍。
      const resumeFrom = working.campaign.checkpoint?.round === round ? working.campaign.checkpoint.completedPhase : undefined;
      const checkpointIncludesBaseline = resumeFrom !== undefined && CHECKPOINT_PHASES.indexOf(resumeFrom) >= CHECKPOINT_PHASES.indexOf("baseline");
      const baselineCheckpointReusable = checkpointIncludesBaseline && canReuseVisibleBaseline(working, working.baselineRun);
      const resumed = (phase: CampaignCheckpointPhase) => resumeFrom !== undefined
        && CHECKPOINT_PHASES.indexOf(resumeFrom) >= CHECKPOINT_PHASES.indexOf(phase)
        && (!checkpointIncludesBaseline || baselineCheckpointReusable);
      pushActivity(resumeFrom
        ? baselineCheckpointReusable
          ? `Round ${round} 从断点继续 · 「${CHECKPOINT_PHASE_LABELS[resumeFrom]}」已完成，接着往下跑`
          : `Round ${round} 原 Baseline 证据不足，重新测量当前版本后继续`
        : `Round ${round} 开始 · 运行 Baseline 体检`, undefined, projectId);
      // 阶段计时：每条「完成」日志带刚结束阶段的耗时，编排页据此统计时间花在哪些阶段。
      let phaseAt = Date.now();
      const phaseDone = (label: string) => {
        const ms = Date.now() - phaseAt;
        phaseAt = Date.now();
        pushActivity(label, ms, projectId);
      };
      const parentVersionId = working.searchChampion?.versionLabel ?? working.version;
      const persist = (next: EvolveProject) => {
        const stamped = { ...next, updatedAt: now() };
        projectRef.current = stamped;
        setProjectState(stamped);
        saveLocalProject(stamped);
        working = stamped;
        return stamped;
      };
      // 断点落盘：每个阶段跑完立刻记一次「本轮已完成到哪个阶段」，暂停/刷新后据此续跑。
      const checkpointAt = (phase: CampaignCheckpointPhase) => {
        working = persist({ ...working, campaign: { ...working.campaign, checkpoint: { round, completedPhase: phase, at: now() } } });
      };

      working = persist({
        ...working,
        searchAppliedPatches: working.searchChampion?.patches ?? working.searchAppliedPatches,
        campaign: {
          ...working.campaign,
          status: "running",
          startedAt: working.campaign.startedAt ?? startedAt,
          completedAt: undefined,
          stopReason: undefined,
        },
      });

      let baseline: typeof working.baselineRun;
      if (baselineCheckpointReusable) {
        // 断点续跑：本轮 Baseline 已落盘，直接复用，不重跑整卷。
        baseline = working.baselineRun;
      } else {
        // Baseline 跨轮复用：指纹不变（考卷 / 进化对象 / 执行配置 / 已上线补丁都相同）时，
        // 当前版本的成绩与上一轮必然一致，直接复用整轮执行 + 评审，省掉一轮里最贵的一步。
        const fingerprint = baselineFingerprint(working);
        const cached = getVisibleBaseline(projectId, fingerprint);
        const retryIncompleteBaseline = checkpointIncludesBaseline && !baselineCheckpointReusable;
        const cachedBaseline = cached && canReuseVisibleBaseline(working, cached) ? cached : undefined;
        baseline = cachedBaseline
          ? { ...cachedBaseline, id: `baseline-r${round}-reuse` }
          : await runBaseline(working, undefined, retryIncompleteBaseline ? { retryIncompleteOnly: true } : undefined);
        if (cachedBaseline) pushActivity(`Round ${round} 复用上一轮 Baseline（输入与考卷未变化，省一次整卷重跑）`, undefined, projectId);
        else if (canReuseVisibleBaseline(working, baseline)) setVisibleBaseline(projectId, fingerprint, baseline);
        working = persist({
          ...working,
          baselineRun: baseline,
          campaign: { ...working.campaign, rootBaseline: campaignRootBaselineForMeasurement(working, baseline.result, baselineScoringRouteFingerprint(working), retryIncompleteBaseline || !cachedBaseline), scoringRouteFingerprint: working.campaign.currentRound === 0 ? baselineScoringRouteFingerprint(working) : working.campaign.scoringRouteFingerprint, scoringInputFingerprint: working.campaign.currentRound === 0 ? campaignScoringInputFingerprint(working) : working.campaign.scoringInputFingerprint },
          stage: "baseline",
          problems: reusePriorDiagnosis ? working.problems : [],
          selectedProblemId: reusePriorDiagnosis ? working.selectedProblemId : undefined,
          diagnosis: reusePriorDiagnosis ? working.diagnosis : undefined,
          candidates: [], selectedCandidateIds: [],
          experimentRun: { id: `experiment-r${round}-${Date.now()}`, status: "idle", candidateResults: [] },
          validationRun: { id: `validation-r${round}-${Date.now()}`, status: "idle", checks: [], runs: [], baselineRuns: [] },
          gates: working.gates.map((gate) => gate.id === "target-ready" ? gate : { ...gate, status: "pending", approvedAt: undefined, note: undefined }),
        });
        checkpointAt("baseline");
      }

      if (working.campaign.currentRound === 0 && (!working.campaign.scoringRouteFingerprint || !working.campaign.scoringInputFingerprint)) {
        working = persist({ ...working, campaign: { ...working.campaign, scoringRouteFingerprint: baselineScoringRouteFingerprint(working), scoringInputFingerprint: campaignScoringInputFingerprint(working) } });
      }
      const campaignBaseline = baselineReadiness(working);
      if (!campaignBaseline.ready) {
        const reason = `当前版本基线不足以进入自动诊断：${campaignBaseline.blockers.join("；")}`;
        working = persist({ ...working, campaign: { ...working.campaign, status: "paused", stopReason: reason } });
        pushActivity(`Round ${round} 暂停：${reason}`, undefined, projectId);
        setStage("baseline");
        return { round, stopped: true, paused: true, stopReason: reason, champion: working.searchChampion };
      }

      let selectedProblem: (typeof working.problems)[number] | undefined;
      if (resumed("problem") && working.problems.length) {
        // 断点续跑：问题分析结果已落盘，直接取回选中问题。
        selectedProblem = working.problems.find((item) => item.id === working.selectedProblemId);
        phaseDone(`Round ${round} 断点续跑 · 复用已完成的问题分析`);
      } else if (reusePriorDiagnosis && working.problems.length) {
        selectedProblem = working.problems.find((item) => item.id === working.selectedProblemId);
        phaseDone(`Round ${round} 修复轮 · 复用上一轮已证实问题，不重复做问题发现`);
      } else {
        const rubricProblem = baselineRubricProblem(working);
        if (rubricProblem) {
          working = persist({ ...working, problems: [rubricProblem], selectedProblemId: rubricProblem.id, stage: "problem" });
          checkpointAt("problem");
          selectedProblem = rubricProblem;
          phaseDone(`Round ${round} Baseline 已有明确 Rubric 失败 · 直接锁定问题，跳过泛化问题分析`);
        } else {
          phaseDone(`Round ${round} Baseline 完成 · 开始 AI 问题分析`);
          const problemResult = ProblemAnalysisAiResultSchema.parse(await runProjectAi("problem-analysis", compactProblemAnalysisInput({
            project: { goal: working.goal, metrics: working.metrics, protectedItems: working.protectedItems, editableItems: working.editableItems, ...sourceEvidence(working, "Campaign 本轮问题发现：读取当前最佳版本的真实成果、基线失败和用户目标证据") },
            baseline: working.baselineRun,
            previousRounds: working.roundHistory.slice(-8),
            archive: working.evolutionArchive.slice(-24),
          })));
          const groundedProblems = problemResult.problems.map((problem) => ({ ...problem, evidenceRefs: resolveEvidenceRefs(projectAtSearchChampion(working), problem.evidence) }));
          const recommendedId = prioritizeProblems(groundedProblems)[0]?.problem.id ?? (groundedProblems.some((item) => item.id === problemResult.recommendedProblemId)
            ? problemResult.recommendedProblemId
            : groundedProblems[0]?.id);
          working = persist({ ...working, problems: groundedProblems, selectedProblemId: recommendedId, stage: "problem" });
          checkpointAt("problem");
          selectedProblem = working.problems.find((item) => item.id === working.selectedProblemId);
        }
      }
      if (!selectedProblem) throw new Error("AI 未能选择本轮目标问题");

      let diagnosis: NonNullable<typeof working.diagnosis>;
      if ((resumed("diagnose") || reusePriorDiagnosis) && working.diagnosis) {
        // 断点续跑 / 第一修复轮：根因仍绑定同一基线与同一问题，直接复用。
        diagnosis = working.diagnosis;
        phaseDone(reusePriorDiagnosis && !resumed("diagnose")
          ? `Round ${round} 修复轮 · 复用上一轮根因，把预算留给新的 Candidate`
          : `Round ${round} 断点续跑 · 复用已完成的根因诊断`);
        if (reusePriorDiagnosis && !resumed("diagnose")) checkpointAt("diagnose");
      } else {
        phaseDone(`Round ${round} 问题分析完成 · 开始 AI 根因诊断`);
        const diagnosisResult = DiagnosisAiResultSchema.parse(await runProjectAi("diagnose", {
          project: { goal: working.goal, metrics: working.metrics, protectedItems: working.protectedItems, editableItems: working.editableItems, ...sourceEvidence(working, `Campaign 根因诊断：围绕 ${selectedProblem.title} 读取相关成果、依赖和 Trace`) },
          problem: selectedProblem,
          baseline: working.baselineRun,
          previousRounds: working.roundHistory.slice(-8),
        }));
        diagnosis = { ...diagnosisResult, evidenceRefs: resolveEvidenceRefs(projectAtSearchChampion(working), diagnosisResult.evidence) };
        working = persist({ ...working, diagnosis, stage: "diagnosis" });
        checkpointAt("diagnose");
        if (diagnosis.confidence < 0.55 || diagnosis.evidence.length === 0 || (diagnosis.evidenceRefs.length > 0 && !diagnosis.evidenceRefs.some((ref) => ref.verified))) {
          const reason = "根因证据不足或无法定位：需要补充来源、Trace / Eval 或人工复核后再继续";
          working = persist({ ...working, campaign: { ...working.campaign, status: "paused", stopReason: reason } });
          pushActivity(`Round ${round} 暂停：${reason}`, undefined, projectId);
          setStage("diagnosis");
          return { round, stopped: true, paused: true, stopReason: reason, champion: working.searchChampion };
        }
      }

      let candidates: typeof working.candidates;
      if (resumed("plan") && working.candidates.length) {
        // 断点续跑：候选种群已落盘，直接复用。
        candidates = working.candidates;
        phaseDone(`Round ${round} 断点续跑 · 复用已生成的 ${candidates.length} 个候选方案`);
      } else {
        phaseDone(`Round ${round} 根因诊断完成 · 生成候选方案`);
        const parentPool = selectParentPool(working);
        // 搜索记忆：把「反复无效的改动家族 / 有效的改动家族 / 反复出现的差距」压缩后注入生成器，
        // 变异不再无记忆地重复踩同一批 dead-end（反思式进化的核心回路）。
        const searchMemory = buildSearchMemory(working);
        const planParsed = PlanAiResultSchema.parse(await runProjectAi("plan", buildFocusedPlanPayload({ ...working, diagnosis }, {
          diagnosis,
          existingLessons: working.lessons,
          searchChampion: working.searchChampion,
          archive: working.evolutionArchive.slice(-32),
          parentPool,
          searchMemory,
          campaign: working.campaign,
          candidateCount: working.campaign.candidateCount,
          parentStrategy: working.campaign.parentStrategy,
          exploreRatio: working.campaign.exploreRatio,
          ...(gapPlanContext(working) ?? {}),
        })));
        const { result: plan, ungroundedCount } = flagUngroundedCandidates(limitPlanToTask(working, planParsed));
        if (ungroundedCount > 0) pushActivity(`Round ${round} 方案：${ungroundedCount} 个候选缺少源成果证据引用，已标记`, undefined, projectId);
        // gap 闭环硬校验：存在上轮盲测优化建议时，不回应任何建议的候选不得进决赛
        //（除非会让种群少于 2 个），避免「建议提了没人接」。
        const activeAdvice = working.validationRun.aiAdvice ?? working.experimentRun.aiAdvice ?? working.campaign.lastGapAdvice;
        const adviceTitles = (activeAdvice?.actions ?? []).map((action) => action.title);
        const adviceCovering = plan.candidates.filter((candidate) => (candidate.addressesAdvice ?? []).some((title) => adviceTitles.includes(title)));
        const planPool = adviceTitles.length && adviceCovering.length >= 2 ? adviceCovering : plan.candidates;
        candidates = selectDiverseCandidates({ project: working, candidates: planPool, count: focusedTask(working).candidateCount });
        const selectedIds = candidates.map((candidate) => candidate.id);
        working = persist({
          ...working,
          candidates,
          selectedCandidateIds: selectedIds,
          stage: "plan",
          gates: working.gates.map((gate) => gate.id === "experiment-ready"
            ? { ...gate, status: working.campaign.autoApproveOfflineExperiment ? "approved" : "ready", approvedAt: working.campaign.autoApproveOfflineExperiment ? now() : undefined, note: working.campaign.autoApproveOfflineExperiment ? `Campaign Round ${round} 自动批准离线实验` : "等待人工确认" }
            : gate),
        });
        checkpointAt("plan");
      }
      if (!working.campaign.autoApproveOfflineExperiment) {
        const reason = "Experiment Ready 等待人工确认。多轮 Campaign 自动搜索需要允许纯离线 Gate 自动批准；也可切回单轮工作流手动审批。";
        working = persist({ ...working, campaign: { ...working.campaign, status: "paused", stopReason: reason } });
        pushActivity(`Round ${round} 暂停：${reason}`, undefined, projectId);
        setStage("plan");
        return { round, stopped: true, paused: true, stopReason: reason, champion: working.searchChampion };
      }

      let experiment: typeof working.experimentRun;
      if (resumed("experiment") && working.experimentRun.status !== "idle" && working.experimentRun.candidateResults.length) {
        // 断点续跑：实验结果已落盘（含打分后的候选），直接复用。
        experiment = working.experimentRun;
        phaseDone(`Round ${round} 断点续跑 · 复用已完成的沙箱实验`);
      } else {
        phaseDone(`Round ${round} 方案生成完成（${candidates.length} 个候选）· 运行沙箱实验`);
        experiment = await runExperiment(working, candidates);
        const resultMap = new Map(experiment.candidateResults.map((item) => [item.candidateId, item.evaluation]));
        const scoredCandidates = working.candidates.map((candidate) => {
          const evaluation = resultMap.get(candidate.id);
          if (!evaluation) return candidate;
          const resultRecord = experiment.candidateResults.find((item) => item.candidateId === candidate.id);
          return {
            ...candidate,
            artifactSnapshots: resultRecord?.artifactSnapshots ?? candidate.artifactSnapshots,
            artifactBuildStatus: resultRecord?.artifactSnapshots?.length ? "ready" as const : candidate.artifactBuildStatus,
            artifactBuildSummary: resultRecord?.artifactBuildSummary ?? candidate.artifactBuildSummary,
            accuracy: evaluation.accuracy,
            evidence: evaluation.evidence,
            riskCoverage: evaluation.riskCoverage,
            costDelta: baseline.result ? Number((((evaluation.averageCost / baseline.result.averageCost) - 1) * 100).toFixed(1)) : 0,
            speedDelta: baseline.result ? Number(((1 - evaluation.averageLatencyMs / baseline.result.averageLatencyMs) * 100).toFixed(1)) : 0,
            safety: evaluation.safety,
            recommended: (experiment.winnerId ?? experiment.pendingEvidenceCandidateId) === candidate.id,
            status: experiment.winnerId === candidate.id ? "winner" as const : evaluation.safety === "FAIL" ? "failed" as const : "passed" as const,
            notes: evaluation.notes,
          };
        });
        working = persist({ ...working, evalSuite: experiment.comparisonSuite ?? working.evalSuite, baselineRun: experiment.comparisonBaseline ?? working.baselineRun, experimentRun: experiment, candidates: scoredCandidates, validationRun: { id: `validation-${Date.now()}`, status: "idle", checks: [], runs: [], baselineRuns: [] }, stage: "experiment" });
        checkpointAt("experiment");
      }
      const roundCandidateId = experiment.winnerId ?? experiment.pendingEvidenceCandidateId;
      const winnerCandidate = working.candidates.find((candidate) => candidate.id === roundCandidateId);
      if (!winnerCandidate) {
        const adviceProject: EvolveProject = {
          ...working,
          evalSuite: experiment.comparisonSuite ?? working.evalSuite,
          baselineRun: experiment.comparisonBaseline ?? working.baselineRun,
          experimentRun: experiment,
        };
        const fallback = fallbackExperimentAdvice(adviceProject, experiment);

        // If the challenger is blocked only because evidence is missing, generating more content is
        // actively harmful. Keep the exact artifacts and pause so Runner/visual/manual evidence can
        // be completed, matching the same fail-closed rule used by Artifact Acceptance.
        if (experimentNeedsEvidenceRepair(experiment)) {
          experiment = { ...experiment, aiAdvice: fallback };
          const reason = fallback.overall;
          working = persist({
            ...working,
            experimentRun: experiment,
            campaign: { ...working.campaign, status: "paused", stopReason: reason, lastGapAdvice: fallback, checkpoint: undefined, schedule: { ...working.campaign.schedule, enabled: false, nextRunAt: undefined } },
            stage: "experiment",
          });
          pushActivity(`Round ${round} 暂停：没有产品失败证据，只缺真实验证；保留候选等待补证`, undefined, projectId);
          setStage("experiment");
          return { round, stopped: true, paused: true, stopReason: reason, champion: working.searchChampion };
        }

        let advice = fallback;
        try {
          const generated = GapAdviceAiResultSchema.parse(await runProjectAi("gap-advice", buildExperimentGapAdvicePayload(adviceProject, experiment)));
          if (generated.actions.length) advice = generated;
        } catch (error) {
          pushActivity(`Round ${round} 无 Winner 建议模型暂不可用，已使用真实差距兜底：${error instanceof Error ? error.message : "unknown"}`, undefined, projectId);
        }
        experiment = { ...experiment, aiAdvice: advice };
        const archiveEntries = buildRoundArchive({ project: working, round, candidates: working.candidates, results: experiment.candidateResults, parentVersionId });
        const scoreBaseline = working.campaign.rootBaseline ?? baseline.result;
        const closest = [...experiment.candidateResults]
          .filter((result) => result.experimentStage !== "screened")
          .sort((a, b) => computeFitness(b.evaluation, scoreBaseline).score - computeFitness(a.evaluation, scoreBaseline).score)[0];
        const closestScore = closest ? computeFitness(closest.evaluation, scoreBaseline).score : undefined;
        const noImprovementRounds = working.campaign.noImprovementRounds + 1;
        const exploreRatio = nextExploreRatio(working.campaign.exploreRatio, false, noImprovementRounds);
        const roundCost = estimateRoundCost(working);
        const roundRecord = { ...buildRoundRecord({
          project: working,
          round,
          parentVersionId,
          winnerScore: closestScore,
          championChanged: false,
          improvement: 0,
          startedAt,
          summary: `Round ${round} 没有候选达到晋级线；已归档候选并生成 ${advice.actions.length} 条差距建议，下一轮继续从 ${working.searchChampion?.versionLabel ?? "原版"} 变异。`,
        }), globalChampionId: working.searchChampion?.id };
        working = persist({
          ...working,
          experimentRun: experiment,
          evolutionArchive: [...working.evolutionArchive, ...archiveEntries].slice(-240),
          roundHistory: [...working.roundHistory, roundRecord],
          campaign: {
            ...working.campaign,
            currentRound: round,
            noImprovementRounds,
            exploreRatio,
            lastGapAdvice: advice,
            estimatedCost: Number((working.campaign.estimatedCost + roundCost).toFixed(4)),
            schedule: { ...working.campaign.schedule, lastRunAt: now(), nextRunAt: nextScheduledAt(working.campaign.schedule) },
            checkpoint: undefined,
          },
        });
        pushActivity(`Round ${round} 无 Winner · 已反思并归档；探索比例 ${working.campaign.exploreRatio}`, undefined, projectId);

        const stopReason = campaignStopReason(working);
        if (stopReason) {
          const champion = working.searchChampion;
          const satisfied = campaignGoalSatisfied(working);
          working = persist({
            ...working,
            campaign: { ...working.campaign, status: satisfied ? "completed" : "paused", completedAt: satisfied ? now() : undefined, stopReason, schedule: { ...working.campaign.schedule, enabled: false, nextRunAt: undefined } },
            outputArtifacts: champion?.candidate && champion.artifactAcceptance?.status === "passed"
              ? [...acceptanceArtifacts(working, champion.candidate, champion.artifactAcceptance), ...materializeChampionOutputs(working).filter((artifact) => artifact.kind !== "primary")]
              : working.outputArtifacts,
            ...(champion?.candidate && champion.validation && champion.artifactAcceptance ? {
              candidates: [champion.candidate, ...working.candidates.filter((item) => item.id !== champion.candidate?.id)],
              experimentRun: { ...working.experimentRun, status: "completed" as const, winnerId: champion.candidate.id },
              validationRun: champion.validation,
              artifactAcceptance: champion.artifactAcceptance,
              gates: working.gates.map((gate) => gate.id === "artifact-ready"
                ? { ...gate, status: "approved" as const, approvedAt: champion.artifactAcceptance?.acceptedAt ?? now(), note: `Campaign 保留历史 Search Champion ${champion.versionLabel}` }
                : gate.id === "release-ready"
                  ? { ...gate, status: champion.validation?.recommendation === "release" ? "ready" as const : "blocked" as const, approvedAt: undefined, note: `最终保留 ${champion.versionLabel}` }
                  : gate),
              stage: "validation" as const,
            } : { stage: "experiment" as const }),
          });
          setStage(working.stage);
          pushActivity(`${satisfied ? "Campaign 达标完成" : "Campaign 到达安全边界，等待人工决定"}：${stopReason}`, undefined, projectId);
          return { round, stopped: true, paused: !satisfied, stopReason, champion: working.searchChampion };
        }

        working = persist({
          ...working,
          campaign: { ...working.campaign, status: working.campaign.executionMode === "auto-rounds" ? "running" : "paused" },
          stage: "baseline",
          candidates: [], selectedCandidateIds: [],
          baselineRun: { id: `baseline-r${round + 1}-${Date.now()}`, status: "idle", suiteName: "Core Validation Suite", totalCases: working.evalSuite.length, runs: [] },
          experimentRun: { id: `experiment-r${round + 1}-${Date.now()}`, status: "idle", candidateResults: [] },
          validationRun: { id: `validation-r${round + 1}-${Date.now()}`, status: "idle", checks: [], runs: [], baselineRuns: [] },
          artifactAcceptance: { ...working.artifactAcceptance, id: `artifact-acceptance-r${round + 1}-${Date.now()}`, status: "idle", candidateId: undefined, results: [], attempts: 0, overallScore: 0, coverageScore: 0, integrityScore: 0, pairwiseScore: 0, hardGatePass: false, summary: "等待下一轮 Artifact Acceptance", acceptedAt: undefined, lastCheckedAt: undefined },
          gates: working.gates.map((gate) => gate.id === "target-ready" ? gate : { ...gate, status: "pending", approvedAt: undefined, note: undefined }),
        });
        setStage("baseline");
        return { round, stopped: false, champion: working.searchChampion };
      }

      let finalWinner: (typeof working.candidates)[number];
      let validation: typeof working.validationRun;
      let artifactAcceptance: typeof working.artifactAcceptance;
      if (resumed("validation") && working.validationRun.status === "completed") {
        // 断点续跑：盲测 + 成果验收已落盘。修复后的 Winner 当时已写回 candidates，按 id 取到的就是最终形态。
        finalWinner = winnerCandidate;
        validation = working.validationRun;
        artifactAcceptance = working.artifactAcceptance;
        phaseDone(`Round ${round} 断点续跑 · 复用已完成的盲测验证与成果验收`);
      } else {
        phaseDone(`Round ${round} 实验完成 · Winner 进入盲测验证`);
        const initialValidation = await runValidation(working, winnerCandidate);
        phaseDone(`Round ${round} Hidden Validation 完成 · 进入 Gate F Artifact Acceptance`);
        const artifactLoop = await runArtifactAcceptanceLoop({
          project: working,
          candidate: winnerCandidate,
          validation: initialValidation,
          onProgress: (label) => pushActivity(`Round ${round} · ${label}`, undefined, projectId),
        });
        finalWinner = artifactLoop.candidate;
        validation = artifactLoop.validation;
        artifactAcceptance = artifactLoop.acceptance;
        working = persist({
          ...working,
          acceptanceRubric: artifactLoop.rubric,
          artifactAcceptance,
          validationRun: validation,
          candidates: working.candidates.map((candidate) => candidate.id === finalWinner.id ? finalWinner : candidate),
          gates: working.gates.map((gate) => gate.id === "artifact-ready"
            ? { ...gate, status: artifactAcceptance.status === "passed" ? "approved" : "blocked", approvedAt: artifactAcceptance.status === "passed" ? now() : undefined, note: artifactAcceptance.summary }
            : gate.id === "release-ready"
              ? { ...gate, status: validation.recommendation === "release" && artifactAcceptance.status === "passed" ? "ready" : "blocked", approvedAt: undefined, note: artifactAcceptance.status === "passed" ? "Hidden Validation + Artifact Ready 已通过" : "Artifact Ready 未通过" }
              : gate),
          stage: "validation",
        });
        checkpointAt("validation");
      }
      // 建议闭环：本轮盲测/验收没过关时自动产出一份优化建议写回项目，
      // 下一轮 plan 会直接继承 gapAdvice——自动模式下不再「建议提了没人接」。
      if ((validation.recommendation !== "release" || artifactAcceptance.status !== "passed") && !validation.aiAdvice && validation.evaluation && validation.baselineEvaluation) {
        try {
          const advice = GapAdviceAiResultSchema.parse(await runProjectAi("gap-advice", buildGapAdvicePayload({
            project: working,
            checks: validation.checks,
            evaluation: validation.evaluation,
            baselineEvaluation: validation.baselineEvaluation,
            runs: validation.runs,
            baselineRuns: validation.baselineRuns,
          })));
          working = persist({ ...working, validationRun: { ...working.validationRun, aiAdvice: advice } });
          pushActivity(`Round ${round} 自动生成 ${advice.actions.length} 条优化建议，下一轮候选必须回应`, undefined, projectId);
        } catch (error) {
          pushActivity(`Round ${round} 优化建议生成失败（不影响主流程）：${error instanceof Error ? error.message : "unknown"}`, undefined, projectId);
        }
      }
      const archiveEntries = buildRoundArchive({
        project: working,
        round,
        candidates: working.candidates,
        results: experiment.candidateResults,
        winnerId: experiment.winnerId ?? experiment.pendingEvidenceCandidateId,
        parentVersionId,
      });
      const championUpdate = maybeUpdateSearchChampion({
        current: working.searchChampion,
        round,
        winner: finalWinner,
        validation,
        artifactAcceptance,
        baseline: working.campaign.rootBaseline ?? baseline.result,
        parentVersionId,
        minImprovement: working.campaign.stopCriteria.minImprovement,
        liveTarget: campaignObservesLiveTarget(working),
        hiddenSuite: working.hiddenEvalSuite,
      });
      if (championUpdate.comparisonPending) {
        const stopReason = "当前 Champion 缺少完整同卷 Hidden 对照证据；请重新运行 Hidden Validation。";
        working = persist({ ...working, campaign: { ...working.campaign, status: "paused", stopReason, schedule: { ...working.campaign.schedule, enabled: false, nextRunAt: undefined } }, stage: "validation" });
        setStage("validation");
        pushActivity(stopReason, undefined, projectId);
        return { round, stopped: true, paused: true, stopReason, champion: working.searchChampion };
      }
      const winnerEvaluation = validation.evaluation ?? experiment.candidateResults.find((item) => item.candidateId === (experiment.winnerId ?? experiment.pendingEvidenceCandidateId))?.evaluation;
      const winnerScore = winnerEvaluation ? computeFitness(winnerEvaluation, working.campaign.rootBaseline ?? baseline.result, artifactAcceptance).score : undefined;
      const roundCost = estimateRoundCost(working);
      const noImprovementRounds = championUpdate.changed ? 0 : working.campaign.noImprovementRounds + 1;
      // 自适应探索：夺冠后收敛到利用，连续停滞时逐步加码探索（只在 0.15–0.6 内漂移，
      // 每次变化都会写进活动流，避免用户配置被静默改掉）。
      const exploreRatio = nextExploreRatio(working.campaign.exploreRatio, championUpdate.changed, noImprovementRounds);
      if (Math.abs(exploreRatio - working.campaign.exploreRatio) >= 0.01) {
        pushActivity(`Round ${round} 自适应探索比例 ${working.campaign.exploreRatio} → ${exploreRatio}${championUpdate.changed ? "（本轮夺冠，收敛利用）" : `（连续 ${noImprovementRounds} 轮未提升，加大探索）`}`, undefined, projectId);
      }
      const roundRecord = { ...buildRoundRecord({
        project: working,
        round,
        parentVersionId,
        winnerId: experiment.winnerId ?? experiment.pendingEvidenceCandidateId,
        winnerScore,
        championChanged: championUpdate.changed,
        improvement: championUpdate.improvement,
        startedAt,
        summary: championUpdate.changed
          ? `Round ${round} 发现新的 Search Champion ${championUpdate.champion?.versionLabel}。`
          : artifactAcceptance.status !== "passed"
            ? `Round ${round} 的 Best-of-Round 未通过 Gate F Artifact Ready（${artifactAcceptance.overallScore}/100），不会替换历史 Search Champion。`
            : `Round ${round} 未超过当前 Search Champion，候选保留到 Archive 作为 Elite / Stepping Stone。`,
      }), globalChampionId: championUpdate.champion?.id };
      working = persist({
        ...working,
        searchChampion: championUpdate.champion,
        searchAppliedPatches: championUpdate.champion?.patches ?? working.searchAppliedPatches,
        evolutionArchive: [...working.evolutionArchive, ...archiveEntries].slice(-240),
        roundHistory: [...working.roundHistory, roundRecord],
        campaign: {
          ...working.campaign,
          currentRound: round,
          noImprovementRounds,
          exploreRatio,
          bestScore: championUpdate.champion?.score ?? working.campaign.bestScore,
          lastGapAdvice: championUpdate.changed ? undefined : (working.validationRun.aiAdvice ?? working.campaign.lastGapAdvice),
          estimatedCost: Number((working.campaign.estimatedCost + roundCost).toFixed(4)),
          schedule: advanceCampaignScheduleAfterRun(working.campaign.schedule),
          // 整轮结算完成：断点使命结束，清掉，下一轮从头跑。
          checkpoint: undefined,
        },
      });

      phaseDone(`Round ${round} 盲测完成 · 结算 Champion 与停止条件`);
      if (artifactAcceptance.status === "unverified" || (validation.evaluation?.unverifiedCriterionIds?.length ?? 0) > 0) {
        const stopReason = artifactAcceptance.summary || "请补齐真实验证证据后继续";
        working = persist({ ...working, campaign: { ...working.campaign, status: "paused", stopReason, schedule: { ...working.campaign.schedule, enabled: false, nextRunAt: undefined } }, stage: "validation" });
        setStage("validation");
        pushActivity(`进化已暂停，等待验证能力：${stopReason}`, undefined, projectId);
        return {round,stopped:true,paused:true,stopReason,champion:working.searchChampion};
      }
      const stopReason = campaignStopReason(working);
      if (stopReason) {
        const champion = working.searchChampion;
        const satisfied = campaignGoalSatisfied(working);
        working = persist({
          ...working,
          campaign: { ...working.campaign, status: satisfied ? "completed" : "paused", completedAt: satisfied ? now() : undefined, stopReason, schedule: { ...working.campaign.schedule, enabled: false, nextRunAt: undefined } },
          outputArtifacts: champion?.candidate && champion.artifactAcceptance?.status === "passed"
            ? [...acceptanceArtifacts(working, champion.candidate, champion.artifactAcceptance), ...materializeChampionOutputs(working).filter((artifact) => artifact.kind !== "primary")]
            : working.outputArtifacts,
          artifactAcceptance: champion?.artifactAcceptance ?? working.artifactAcceptance,
          candidates: champion?.candidate ? [champion.candidate, ...working.candidates.filter((item) => item.id !== champion.candidate?.id)] : working.candidates,
          experimentRun: champion?.candidate ? { ...working.experimentRun, status: "completed", winnerId: champion.candidate.id } : working.experimentRun,
          validationRun: champion?.validation ?? working.validationRun,
          gates: working.gates.map((gate) => gate.id === "artifact-ready"
            ? { ...gate, status: champion?.artifactAcceptance?.status === "passed" ? "approved" : "blocked", approvedAt: champion?.artifactAcceptance?.status === "passed" ? now() : undefined, note: champion ? `Campaign 最终 Champion ${champion.versionLabel} · Artifact Acceptance ${champion.artifactAcceptance?.overallScore ?? 0}` : "Campaign 没有可验收 Champion" }
            : gate.id === "release-ready"
              ? { ...gate, status: champion?.validation?.recommendation === "release" && champion?.artifactAcceptance?.status === "passed" ? "ready" : "blocked", note: champion ? `Campaign 完成，最终 Search Champion ${champion.versionLabel} 已通过 Behavioral + Artifact Gate` : "Campaign 没有可发布 Champion" }
              : gate),
          stage: champion ? "validation" : "learning",
        });
        setStage(working.stage);
        pushActivity(`${satisfied ? "Campaign 达标完成" : "Campaign 到达安全边界，等待人工决定"}：${stopReason}`, undefined, projectId);
        return { round, stopped: true, paused: !satisfied, stopReason, champion: working.searchChampion };
      }

      working = persist({
        ...working,
        campaign: { ...working.campaign, status: working.campaign.executionMode === "auto-rounds" ? "running" : working.campaign.schedule.enabled ? "scheduled" : "paused", startedAt: working.campaign.executionMode === "auto-rounds" ? working.campaign.startedAt : undefined },
        stage: "baseline",
        candidates: [], selectedCandidateIds: [],
        baselineRun: { id: `baseline-r${round + 1}-${Date.now()}`, status: "idle", suiteName: "Core Validation Suite", totalCases: working.evalSuite.length, runs: [] },
        experimentRun: { id: `experiment-r${round + 1}-${Date.now()}`, status: "idle", candidateResults: [] },
        validationRun: { id: `validation-r${round + 1}-${Date.now()}`, status: "idle", checks: [], runs: [], baselineRuns: [] },
        artifactAcceptance: { ...working.artifactAcceptance, id: `artifact-acceptance-r${round + 1}-${Date.now()}`, status: "idle", candidateId: undefined, results: [], attempts: 0, overallScore: 0, coverageScore: 0, integrityScore: 0, pairwiseScore: 0, hardGatePass: false, summary: "等待下一轮 Artifact Acceptance", acceptedAt: undefined, lastCheckedAt: undefined },
        gates: working.gates.map((gate) => gate.id === "target-ready" ? gate : { ...gate, status: "pending", approvedAt: undefined, note: undefined }),
      });
      phaseDone(`Round ${round} 结束 · ` + (championUpdate.changed ? `Champion 更新为 ${championUpdate.champion?.versionLabel}` : "Champion 未更新，候选归档"));
      setStage("baseline");
      return { round, stopped: false, champion: working.searchChampion };
    });
  }, [commit, generateEvalSuite, projectId, run, runProjectAi]);

  const runCampaign = useCallback(async () => {
    const scoringBlocker = campaignScoringInputBlocker(projectRef.current) ?? campaignScoringRouteBlocker(projectRef.current);
    if (scoringBlocker) {
      commit((current) => ({ ...current, campaign: { ...current.campaign, status: "paused", stopReason: scoringBlocker, schedule: { ...current.campaign.schedule, enabled: false, nextRunAt: undefined } } }));
      pushActivity("Campaign 未启动：" + scoringBlocker, undefined, projectId);
      return;
    }
    const before = projectRef.current;
    const preflight = campaignPreflightStopReason(before);
    if (preflight) {
      const satisfied = campaignGoalSatisfied(before);
      commit((current) => ({ ...current, campaign: { ...current.campaign, status: satisfied ? "completed" : "paused", completedAt: satisfied ? now() : undefined, stopReason: preflight, schedule: { ...current.campaign.schedule, enabled: false, nextRunAt: undefined } } }));
      pushActivity(`Campaign 未启动：${preflight}`, undefined, projectId);
      return;
    }
    commit((current) => ({ ...current, campaign: { ...current.campaign, status: "running", executionMode: "auto-rounds", startedAt: current.campaign.startedAt ?? now(), stopReason: undefined } }));
    pushActivity("Campaign 自动运行开始", undefined, projectId);
    let guard = 0;
    try {
      while (guard < 100) {
        guard += 1;
        const current = projectRef.current;
        if (current.campaign.status === "paused" || current.campaign.status === "completed" || current.campaign.status === "stopped") break;
        const result = await runCampaignRound();
        // 用户暂停时 run() 会把打断收敛成 undefined（并在内部记「已暂停」）：按停止处理，断点已随阶段落盘。
        if (!result || result.stopped) {
          const paused = Boolean(result && "paused" in result && result.paused);
          if (result && !paused && projectRef.current.searchChampion) await materializeOutputs();
          break;
        }
        if (projectRef.current.campaign.executionMode !== "auto-rounds") break;
      }
    } catch (error) {
      // A failed round must not leave a persisted "running" campaign behind. Otherwise the
      // autonomy card shows a spinner beside a terminal error and cannot offer Resume.
      const reason = error instanceof BaselineEvaluationError
        ? "Baseline 评审未完成，已保留断点：" + error.message
        : error instanceof CandidateArtifactBuildError
          ? "候选文件构造未完成；已保留本轮断点。请检查模型连接后继续自主进化。"
          : "本轮执行失败，已保留断点：" + (error instanceof Error ? error.message : String(error));
      const failedBuilds = error instanceof CandidateArtifactBuildError
        ? new Map(error.candidates.map((candidate) => [candidate.id, candidate.artifactBuildSummary]))
        : undefined;
      commit((current) => current.campaign.status === "running" ? {
        ...current,
        candidates: failedBuilds ? current.candidates.map((candidate) => failedBuilds.has(candidate.id)
          ? { ...candidate, artifactBuildStatus: "failed" as const, artifactBuildSummary: failedBuilds.get(candidate.id) }
          : candidate) : current.candidates,
        campaign: { ...current.campaign, status: "paused", stopReason: reason },
      } : current);
      pushActivity(`Campaign 已暂停 · ${reason}`, undefined, projectId);
      throw error;
    }
    const endedPaused = projectRef.current.campaign.status === "paused";
    pushActivity(endedPaused
      ? "Campaign 已暂停 · 断点已保存，可从断点继续"
      : `Campaign 自动运行结束 · 当前状态 ${projectRef.current.campaign.status}`, undefined, projectId);
  }, [commit, materializeOutputs, projectId, runCampaignRound]);

  const finishAutonomousSuccess = useCallback(async () => {
    const current = projectRef.current;
    const online = projectHasOnlineReleaseTarget(current);
    if (online && !projectHasLiveReleaseDecision(current)) throw new Error("线上 Target 尚无真实 Promote / Rollback 决策，不能标记自主闭环完成");
    if (online && !projectHasStableHealthyProductionOutcome(current)) throw new Error(`Production Outcome 尚未稳定：${productionOutcomeTrend(current).reason}`);
    if (!current.outputArtifacts.some((artifact) => artifact.accepted && artifact.kind === "primary")) throw new Error("最终成果尚未完成 Gate F 打包");
    if (!current.lessons.length || !current.nextQueue.length) throw new Error("Lesson / Next Queue 尚未完成，不能结束自主闭环");
    const finishedAt = now();
    const reason=online
      ? "当前进化要求已全部通过：成果冻结、真实线上 Release 决策、经验沉淀与下一轮建议已完成"
      : "当前进化要求已全部通过：成果冻结、离线经验沉淀与下一轮建议已完成";
    commit((state) => completeAutonomousMission(state,{at:finishedAt,reason}));
    setStage("learning");
    setStatus({ busy: false, message: online
      ? "进化完成：真实上线决策、成果、Lesson 与下一轮建议均已闭环"
      : "进化完成：成果、Lesson 与下一轮建议已准备好，等待你验收" });
    pushActivity(online
      ? "自主进化完成 · 线上闭环（Release + Outcome + Lesson + Next Queue）已完成"
      : "自主进化完成 · 离线闭环（成果 + Lesson + Next Queue）已完成", undefined, projectId);
  }, [commit, projectId, setStatus]);

  // 自主编排器：React 只负责执行纯状态机给出的动作，不再自己决定流程分支。
  // 每一步结束后重新读取最新 Project，再决定继续、修复、补证、打包或请求人工。
  const runAutoPilot = useCallback(async () => {
    const cur = () => projectRef.current;
    const requiresRemoteMaterialization=()=>{
      const current=cur();
      return (current.targetConnection.adapter==="git"||current.targetConnection.adapter==="connector")
        &&current.targetConnection.status==="connected"
        &&!current.sourceArtifacts.some((artifact)=>artifact.role==="target");
    };
    if (productionRuntimeMode() !== "local" && await shouldUseServerAutoPilot(cur())) {
      try {
        const started = await startServerEvolutionWorkflow(projectId,{
          idempotencyKey:`autopilot:${cur().updatedAt}`,
        });
        setStatus({ busy: false, message: started.reused
          ? "已连接到现有 Durable Workflow；请查看当前执行状态"
          : "Durable Workflow 已接管自主进化，关闭浏览器后仍会继续执行" });
        pushActivity(`Server Workflow ${started.reused?"已复用":"已启动"} · runId=${started.runId}`, undefined, projectId);
        return;
      } catch (error) {
        if(requiresRemoteMaterialization()){
          const message=`Remote Target 必须先由 Server Durable Workflow 锁定并物化 exact snapshot：${error instanceof Error ? error.message : String(error)}`;
          setStatus({busy:false,error:message});
          pushActivity(`Server Workflow 启动失败 · 禁止把 Remote Target 回退到本地 Harness：${message}`,undefined,projectId);
          return;
        }
        pushActivity(`Server Workflow 启动失败，安全回退本地 Harness：${error instanceof Error ? error.message : String(error)}`, undefined, projectId);
      }
    }
    if(requiresRemoteMaterialization()){
      const message=productionRuntimeMode()==="local"
        ?"Git / Connector Remote Target 需要 Server Runtime 才能锁定 exact snapshot；本地模式不会猜测或复制远端状态。"
        :"当前 Server 能力尚不足以物化这个 Remote Target；请检查 Git/Connector 配置与 Durable Workflow capability。";
      setStatus({busy:false,error:message});
      pushActivity(`Remote Target 未进入 Server Workflow：${message}`,undefined,projectId);
      return;
    }
    pushActivity("自主进化开始 · Orchestrator 接管后续理解、进化、验证与收敛", undefined, projectId);
    const executor = createHarnessActionExecutor<HarnessPlan>(projectId, {
      complete: async () => {
        await finishAutonomousSuccess();
        return { control: "stop" };
      },
      package: async () => {
        await materializeOutputs();
        return { control: "continue" };
      },
      "run-release": async () => {
        const action=nextDurableReleaseAction(cur());
        if(!action)throw new Error("当前 Release 状态没有可安全自动推进的 Durable Action");
        await releaseAction(action);
        return {control:"continue"};
      },
      "reconcile-release": async () => {
        await reconcileRelease();
        return {control:"continue"};
      },
      distill: async () => { await distill(); },
      "next-queue": async () => { await generateNextQueue(); },
      "wait-human": async (plan) => {
        const decision = plan.decision;
        commit((current) => ({
          ...reconcileAttentionRequest(current, decision.attention),
          campaign: { ...current.campaign, status: "paused", stopReason: decision.reason },
        }));
        setStage(decision.stage);
        setStatus({ busy: false, message: decision.reason });
        pushActivity(`自主进化只在必要时请求人工：${decision.attention?.title ?? decision.reason}`, undefined, projectId);
        return { control: "stop" };
      },
      understand: async () => { await deepenUnderstanding(); },
      "adopt-defaults": async (plan) => {
        const decision = plan.decision;
        const adoptedAt = now();
        const adopted = (decision.autoClarifications ?? []).map((item) => ({ question: item.question, answer: item.defaultAnswer.trim(), answeredBy: "ai-assumption" as const, at: adoptedAt }));
        commit((current) => {
          const hasDownstream = current.baselineRun.status !== "idle" || current.candidates.length > 0 || current.experimentRun.status !== "idle";
          const base = hasDownstream ? resetDownstream(current) : current;
          const questions = new Set(adopted.map((item) => item.question));
          return {
            ...base,
            inputClarifications: [...base.inputClarifications.filter((item) => !questions.has(item.question)), ...adopted],
            commandHistory: [...base.commandHistory, {
              id: `cmd-auto-assumption-${Date.now()}`,
              role: "system" as const,
              content: `自主进化采用 ${adopted.length} 条低风险默认假设：${adopted.map((item) => `${item.question} → ${item.answer}`).join("；")}`,
              artifactIds: [],
              createdAt: adoptedAt,
            }],
          };
        });
        pushActivity(decision.reason, undefined, projectId);
      },
      "compile-contract": async () => { await compileAcceptanceRubric(); },
      "approve-contract": async () => {
        const approvedAt = now();
        commit((current) => ({
          ...current,
          acceptanceRubricState: { ...current.acceptanceRubricState, confirmedAt: approvedAt },
          gates: current.gates.map((gate) => gate.id === "target-ready" ? { ...gate, status: "approved", approvedAt, note: "Orchestrator：输入、边界与验收标准完整，自动批准离线 Target Ready" } : gate),
        }));
        pushActivity("Orchestrator 自动批准离线 Target Ready", undefined, projectId);
      },
      "build-eval": async () => { await generateEvalSuite(); },
      revalidate: async () => {
        let settled = false;
        let lastReason = "评审模型未返回完整逐标准判断";
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          commit((current) => ({
            ...reconcileAttentionRequest(current),
            campaign: { ...current.campaign, status: "idle", stopReason: undefined },
          }));
          setStage("validation");
          pushActivity(`Orchestrator 本地自动复验 ${attempt}/2 · 复用当前 Candidate，不重新生成内容`, undefined, projectId);
          await executeValidation();
          const afterRevalidation = cur();
          if (afterRevalidation.validationRun.status === "failed") {
            lastReason = afterRevalidation.validationRun.error ?? "Hidden Validation 未返回完整结果";
            if (attempt < 2) continue;
            break;
          }
          const nextDecision = evolutionHarness.plan(afterRevalidation).decision;
          if (nextDecision.action !== "revalidate") {
            settled = true;
            break;
          }
          const ids = afterRevalidation.validationRun.evaluation?.unverifiedCriterionIds ?? [];
          lastReason = ids.length ? `仍未结算：${ids.join("、")}` : "评审模型未返回完整逐标准判断";
          if (attempt < 2) continue;
        }
        if (!settled) {
          commit((current) => ({
            ...current,
            campaign: { ...current.campaign, status: "paused", stopReason: `本地评审自动重试已耗尽[${LOCAL_REVIEW_CONTRACT_VERSION}]：${lastReason}` },
          }));
        }
      },
      "run-campaign": async () => {
        commit((current) => ({
          ...current,
          campaign: {
            ...current.campaign,
            status: "running",
            stopReason: undefined,
            autoApproveOfflineExperiment: true,
            executionMode: "auto-rounds",
            stopCriteria: { ...current.campaign.stopCriteria, stopWhenAcceptanceMet: true },
          },
        }));
        pushActivity("Orchestrator 进入进化循环：诊断 → 生成 → 对比 → 独立验收 → 自动修复", undefined, projectId);
        await runCampaign();
      },
    // Browser Harness records Job/Event evidence locally first. Production Sync projects it remotely when available.
    // Release and other production mutations still use their dedicated fail-closed server paths.
    }, localProductionPorts);
    try {
      for (let guard = 0; guard < 32; guard += 1) {
        const harnessPlan = evolutionHarness.plan(cur());
        const decision = harnessPlan.decision;
        if (harnessPlan.policy.mode === "blocked") {
          commit((current) => ({ ...current, campaign: { ...current.campaign, status: "paused", stopReason: harnessPlan.policy.reason } }));
          setStatus({ busy: false, message: harnessPlan.policy.reason });
          pushActivity(`Harness Budget/Policy 阻塞：${harnessPlan.policy.reason}`, undefined, projectId);
          return;
        }
        const hasPendingAttention = (cur().attentionRequests ?? []).some((item) => item.status === "pending");
        if (decision.action !== "wait-human" && hasPendingAttention) commit((current) => reconcileAttentionRequest(current));
        const execution = await executor.execute(harnessPlan);
        if (execution.control === "stop") return;
      }
      throw new Error("自主进化状态机超过安全循环次数，已停止以避免异常自旋");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const failure = evolutionHarness.routeFailure(error);
      setStatus({ busy: false, error: message });
      pushActivity(`Harness Failure Router · ${failure.action} · ${failure.disposition.reason}：${message}`, undefined, projectId);
    }
  }, [commit, compileAcceptanceRubric, deepenUnderstanding, distill, executeValidation, finishAutonomousSuccess, generateEvalSuite, generateNextQueue, materializeOutputs, projectId, reconcileRelease, releaseAction, runCampaign, setStatus]);

  /**
   * Revalidate the current immutable Candidate once, then continue orchestration only when the
   * evidence gap was actually settled. The previous UI chained requestValidation().then(runAutoPilot)
   * unconditionally, so an unchanged UNVERIFIED result immediately triggered two more identical
   * local reviews and looked like a dead button.
   */
  const revalidateAndContinue = useCallback(async () => {
    const validation = await requestValidation();
    if (!validation) return false;
    const pendingIds = validation.evaluation?.unverifiedCriterionIds ?? [];
    if (pendingIds.length) {
      const titles = pendingIds.map((id) => projectRef.current.acceptanceRubric.find((criterion) => criterion.id === id)?.title ?? id);
      const message = `重新验收已完成，但仍有 ${pendingIds.length} 项缺少与当前 Candidate 绑定的有效证据：${titles.join("、")}。请查看本次技术运行记录；重复点击不会生成新证据。`;
      setStatus({ busy: false, message });
      pushActivity(message, undefined, projectId);
      return false;
    }
    await runAutoPilot();
    return true;
  }, [projectId, requestValidation, runAutoPilot, setStatus]);


  /**
   * Resume is intentionally separate from runAutoPilot: a paused project may still carry the
   * Attention/stopReason that caused the pause. Starting AutoPilot without settling that state just
   * re-enters wait-human immediately and looks like a dead button.
   */
  const resumeAutonomousEvolution = useCallback(async () => {
    if (status.busy) return false;
    const current = projectRef.current;
    if (isLocalBaselineJudgePause(current) && !getAiProviderStatus("evaluate", { aiProfile: current.aiProfile }).live) {
      const message = isLocalDemoBaselinePause(current)
        ? "当前基线仍只有演示评审。请先在「AI 模型与连接」配置并测试真实评审模型，再重新测量 Baseline。"
        : "Baseline 评审连接仍不可用。请先在「AI 模型与连接」配置并测试真实评审模型，再从断点重测。";
      setStatus({ busy: false, message });
      pushActivity(`基线重测未启动 · ${message}`, undefined, projectId);
      return false;
    }
    const harnessPlan = evolutionHarness.plan(current);
    const decision = harnessPlan.decision;
    if (harnessPlan.policy.mode === "blocked") {
      setStage(decision.stage);
      setStatus({ busy: false, message: harnessPlan.policy.reason });
      pushActivity(`继续自主进化被 Harness Budget/Policy 阻塞：${harnessPlan.policy.reason}`, undefined, projectId);
      return false;
    }
    if (decision.action === "wait-human" && decision.attention && decision.attention.type !== "limit" && !isLocalBaselineEvidencePause(current) && !isLocalBaselineJudgePause(current)) {
      setStage(decision.stage);
      setStatus({ busy: false, message: `请先处理当前阻塞：${decision.attention.title}` });
      pushActivity(`继续自主进化被阻塞：${decision.attention.title}`, undefined, projectId);
      return false;
    }

    const resumedAt = now();
    const retried = prepareCampaignRetry(current, new Date(resumedAt));
    const remainingBoundary = campaignPreflightStopReason(retried);
    if (remainingBoundary && decision.attention?.type === "limit") {
      setStatus({ busy: false, message: `当前设置仍会触发安全边界：${remainingBoundary}。请调整高级边界后继续。` });
      pushActivity(`继续自主进化被安全边界阻塞：${remainingBoundary}`, undefined, projectId);
      return false;
    }
    commit((state) => {
      return reconcileAttentionRequest(prepareCampaignRetry(state, new Date(resumedAt)));
    });
    setStatus({ busy: false, message: "已解除可恢复暂停，正在从当前断点继续自主进化…" });
    pushActivity(`恢复自主进化 · ${resumedAt}`, undefined, projectId);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await runAutoPilot();
    return true;
  }, [commit, projectId, runAutoPilot, setStage, setStatus, status.busy]);

  const prepareChampionRelease = useCallback(() => {
    const current = projectRef.current;
    const champion = current.searchChampion;
    if (!projectHasOnlineReleaseTarget(current)) throw new Error("当前 Mission 没有连接生产发布平台；请在发布控制中先连接独立 Release Target。");
    if (!champion?.candidate || !champion.validation) throw new Error("Search Champion 尚未完成 Hidden Validation");
    if (champion.validation.status !== "completed" || champion.validation.recommendation !== "release") throw new Error("Search Champion 尚未获得 Release 推荐，禁止准备生产发布");
    if (champion.artifactAcceptance?.status !== "passed") throw new Error("Search Champion 尚未通过 Gate F · Artifact Ready");
    // 收窄结果存到局部 const：闭包内属性收窄会丢失，直接用 champion.candidate 仍被视为可能 undefined。
    const championCandidate = champion.candidate;
    const championValidation = champion.validation;
    commit((state) => ({
      ...state,
      candidates: [championCandidate, ...state.candidates.filter((item) => item.id !== championCandidate.id)],
      experimentRun: { ...state.experimentRun, status: "completed", winnerId: championCandidate.id },
      validationRun: championValidation,
      artifactAcceptance: champion.artifactAcceptance!,
      release: beginReleaseCycle(state.release, championCandidate.id),
      outputArtifacts: [...acceptanceArtifacts(state, championCandidate, champion.artifactAcceptance!), ...materializeChampionOutputs(state).filter((artifact) => artifact.kind !== "primary").map((artifact) => ({ ...artifact, accepted: true }))],
      gates: state.gates.map((gate) => gate.id === "artifact-ready"
        ? { ...gate, status: "approved", approvedAt: champion.artifactAcceptance?.acceptedAt ?? now(), note: `最终 Search Champion ${champion.versionLabel} 已通过 Artifact Acceptance ${champion.artifactAcceptance?.overallScore ?? 0}/100` }
        : gate.id === "release-ready"
          ? { ...gate, status: championValidation.recommendation === "release" ? "ready" : "blocked", note: `最终 Search Champion ${champion.versionLabel} · Behavioral + Artifact Gate 已验证` }
          : gate),
      stage: "validation",
    }));
    setStage("validation");
  }, [commit]);

  const resetCampaign = useCallback(() => {
    commit((current) => ({
      ...current,
      searchAppliedPatches: [],
      searchChampion: undefined,
      evolutionArchive: [],
      roundHistory: [],
      outputArtifacts: [],
      artifactAcceptance: { ...current.artifactAcceptance, id: `artifact-acceptance-${Date.now()}`, status: "idle", candidateId: undefined, results: [], attempts: 0, overallScore: 0, coverageScore: 0, integrityScore: 0, pairwiseScore: 0, hardGatePass: false, summary: "Campaign 已重置，等待新的 Artifact Acceptance", acceptedAt: undefined, lastCheckedAt: undefined },
      campaign: {
        ...current.campaign,
        status: "idle",
        currentRound: 0,
        noImprovementRounds: 0,
        bestScore: undefined,
        rootBaseline: undefined,
        scoringRouteFingerprint: undefined,
        scoringInputFingerprint: undefined,
        lastGapAdvice: undefined,
        estimatedCost: 0,
        startedAt: undefined,
        completedAt: undefined,
        stopReason: undefined,
        schedule: { ...current.campaign.schedule, enabled: false, nextRunAt: undefined, lastRunAt: undefined },
      },
    }));
  }, [commit]);

  // 自动续跑：刷新/关闭页面后重新进入界面时，内存里的运行已消失，但本地存储的任务登记还在。
  // 按登记续跑——多轮编排从已保存的检查点继续循环，单节点动作重新执行该节点；
  // 界面切换（未刷新）时运行仍在内存里，直接接管状态，不重启任务。
  const resumeApiRef = useRef<Record<string, () => Promise<unknown>>>({});
  resumeApiRef.current = {
    rubric: compileAcceptanceRubric,
    "parser-refresh": refreshParsing,
    "eval-suite": generateEvalSuite,
    baseline: executeBaseline,
    problems: analyzeProblems,
    diagnosis: diagnose,
    plan: generatePlan,
    replan: generatePlan,
    experiment: executeExperiment,
    "experiment-retry": retryFailedExperiment,
    validation: executeValidation,
    "validation-retry": retryFailedValidation,
    distill,
    "next-queue": generateNextQueue,
    campaign: runCampaign,
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (getLiveRun(projectId)) return;
    const task = getRunTask(projectId);
    if (!task || !shouldResumeTask(task)) return;
    const campaignStatus = projectRef.current.campaign.status;
    if (task.kind === "campaign" && campaignStatus !== "running" && campaignStatus !== "scheduled") {
      endRunTask(projectId); // 编排已停止/暂停，登记是残留：清掉，不续跑
      return;
    }
    const action = task.kind === "campaign" ? resumeApiRef.current.campaign : resumeApiRef.current[task.actionId ?? ""];
    if (!action) { endRunTask(projectId); return; }
    pushActivity(`检测到刷新前被中断的「${task.label}」· 自动续跑`, undefined, projectId);
    void Promise.resolve()
      .then(() => action())
      .catch(() => endRunTask(projectId)); // run() 正常收尾会清登记；这里是前置检查报错时的兜底，避免每次进入都重试
  }, [projectId]);

  useEffect(() => {
    const schedule = project.campaign.schedule;
    if (!schedule.enabled || !schedule.nextRunAt || status.busy || project.campaign.status === "running" || project.campaign.status === "completed") return;
    if (schedule.durableJobId && schedule.durableScheduledFor === schedule.nextRunAt) return;
    // setTimeout 最大可靠延迟约 24.8 天。较远的一次性计划采用分段唤醒，
    // 不能简单 return，否则页面即使一直打开也永远不会触发。
    const MAX_TIMER_MS = 2_147_000_000;
    let cancelled = false;
    let timer: number | undefined;
    const arm = () => {
      if (cancelled) return;
      const latest = projectRef.current;
      const nextAt = latest.campaign.schedule.nextRunAt;
      if (!latest.campaign.schedule.enabled || !nextAt) return;
      const remaining = new Date(nextAt).getTime() - Date.now();
      if (!Number.isFinite(remaining)) return;
      if (remaining > MAX_TIMER_MS) {
        timer = window.setTimeout(arm, MAX_TIMER_MS);
        return;
      }
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const due = projectRef.current;
        if (!due.campaign.schedule.enabled || !due.campaign.schedule.nextRunAt) return;
        // 浏览器后台节流可能让计时器晚醒；若极少数情况下提前唤醒，则重新挂起，不提前执行。
        if (new Date(due.campaign.schedule.nextRunAt).getTime() - Date.now() > 250) {
          arm();
          return;
        }
        pushActivity("定时任务触发 · 开始执行编排", undefined, projectId);
        if (due.campaign.executionMode === "auto-rounds") void runCampaign(); else void runCampaignRound();
      }, Math.max(500, remaining));
    };
    arm();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [project.campaign.schedule, project.campaign.executionMode, project.campaign.status, projectId, runCampaign, runCampaignRound, status.busy]);

  const askCopilot = useCallback(async (message: string): Promise<CopilotAiResult> => {
    return CopilotAiResultSchema.parse(await run("Evolve Copilot", () => runProjectAi("copilot", {
      message,
      stage,
      project: {
        name: project.name,
        goal: project.goal,
        metrics: project.metrics,
        evalSuiteCount: project.evalSuite.length,
        hiddenEvalSuiteCount: project.hiddenEvalSuite.length,
        selectedProblem: project.problems.find((problem) => problem.id === project.selectedProblemId),
        diagnosis: project.diagnosis,
        candidates: project.candidates,
        experimentRun: project.experimentRun,
        validationRun: project.validationRun,
        release: project.release,
        lessons: project.lessons,
        nextQueue: project.nextQueue,
        ...sourceEvidence(project, "Copilot 回答用户问题时只读取与当前问题最相关的真实成果证据和当前运行状态"),
      },
    })));
  }, [project, run, runProjectAi, stage]);

  return {
    project,
    stage,
    setStage,
    status,
    gate,
    approveGate,
    goNext,
    compileAcceptanceRubric,
    updateAcceptanceCriterion,
    deleteAcceptanceCriterion,
    addAcceptanceCriterion,
    normalizeRubricWeights,
    refreshParsing,
    generateEvalSuite,
    updateTestCase,
    deleteTestCase,
    addTestCase,
    executeBaseline,
    analyzeProblems,
    selectProblem,
    diagnose,
    generatePlan,
    toggleCandidate,
    updateExperimentPolicy,
    recordSupplementalValidationEvidence,
    executeExperiment,
    generateExperimentAdvice,
    adoptExperimentAdvice,
    winner,
    executeValidation,
    requestValidation,
    validationRequestQueued,
    retryFailedValidation,
    retryFailedExperiment,
    releaseAction,
    reconcileRelease,
    distill,
    generateNextQueue,
    startNextRound,
    updateCampaign,
    updateAiProfile,
    setTargetConnection,
    setReleaseTarget,
    bindReleaseDeployment,
    runCampaignRound,
    runCampaign,
    runAutoPilot,
    revalidateAndContinue,
    resumeAutonomousEvolution,
    deepenUnderstanding,
    answerClarification,
    pauseCampaign,
    scheduleCampaign,
    materializeOutputs,
    rollbackToVersion,
    prepareChampionRelease,
    resetCampaign,
    askCopilot,
    commit,
  };
}

export type ProjectRuntime = ReturnType<typeof useProjectRuntime>;
