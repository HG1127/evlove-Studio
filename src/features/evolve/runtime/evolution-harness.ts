import type { AiOperation } from "../ai/schemas";
import { resolveProjectOperationConnections } from "../ai/providers/registry";
import type { EvolveProject } from "../schemas";
import { getTargetAdapter } from "../target/registry";
import { deriveAutonomousDecision, type AutonomousAction, type AutonomousDecision } from "./autonomous-orchestrator";
import { campaignPreflightStopReason } from "./evolution-search";
import { classifyRuntimeFailure, type FailureDisposition } from "@evolution/harness";
import { focusedSourceContext } from "./focused-task";
import { getRunTask, shouldResumeTask } from "./run-manager";

export const EVOLUTION_HARNESS_VERSION = "evolution-harness-v1";

export type HarnessPolicyMode = "auto" | "human" | "blocked";
export type HarnessRisk = "low" | "medium" | "high";
export type HarnessToolAvailability = "ready" | "local" | "unavailable";
export type HarnessSideEffect = "none" | "local-write" | "external-read" | "external-write" | "production-write";
export type HarnessEvidenceClass = "none" | "semantic" | "static" | "runtime" | "visual" | "outcome" | "state";

export type HarnessToolContract = {
  id: string;
  label: string;
  capability: string;
  availability: HarnessToolAvailability;
  sideEffect: HarnessSideEffect;
  risk: HarnessRisk;
  timeoutMs?: number;
  retryPolicy: "none" | "transient-only";
  evidenceClass: HarnessEvidenceClass;
  rollback: "none" | "checkpoint" | "artifact" | "target" | "production";
  note: string;
};

export type HarnessBudgetSnapshot = {
  rounds: { used: number; max: number; remaining: number };
  patience: { used: number; max: number; remaining: number };
  candidatesPerRound: number;
  cost: { used: number; max?: number; remaining?: number };
  wallTime: { elapsedMinutes?: number; maxMinutes?: number; remainingMinutes?: number };
  contextChars: number;
  loopGuard: { maxSteps: number };
  preflightStopReason?: string;
  exhausted: boolean;
};

export type HarnessContextPlan = {
  query: string;
  budgetChars: number;
  usedChars: number;
  totalArtifacts: number;
  selectedArtifacts: Array<{
    id: string;
    name: string;
    role: string;
    artifactKind: string;
    coverage: string;
    chars: number;
    indexedFiles?: number;
  }>;
  omittedArtifactIds: string[];
  memory: {
    lessons: number;
    archiveEntries: number;
    hasChampion: boolean;
    nextQueue: number;
  };
  evidence: {
    baselineRuns: number;
    experimentCandidates: number;
    validationRuns: number;
    validationStatus: string;
    acceptanceStatus: string;
    releaseStatus: string;
  };
  limitation: string;
};

export type HarnessCheckpoint = {
  id: string;
  projectId: string;
  stage: string;
  round: number;
  version: string;
  candidateId?: string;
  championId?: string;
  validationId?: string;
  releaseStatus: string;
  sourceRevision: string;
  task?: {
    kind: string;
    actionId?: string;
    label: string;
    interrupted: boolean;
    resumable: boolean;
  };
};

export type HarnessPolicyDecision = {
  mode: HarnessPolicyMode;
  risk: HarnessRisk;
  reason: string;
  requiresHuman: boolean;
  reversible: boolean;
};

export type HarnessModelRoute = {
  operation?: AiOperation;
  live: boolean;
  provider?: string;
  providerId?: string;
  model?: string;
  fallbackCount: number;
};

export type HarnessPlan = {
  version: typeof EVOLUTION_HARNESS_VERSION;
  decision: AutonomousDecision;
  operation?: AiOperation;
  policy: HarnessPolicyDecision;
  budget: HarnessBudgetSnapshot;
  context: HarnessContextPlan;
  tools: HarnessToolContract[];
  checkpoint: HarnessCheckpoint;
  modelRoute: HarnessModelRoute;
};

export type HarnessFailureRoute = {
  disposition: FailureDisposition;
  action: "retry" | "acquire-capability" | "request-human" | "replan" | "stop";
  explanation: string;
};

export const EVOLUTION_HARNESS_COMPONENTS = [
  { id: "mission-state", title: "Mission / State Manager", responsibility: "统一读取 Project、Campaign、Run Task 与 Checkpoint，决定从哪里继续。", status: "ready" },
  { id: "context-builder", title: "Context Builder", responsibility: "按当前动作动态检索最相关 Artifact / Evidence / Memory，并共享字符预算。", status: "ready" },
  { id: "planner-loop", title: "Planner / Agent Loop", responsibility: "领域状态机给出下一动作；Harness 在每一步重新计划，而不是一次生成固定长计划。", status: "ready" },
  { id: "tool-router", title: "Tool Router", responsibility: "统一描述 AI、Artifact、Target Runner、Evidence 与 Release Tool 的能力、风险和副作用。", status: "ready" },
  { id: "policy", title: "Policy / Human Gate", responsibility: "高影响或不可逆动作升级给人；低风险可逆动作自动继续。", status: "ready" },
  { id: "budget", title: "Budget / Stop Manager", responsibility: "统一轮数、成本、时间、Patience、Candidate 数量和 Agent Loop 上限。", status: "ready" },
  { id: "failure", title: "Failure Router", responsibility: "区分瞬时故障、能力缺失、输入问题、安全边界和逻辑错误，选择 Retry / Replan / Human。", status: "ready" },
  { id: "checkpoint", title: "Checkpoint / Resume", responsibility: "把现有 Project 持久化与 Run Task 恢复收敛为可复现的 Harness Checkpoint。", status: "local" },
  { id: "observability", title: "Observability / Evidence", responsibility: "让每次执行都关联 Artifact、Trace、验证状态和下一 Gate；未来迁入不可篡改 Ledger。", status: "local" },
] as const;

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function operationForAction(action: AutonomousAction): AiOperation | undefined {
  switch (action) {
    case "understand": return "intake";
    case "compile-contract": return "rubric";
    case "build-eval": return "eval-suite";
    case "run-campaign": return "plan";
    case "revalidate": return "evaluate";
    case "package": return "materialize";
    case "distill": return "distill";
    case "next-queue": return "next-queue";
    default: return undefined;
  }
}

function contextBudgetForAction(action: AutonomousAction) {
  if (action === "run-campaign") return 24_000;
  if (action === "revalidate" || action === "compile-contract" || action === "build-eval") return 18_000;
  if (action === "understand") return 14_000;
  if (action === "distill" || action === "next-queue") return 12_000;
  return 8_000;
}

export function buildHarnessBudget(project: EvolveProject, decision?: AutonomousDecision): HarnessBudgetSnapshot {
  const campaign = project.campaign;
  const criteria = campaign.stopCriteria;
  const elapsedMinutes = campaign.startedAt
    ? Math.max(0, (Date.now() - new Date(campaign.startedAt).getTime()) / 60_000)
    : undefined;
  const remainingCost = criteria.maxEstimatedCost === undefined
    ? undefined
    : Math.max(0, criteria.maxEstimatedCost - campaign.estimatedCost);
  const remainingMinutes = criteria.maxWallMinutes === undefined || elapsedMinutes === undefined
    ? undefined
    : Math.max(0, criteria.maxWallMinutes - elapsedMinutes);
  const preflightStopReason = decision?.action === "run-campaign" ? campaignPreflightStopReason(project) : undefined;
  return {
    rounds: {
      used: campaign.currentRound,
      max: criteria.maxRounds,
      remaining: Math.max(0, criteria.maxRounds - campaign.currentRound),
    },
    patience: {
      used: campaign.noImprovementRounds,
      max: criteria.patienceRounds,
      remaining: Math.max(0, criteria.patienceRounds - campaign.noImprovementRounds),
    },
    candidatesPerRound: campaign.candidateCount,
    cost: {
      used: campaign.estimatedCost,
      max: criteria.maxEstimatedCost,
      remaining: remainingCost,
    },
    wallTime: {
      elapsedMinutes,
      maxMinutes: criteria.maxWallMinutes,
      remainingMinutes,
    },
    contextChars: decision ? contextBudgetForAction(decision.action) : 8_000,
    loopGuard: { maxSteps: 32 },
    preflightStopReason,
    exhausted: Boolean(preflightStopReason),
  };
}

export function buildHarnessContext(project: EvolveProject, decision: AutonomousDecision): HarnessContextPlan {
  const budgetChars = contextBudgetForAction(decision.action);
  const query = [
    project.evolutionCommand,
    project.goal,
    decision.reason,
    project.diagnosis?.rootCause,
    project.problems.find((item) => item.id === project.selectedProblemId)?.title,
  ].filter(Boolean).join(" ");
  const focused = focusedSourceContext(project, query, budgetChars);
  return {
    query,
    budgetChars,
    usedChars: focused.usedChars,
    totalArtifacts: focused.totalArtifacts,
    selectedArtifacts: focused.sources.map((source) => ({
      id: source.id,
      name: source.name,
      role: source.role,
      artifactKind: source.artifactKind,
      coverage: source.coverage,
      chars: source.textContent.length,
      indexedFiles: source.indexedFiles,
    })),
    omittedArtifactIds: focused.omittedArtifactIds,
    memory: {
      lessons: project.lessons.length,
      archiveEntries: project.evolutionArchive.length,
      hasChampion: Boolean(project.searchChampion),
      nextQueue: project.nextQueue.length,
    },
    evidence: {
      baselineRuns: project.baselineRun.runs.length,
      experimentCandidates: project.experimentRun.candidateResults.length,
      validationRuns: project.validationRun.runs.length,
      validationStatus: project.validationRun.status,
      acceptanceStatus: project.artifactAcceptance.status,
      releaseStatus: project.release.status,
    },
    limitation: focused.limitation,
  };
}

export function buildHarnessCheckpoint(project: EvolveProject): HarnessCheckpoint {
  const task = getRunTask(project.id);
  const sourceRevision = project.sourceArtifacts
    .map((artifact) => `${artifact.id}:${artifact.createdAt}:${artifact.size}:${artifact.parseStatus}`)
    .join("|");
  const candidateId = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
  const fingerprint = [
    project.id,
    project.stage,
    project.campaign.currentRound,
    project.version,
    candidateId ?? "",
    project.searchChampion?.id ?? "",
    project.validationRun.id,
    project.artifactAcceptance.id,
    project.release.status,
    sourceRevision,
  ].join("|");
  return {
    id: `harness-cp-${stableHash(fingerprint)}`,
    projectId: project.id,
    stage: project.stage,
    round: project.campaign.currentRound,
    version: project.version,
    candidateId,
    championId: project.searchChampion?.id,
    validationId: project.validationRun.id,
    releaseStatus: project.release.status,
    sourceRevision: stableHash(sourceRevision),
    task: task ? {
      kind: task.kind,
      actionId: task.actionId,
      label: task.label,
      interrupted: Boolean(task.interrupted),
      resumable: shouldResumeTask(task),
    } : undefined,
  };
}

function policyFor(decision: AutonomousDecision, budget: HarnessBudgetSnapshot): HarnessPolicyDecision {
  if (budget.preflightStopReason) {
    return {
      mode: "blocked",
      risk: "medium",
      reason: budget.preflightStopReason,
      requiresHuman: true,
      reversible: true,
    };
  }
  if (decision.action === "wait-human") {
    return {
      mode: "human",
      risk: decision.attention?.riskLevel ?? "medium",
      reason: decision.reason,
      requiresHuman: true,
      reversible: false,
    };
  }
  const medium = ["run-campaign", "package", "approve-contract", "revalidate"].includes(decision.action);
  return {
    mode: "auto",
    risk: medium ? "medium" : "low",
    reason: medium ? "动作可自动执行，但必须遵守当前 Budget / Evidence / Gate 约束" : "低风险、可恢复的机器动作",
    requiresHuman: false,
    reversible: true,
  };
}

function modelRoute(project: EvolveProject, operation?: AiOperation): HarnessModelRoute {
  if (!operation) return { live: false, fallbackCount: 0 };
  const routes = resolveProjectOperationConnections(operation, project.aiProfile);
  const primary = routes[0];
  return {
    operation,
    live: Boolean(primary),
    provider: primary?.connection.label,
    providerId: primary?.connection.providerId,
    model: primary?.model,
    fallbackCount: Math.max(0, routes.length - 1),
  };
}

function toolContracts(project: EvolveProject, operation?: AiOperation): HarnessToolContract[] {
  const adapter = getTargetAdapter(project);
  const route = modelRoute(project, operation);
  const targetAvailability: HarnessToolAvailability = adapter.live
    ? (project.targetConnection.status === "connected" ? "ready" : "unavailable")
    : "local";
  return [
    {
      id: "context-builder",
      label: "Context Builder",
      capability: "按当前动作检索 Artifact / Repository / Evidence / Memory",
      availability: project.sourceArtifacts.length ? "local" : "unavailable",
      sideEffect: "none",
      risk: "low",
      retryPolicy: "none",
      evidenceClass: "state",
      rollback: "none",
      note: "共享字符预算；不会因附件数量线性放大 Prompt。",
    },
    {
      id: "model-router",
      label: "AI Model Router",
      capability: operation ? `执行 ${operation} 节点并按健康度/回退链选模型` : "当前动作无需模型",
      availability: operation ? (route.live ? "ready" : "local") : "local",
      sideEffect: "none",
      risk: "low",
      retryPolicy: "transient-only",
      evidenceClass: "semantic",
      rollback: "checkpoint",
      note: route.live ? `${route.provider ?? "provider"} · ${route.model ?? "model"}` : "没有真实模型路由时只能使用本地/演示能力，不能升级真实证据等级。",
    },
    {
      id: "target-adapter",
      label: adapter.name,
      capability: "对当前 Target 执行 Baseline / Candidate / Hidden Validation",
      availability: targetAvailability,
      sideEffect: adapter.live ? "external-read" : "local-write",
      risk: adapter.live ? "medium" : "low",
      retryPolicy: "transient-only",
      evidenceClass: adapter.live ? "runtime" : "static",
      rollback: adapter.live ? "target" : "artifact",
      note: adapter.live ? "真实 Target Runner" : "本地 Artifact/Mock Runtime；外部行为必须保持 UNVERIFIED。",
    },
    {
      id: "evidence-runtime",
      label: "Evidence Runtime",
      capability: "Hash / Trace / Browser / Screenshot / Visual / Acceptance 证据编排",
      availability: "local",
      sideEffect: "local-write",
      risk: "low",
      retryPolicy: "transient-only",
      evidenceClass: "runtime",
      rollback: "checkpoint",
      note: "当前证据持久化主要在浏览器；未来迁入 Immutable Evidence Ledger。",
    },
    {
      id: "state-checkpoint",
      label: "State / Checkpoint",
      capability: "持久化 Mission / Campaign / Run Task 并从中断处恢复",
      availability: "local",
      sideEffect: "local-write",
      risk: "low",
      retryPolicy: "none",
      evidenceClass: "state",
      rollback: "checkpoint",
      note: "当前跨刷新恢复已可用；关闭浏览器后继续执行仍需要 Server-side Control Plane。",
    },
    {
      id: "release-runtime",
      label: "Release / Outcome",
      capability: "Shadow / Canary / Promote / Rollback / Telemetry",
      availability: adapter.live && adapter.release ? targetAvailability : "unavailable",
      sideEffect: "production-write",
      risk: "high",
      retryPolicy: "none",
      evidenceClass: "outcome",
      rollback: "production",
      note: adapter.live && adapter.release ? "仅在 Release Gate 后执行真实生产动作。" : "未连接真实 Production Release 能力。",
    },
  ];
}

export function routeHarnessFailure(error: unknown): HarnessFailureRoute {
  const disposition = classifyRuntimeFailure(error);
  if (disposition.kind === "transient-system" && disposition.retryable) {
    return { disposition, action: "retry", explanation: "由 Harness 按退避策略重试幂等步骤。" };
  }
  if (disposition.kind === "capability") {
    return { disposition, action: "acquire-capability", explanation: "保留当前 Candidate / Checkpoint，补齐 Runner、视觉或其他外部能力后继续。" };
  }
  if (disposition.kind === "safety" || disposition.kind === "input") {
    return { disposition, action: "request-human", explanation: "该问题不能靠盲目重试解决，需要用户补充输入或批准高影响动作。" };
  }
  if (disposition.kind === "logic") {
    return { disposition, action: "replan", explanation: "保留失败证据，返回诊断/计划层更换机制，而不是重复同一调用。" };
  }
  return { disposition, action: "stop", explanation: "任务已被取消或不适合自动恢复。" };
}

export function inspectEvolutionHarness(project: EvolveProject): HarnessPlan {
  const decision = deriveAutonomousDecision(project);
  const operation = operationForAction(decision.action);
  const budget = buildHarnessBudget(project, decision);
  return {
    version: EVOLUTION_HARNESS_VERSION,
    decision,
    operation,
    policy: policyFor(decision, budget),
    budget,
    context: buildHarnessContext(project, decision),
    tools: toolContracts(project, operation),
    checkpoint: buildHarnessCheckpoint(project),
    modelRoute: modelRoute(project, operation),
  };
}

export const evolutionHarness = {
  version: EVOLUTION_HARNESS_VERSION,
  plan: inspectEvolutionHarness,
  inspect: inspectEvolutionHarness,
  routeFailure: routeHarnessFailure,
  checkpoint: buildHarnessCheckpoint,
  context: buildHarnessContext,
  budget: buildHarnessBudget,
};
