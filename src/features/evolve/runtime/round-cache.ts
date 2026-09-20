import type { BaselineRun, EvaluationResult, EvolveProject, TargetRunResult } from "../schemas";
import { fastHash } from "../ai/performance";
import { searchBaseCandidate } from "./search-base";

const VALIDATION_CONTRACT_VERSION = "criterion-scope-v2";

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
  const contract = JSON.stringify([project.evalSuite, project.goal, project.evolutionCommand, project.acceptanceRubric, project.protectedItems, project.inputClarifications, baselineProfile, project.targetConnection, project.metrics?.map(({ key, target, direction }) => ({ key, target, direction }))]);
  return fastHash([VALIDATION_CONTRACT_VERSION, suite, hidden, targets, policy, patches, contract].join("::"));
}

export type HoldoutBaselineCache = {
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

export function getVisibleBaseline(projectId: string, fingerprint: string): BaselineRun | undefined {
  const hit = VISIBLE_BASELINE.get(projectId);
  return hit && Date.now() - hit.cachedAt < MAX_CACHE_AGE_MS && hit.fingerprint === fingerprint ? structuredClone(hit.baseline) : undefined;
}

export function setVisibleBaseline(projectId: string, fingerprint: string, baseline: BaselineRun) {
  remember(VISIBLE_BASELINE, projectId, { fingerprint, baseline: structuredClone(baseline), cachedAt: Date.now() });
}

export function getHoldoutBaseline(projectId: string, fingerprint: string): HoldoutBaselineCache | undefined {
  const hit = HOLDOUT_BASELINE.get(projectId);
  return hit && Date.now() - hit.cachedAt < MAX_CACHE_AGE_MS && hit.fingerprint === fingerprint ? structuredClone(hit) : undefined;
}

export function setHoldoutBaseline(projectId: string, cache: HoldoutBaselineCache) {
  remember(HOLDOUT_BASELINE, projectId, { ...structuredClone(cache), cachedAt: Date.now() });
}

/** 测试辅助：清空两个缓存（单测隔离用）。 */
export function clearRoundCaches() {
  VISIBLE_BASELINE.clear();
  HOLDOUT_BASELINE.clear();
}
