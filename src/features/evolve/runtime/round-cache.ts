import {COMPATIBLE_CHAT_OUTPUT_VERSION,STRUCTURED_AI_FINAL_OUTPUT_VERSION} from "@evolution/adapters";
import type { BaselineRun, EvaluationResult, EvolveProject, TargetRunResult } from "../schemas";
import { fastHash } from "../ai/performance";
import { searchBaseCandidate } from "./search-base";
import { baselineReadiness, campaignLiveObservationFresh, campaignObservesLiveTarget, campaignScoringInputFingerprint } from "@evolution/core";
import { resolveProjectOperationConnections } from "../ai/providers/registry";
import { getAiProviderStatus } from "../ai/service";

const VALIDATION_CONTRACT_VERSION = "criterion-scope-v2";

/** Stable scoring-route identity: Champion content may change between rounds, but the Judge/Executor contract may not. */
export function baselineScoringRouteFingerprint(project: EvolveProject): string {
  // Baseline 只依赖执行与评审模型。诊断、方案、交付等节点的模型切换不能让已建立的
  // Baseline 缓存失效，否则会把“切换当前节点模型”变成无意义的整轮重跑。
  const aiProfile = project.aiProfile ?? { mode: "global" as const };
  const baselineProfile = aiProfile.mode === "project" ? {
    mode: aiProfile.mode,
    primary: aiProfile.primary,
    builder: aiProfile.builder,
    judge: aiProfile.judge,
    operationRoutes: Object.fromEntries(["execute-artifact", "execute-artifact-batch", "evaluate", "evaluate-population"].flatMap((operation) => aiProfile.operationRoutes?.[operation] ? [[operation, aiProfile.operationRoutes[operation]]] : [])),
  } : aiProfile;
  const liveRoutes = (["execute-artifact", "execute-artifact-batch", "evaluate", "evaluate-population"] as const).map((operation) => {
    const routed = resolveProjectOperationConnections(operation, aiProfile)[0];
    if (routed) return [operation, routed.connection.id, routed.connection.providerId, routed.model, routed.resolved.baseUrl, STRUCTURED_AI_FINAL_OUTPUT_VERSION, ...(routed.resolved.preset.kind==="openai"?[COMPATIBLE_CHAT_OUTPUT_VERSION]:[])];
    const fallback = getAiProviderStatus(operation, { aiProfile });
    return [operation, fallback.connectionId ?? fallback.providerId, fallback.model, fallback.routeSource];
  });
  return fastHash(JSON.stringify([baselineProfile, liveRoutes]));
}

// 跨轮 Baseline 复用：同一项目里只要「考卷 + 进化对象 + 执行配置 + 已上线补丁」没变，
// 缓存表示同一条件下的一次历史观测，不表示随机模型每次输出必然相同。每轮重跑整份可见卷
// 和盲测对照卷，等于把最贵的执行/评审时间重复支付。指纹是唯一复用依据：
// 任何输入变化都会改变指纹，自动失效回真实重跑，不会拿旧结论冒充新证据。
export function baselineFingerprint(project: EvolveProject): string {
  const suite = project.evalSuite.map((item) => `${item.id}:${item.input}:${item.expected.join("|")}`).join("\n");
  const hidden = JSON.stringify(project.hiddenEvalSuite);
  const targets = project.sourceArtifacts
    .map((artifact) => `${artifact.id}:${artifact.role}:${fastHash(JSON.stringify([artifact.textContent ?? artifact.textExcerpt ?? "", artifact.structuredContent, artifact.artifactDescriptor]))}`)
    .join(",");
  const policy = `${project.experimentPolicy.batchArtifactRuntime}:${project.experimentPolicy.batchSize}`;
  const trustedChampion = searchBaseCandidate(project);
  const championBase = trustedChampion
    ? fastHash(JSON.stringify(trustedChampion.artifactSnapshots.map((item) => [item.sourceArtifactId, item.content])))
    : "root";
  const searchPatches = trustedChampion ? project.searchAppliedPatches ?? [] : [];
  const patches = `${project.appliedPatches.length}:${fastHash(JSON.stringify(project.appliedPatches))}:${searchPatches.length}:${fastHash(JSON.stringify(searchPatches))}:${championBase}`;
  const scoringRouteFingerprint = baselineScoringRouteFingerprint(project);
  const contract = JSON.stringify([campaignScoringInputFingerprint(project), project.evalSuite, project.goal, project.evolutionCommand, project.acceptanceRubric, project.protectedItems, project.inputClarifications, scoringRouteFingerprint, project.metrics?.map(({ key, target, direction }) => ({ key, target, direction }))]);
  return fastHash([VALIDATION_CONTRACT_VERSION, suite, hidden, targets, policy, patches, contract].join("::"));
}

/** Exact input, suite, and model binding recorded on a completed Baseline measurement. */
export function baselineMeasurementFingerprint(project: EvolveProject): string {
  return baselineFingerprint(project) + JSON.stringify(project.evalSuite);
}
/** Live Target holdout observations are comparable only within the same Campaign round. */
export function holdoutBaselineFingerprint(project: EvolveProject): string {
  const fingerprint = baselineFingerprint(project);
  return campaignObservesLiveTarget(project) ? `${fingerprint}:round-${project.campaign.currentRound + 1}` : fingerprint;
}

export type HoldoutBaselineCache = {
  /** Execution time, independent of when the same answer sheet was judged or cached again. */
  observedAt?: number;
  fingerprint: string;
  suiteIds: string[];
  runs: TargetRunResult[];
  evaluation: EvaluationResult;
};

// Exact fingerprint invalidation is the correctness boundary; keep it long enough to survive a
// multi-round autonomous run without repaying the same Baseline after a few slow model calls.
const MAX_CACHE_AGE_MS = 30 * 60 * 1000;
type VisibleEntry = { fingerprint: string; baseline: BaselineRun; cachedAt: number };

const VISIBLE_BASELINE = new Map<string, VisibleEntry>();
const HOLDOUT_BASELINE = new Map<string, HoldoutBaselineCache & { cachedAt: number }>();

// 内存级缓存：刷新页面自然失效（宁可重跑一次也不跨会话冒充证据），只省同一会话内的重复支付。
function remember<K, V>(map: Map<K, V>, key: K, value: V, cap = 8) {
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/** Only a diagnosis-ready measurement may skip the next round's real Baseline run. */
export function canReuseVisibleBaseline(project: EvolveProject, baseline: BaselineRun, nowMs = Date.now()): boolean {
  if (campaignObservesLiveTarget(project) && (project.campaign.checkpoint?.round !== project.campaign.currentRound + 1
    || !campaignLiveObservationFresh(project, baseline.completedAt, nowMs))) return false;
  return baseline.measurementFingerprint === baselineMeasurementFingerprint(project)
    && baselineReadiness({ ...project, baselineRun: baseline }).ready;
}
/** Existing Campaign scores are comparable only under their original Executor/Judge routes. */
export function campaignScoringRouteBlocker(project: EvolveProject): string | undefined {
  if (project.campaign.currentRound === 0) return undefined;
  if (project.campaign.scoringRouteFingerprint === baselineScoringRouteFingerprint(project)) return undefined;
  return "执行或评审模型路由已变化，旧 Campaign 的 Baseline、Champion 与轮次分数不可直接比较；请在自主进化中心点击「重置搜索」，再重新运行。生产发布状态不会被重置。";
}
/** A repair round may reuse a root cause only for the exact evidence and Target it analyzed. */
export function canReusePriorDiagnosis(project: EvolveProject): boolean {
  const previous = project.roundHistory.at(-1);
  return !campaignObservesLiveTarget(project)
    && project.campaign.noImprovementRounds === 1
    && Boolean(project.campaign.lastGapAdvice && project.diagnosis && project.selectedProblemId
      && project.problems.some((item) => item.id === project.selectedProblemId)
      && previous?.round === project.campaign.currentRound
      && previous.baselineMeasurementFingerprint
      && previous.baselineMeasurementFingerprint === baselineMeasurementFingerprint(project));
}
export function getVisibleBaseline(projectId: string, fingerprint: string): BaselineRun | undefined {
  const hit = VISIBLE_BASELINE.get(projectId);
  return hit && Date.now() - hit.cachedAt < MAX_CACHE_AGE_MS && hit.fingerprint === fingerprint ? structuredClone(hit.baseline) : undefined;
}

export function setVisibleBaseline(projectId: string, fingerprint: string, baseline: BaselineRun) {
  remember(VISIBLE_BASELINE, projectId, { fingerprint, baseline: structuredClone(baseline), cachedAt: Date.now() });
}

export function getHoldoutBaseline(projectId: string, fingerprint: string, maxAgeMs = MAX_CACHE_AGE_MS): HoldoutBaselineCache | undefined {
  const hit = HOLDOUT_BASELINE.get(projectId);
  const ageMs = hit ? Date.now() - (hit.observedAt ?? hit.cachedAt) : -1;
  return hit && ageMs >= 0 && ageMs < maxAgeMs && hit.fingerprint === fingerprint ? structuredClone(hit) : undefined;
}

export function setHoldoutBaseline(projectId: string, cache: HoldoutBaselineCache) {
  remember(HOLDOUT_BASELINE, projectId, { ...structuredClone(cache), observedAt: cache.observedAt ?? Date.now(), cachedAt: Date.now() });
}

/** 测试辅助：清空两个缓存（单测隔离用）。 */
export function clearRoundCaches() {
  VISIBLE_BASELINE.clear();
  HOLDOUT_BASELINE.clear();
}
