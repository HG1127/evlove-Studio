import {AiModelIdSchema} from "@evolution/contracts";
import type { AiOperation } from "../schemas";
import type { ProjectAiProfile, ProjectModelRoute } from "../../schemas";
import {
  BYOK_PROVIDERS,
  getByokConfig,
  getPreset,
  normalizeBaseUrl,
  type ByokProviderPreset,
  type ResolvedByok,
} from "./byok";
import { orderModelCandidates } from "./model-health";

export type ProviderConnection = {
  id: string;
  providerId: string;
  label: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  models: string[];
  /** 一键筛选后置真：模型列表只保留批量测试通过的，读取时不再补供应商兜底模型清单。 */
  modelsExact?: boolean;
  lastModelSyncAt?: string;
  lastTestAt?: string;
  lastTestStatus?: "ok" | "error";
  lastTestMessage?: string;
  /** 连接测试成功过的模型 ID，最近测通的排最前；用于「一键切换」快捷入口。 */
  testedModels?: string[];
  /** 每个模型最近一次实测延迟（毫秒）：连接测试与真实调用都会刷新。路由排序时同等可用优先低延迟。 */
  modelLatency?: Record<string, number>;
  /** 模型备注名（如「主力生成」「独立评测」）：下拉列表里跟随显示，并参与搜索匹配。 */
  modelNotes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type AiRoute = {
  connectionId?: string;
  model?: string;
  fallbackConnectionIds: string[];
};

export type AiRoutingPolicy = {
  mode: "single" | "specialized" | "independent-eval";
  operationRoutes: Partial<Record<AiOperation, AiRoute>>;
  defaultRoute?: AiRoute;
  requireIndependentEvaluator: boolean;
  fallbackToDemo: boolean;
};

export type RoutedAiConnection = {
  connection: ProviderConnection;
  preset: ByokProviderPreset;
  model: string;
  resolved: ResolvedByok;
  routeSource: "operation" | "default" | "first-enabled";
};

const CONNECTIONS_KEY = "evolve-studio:provider-connections:v2";
const ROUTING_KEY = "evolve-studio:ai-routing:v2";
const MIGRATED_KEY = "evolve-studio:provider-migration:v2";

const FALLBACK_MODELS: Record<string, string[]> = {
  openai: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  anthropic: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  gemini: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"],
  xai: ["grok-4.6", "grok-4-latest"],
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
  openrouter: ["openrouter/auto"],
  opencode: ["muse-spark-1.3-contributor-free"],
  moonshot: ["kimi-latest"],
  dashscope: ["qwen-plus"],
  zai: ["glm-4.7"],
  mistral: ["mistral-large-latest"],
  custom: [],
};

export const OPERATION_META: Record<AiOperation, { label: string; role: string; purpose: string }> = {
  intake: { label: "输入理解", role: "Architect", purpose: "读取附件与命令，理解进化对象" },
  understand: { label: "深度理解", role: "Architect", purpose: "复述真实意图、隐含要求与待确认歧义" },
  command: { label: "连续命令", role: "Architect", purpose: "理解用户新增要求并更新范围" },
  target: { label: "目标契约", role: "Architect", purpose: "生成 Evolve Contract 与保护边界" },
  "eval-suite": { label: "评测集生成", role: "Evaluator Designer", purpose: "生成 Validation / Holdout / Edge Cases" },
  "problem-analysis": { label: "问题发现", role: "Analyst", purpose: "从 Baseline 和 Trace 识别问题簇" },
  diagnose: { label: "根因诊断", role: "Critic", purpose: "定位根因、证据与反证条件" },
  plan: { label: "候选生成", role: "Evolution Generator", purpose: "生成多种 Mutation Hypothesis 与 Candidate" },
  rubric: { label: "验收规则", role: "Acceptance Designer", purpose: "把用户目标转换成机器可验证 Rubric" },
  "build-candidate": { label: "Candidate 构造", role: "Artifact Builder", purpose: "先构造完整 Candidate Artifact，再进入评测" },
  "artifact-acceptance": { label: "成果验收", role: "Acceptance Judge", purpose: "逐条验证最终 Artifact 是否满足原始目标" },
  "repair-artifact": { label: "成果修复", role: "Repair Agent", purpose: "根据失败验收项修复完整 Artifact" },
  "execute-artifact": { label: "Artifact 执行", role: "Executor", purpose: "运行单个上传型 Artifact 测试" },
  "execute-artifact-batch": { label: "批量 Artifact 执行", role: "Batch Executor", purpose: "同一 Candidate 一次执行多道测试，复用上下文降低延迟" },
  "evaluate-population": { label: "候选预筛", role: "Population Judge", purpose: "Successive Halving 预筛 Candidate，只让 Finalist 进入重型实验" },
  materialize: { label: "成果物生成", role: "Artifact Builder", purpose: "把 Best-Ever Search Champion 物化成可下载成果" },
  "release-review": { label: "发布审查", role: "Release Judge", purpose: "检查 Winner 是否有资格进入 Shadow / Canary" },
  distill: { label: "经验提炼", role: "Knowledge Distiller", purpose: "提炼 Lesson / Skill / Anti-pattern" },
  "next-queue": { label: "下一轮生成", role: "Curriculum Planner", purpose: "生成 Next Evolve Queue" },
  copilot: { label: "Evolve Copilot", role: "Copilot", purpose: "解释证据、回答问题、建议下一步" },
  evaluate: { label: "独立评测", role: "Independent Judge", purpose: "独立评分 Candidate 输出，避免生成者自评" },
  "gap-cluster": { label: "差距归因", role: "Evaluator Analyst", purpose: "按共同失败机制归类回归/失败题目" },
  "gap-advice": { label: "优化建议", role: "Evolution Advisor", purpose: "把验证差距翻译成具体优化动作" },
  "visual-judge": { label: "视觉评审", role: "Visual Judge", purpose: "基于浏览器截图评审 UI/UX 并产出视觉证据" },
};

function now() { return new Date().toISOString(); }
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function readStorageItem(key: string): string | null {
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}

function defaultRouting(): AiRoutingPolicy {
  return {
    mode: "independent-eval",
    operationRoutes: {},
    requireIndependentEvaluator: true,
    fallbackToDemo: false,
  };
}

// Compatibility shim: explicitly committed provider IDs use the shared boundary contract.
// Search text stays local to the combobox until the user commits; availability comes from actual calls.
export function isPlausibleModelId(id: string): boolean {
  return AiModelIdSchema.safeParse(id).success;
}

function normalizeModels(providerId: string, models: string[], defaultModel: string, exact = false) {
  const base = exact ? models : [...(FALLBACK_MODELS[providerId] ?? []), ...models];
  return [...new Set([defaultModel, ...base].filter((model) => isPlausibleModelId(model)).map(model=>model.trim()))];
}

export function getProviderFallbackModels(providerId: string) {
  return [...(FALLBACK_MODELS[providerId] ?? [])];
}

export function migrateLegacyProviderOnce() {
  if (typeof window === "undefined") return;
  let storage: Storage;
  let migrated: string | null;
  let existing: ProviderConnection[];
  try {
    storage = window.localStorage;
    migrated = storage.getItem(MIGRATED_KEY);
    existing = safeParse<ProviderConnection[]>(storage.getItem(CONNECTIONS_KEY), []);
  } catch { return; }
  if (migrated) return;
  if (!existing.length) {
    const legacy = getByokConfig();
    if (legacy?.apiKey) {
      const preset = getPreset(legacy.providerId);
      const model = legacy.model || preset.defaultModel;
      const item: ProviderConnection = {
        id: `conn-${crypto.randomUUID()}`,
        providerId: legacy.providerId,
        label: preset.name,
        enabled: legacy.enabled,
        apiKey: legacy.apiKey,
        baseUrl: legacy.baseUrl,
        defaultModel: model,
        models: normalizeModels(legacy.providerId, [], model),
        createdAt: now(),
        updatedAt: now(),
      };
      try {
        // Write routing first. A failed second write can be retried without marking migration complete.
        storage.setItem(ROUTING_KEY, JSON.stringify({ ...defaultRouting(), defaultRoute: { connectionId: item.id, model, fallbackConnectionIds: [] } }));
        storage.setItem(CONNECTIONS_KEY, JSON.stringify([item]));
      } catch { return; }
    }
  }
  try { storage.setItem(MIGRATED_KEY, "1"); }
  catch { /* Retry migration when browser storage becomes writable. */ }
}

export function listProviderConnections(): ProviderConnection[] {
  if (typeof window === "undefined") return [];
  migrateLegacyProviderOnce();
  return safeParse<ProviderConnection[]>(readStorageItem(CONNECTIONS_KEY), [])
    .map((item) => {
      const models = normalizeModels(item.providerId, item.models ?? [], item.defaultModel, item.modelsExact);
      const testedModels = (item.testedModels ?? []).filter((model) => isPlausibleModelId(model)).map(model=>model.trim());
      // Only empty/oversized stored IDs need fallback; short provider IDs remain valid.
      const defaultModel = isPlausibleModelId(item.defaultModel) ? item.defaultModel.trim() : (testedModels[0] ?? models[0] ?? "");
      return { ...item, models, testedModels, defaultModel };
    });
}

export function saveProviderConnections(items: ProviderConnection[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("evolve-ai-connections-changed"));
}

export function upsertProviderConnection(input: Omit<ProviderConnection, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }) {
  const items = listProviderConnections();
  const current = items.find((item) => item.id === input.id);
  const next: ProviderConnection = {
    ...input,
    models: normalizeModels(input.providerId, input.models ?? [], input.defaultModel, input.modelsExact),
    createdAt: input.createdAt ?? current?.createdAt ?? now(),
    updatedAt: now(),
  };
  saveProviderConnections([next, ...items.filter((item) => item.id !== next.id)]);
  return next;
}

/** 一键筛选落库：模型列表只保留批量测试通过的（modelsExact=true），默认模型回落到第一个可用模型。 */
export function pruneConnectionToTested(connection: ProviderConnection, passed: string[], latency?: Record<string, number>): ProviderConnection {
  const items = listProviderConnections();
  const current = items.find((item) => item.id === connection.id);
  if (!current) return connection;
  const models = [...new Set(passed.filter((model) => isPlausibleModelId(model)).map(model=>model.trim()))];
  const defaultModel = models.includes(current.defaultModel) ? current.defaultModel : models[0] ?? current.defaultModel;
  const modelLatency = { ...current.modelLatency, ...(latency ?? {}) };
  const next: ProviderConnection = {
    ...current,
    models,
    defaultModel,
    modelsExact: true,
    testedModels: models.slice(0, 12),
    modelLatency,
    lastTestAt: now(),
    lastTestStatus: models.length ? "ok" : "error",
    lastTestMessage: models.length ? `批量测试通过 ${models.length} 个模型，已仅保留可用模型` : current.lastTestMessage,
    updatedAt: now(),
  };
  saveProviderConnections([next, ...items.filter((item) => item.id !== next.id)]);
  return next;
}

/** 记录某个模型在本连接上测试通过：置顶去重、最多保留 12 个，并并入模型列表。 */
export function noteModelTested(connection: ProviderConnection, model: string, message?: string, latencyMs?: number) {
  const parsed=AiModelIdSchema.safeParse(model);
  if (!parsed.success) return connection;
  model=parsed.data;
  const testedModels = [model, ...(connection.testedModels ?? []).filter((item) => item !== model)].slice(0, 12);
  return upsertProviderConnection({
    ...connection,
    models: [...connection.models, model],
    testedModels,
    modelLatency: latencyMs && latencyMs > 0 ? { ...connection.modelLatency, [model]: latencyMs } : connection.modelLatency,
    lastTestAt: now(),
    lastTestStatus: "ok",
    lastTestMessage: message ?? connection.lastTestMessage,
  });
}

/** 真实调用成功后回写延迟：不只在「测试」时测延迟，日常运行的实测值让路由排序始终跟最新网络状况走。 */
export function noteModelLatency(connectionId: string, model: string, latencyMs: number) {
  if (typeof window === "undefined") return;
  const parsed=AiModelIdSchema.safeParse(model);
  if (!parsed.success || !(latencyMs > 0)) return;
  model=parsed.data;
  const items = listProviderConnections();
  const current = items.find((item) => item.id === connectionId);
  if (!current) return;
  const prev = current.modelLatency?.[model];
  // 指数滑动平均：既反映最新状况，又不被单次抖动带偏。
  const smoothed = prev ? Math.round(prev * 0.5 + latencyMs * 0.5) : latencyMs;
  // 保序写回（不用 upsert，避免每次调用把连接重排到列表首位造成 UI 抖动）。
  saveProviderConnections(items.map((item) => item.id === connectionId
    ? { ...item, modelLatency: { ...item.modelLatency, [model]: smoothed } }
    : item));
}

export function createProviderConnection(providerId = "openai"): ProviderConnection {
  const preset = getPreset(providerId);
  const defaultModel = getProviderFallbackModels(providerId)[0] || preset.defaultModel;
  return {
    id: `conn-${crypto.randomUUID()}`,
    providerId,
    label: preset.name,
    enabled: true,
    apiKey: "",
    baseUrl: undefined,
    defaultModel,
    models: normalizeModels(providerId, [], defaultModel),
    createdAt: now(),
    updatedAt: now(),
  };
}

export function deleteProviderConnection(id: string) {
  const next = listProviderConnections().filter((item) => item.id !== id);
  saveProviderConnections(next);
  const policy = getAiRoutingPolicy();
  const operationRoutes = Object.fromEntries(Object.entries(policy.operationRoutes).filter(([, route]) => route?.connectionId !== id)) as AiRoutingPolicy["operationRoutes"];
  const defaultRoute = policy.defaultRoute?.connectionId === id ? undefined : policy.defaultRoute;
  saveAiRoutingPolicy({ ...policy, operationRoutes, defaultRoute });
}

export function getAiRoutingPolicy(): AiRoutingPolicy {
  if (typeof window === "undefined") return defaultRouting();
  migrateLegacyProviderOnce();
  return { ...defaultRouting(), ...safeParse<AiRoutingPolicy>(readStorageItem(ROUTING_KEY), defaultRouting()) };
}

export function saveAiRoutingPolicy(policy: AiRoutingPolicy) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ROUTING_KEY, JSON.stringify(policy));
  window.dispatchEvent(new CustomEvent("evolve-ai-routing-changed"));
}

/** 用户自存的「常用路由方案」：整套路由策略命名保存，随时一键套用。 */
export type SavedRoutingPreset = { id: string; name: string; note?: string; savedAt: string; policy: AiRoutingPolicy };

const USER_PRESETS_KEY = "evolve-studio:user-routing-presets:v1";

export function listSavedRoutingPresets(): SavedRoutingPreset[] {
  if (typeof window === "undefined") return [];
  return safeParse<SavedRoutingPreset[]>(readStorageItem(USER_PRESETS_KEY), [])
    .filter((item) => item?.id && item?.policy);
}

/** 同名覆盖旧方案，方便“改完路由重新保存”的心智。 */
export function saveRoutingPreset(name: string, policy: AiRoutingPolicy, note?: string): SavedRoutingPreset {
  const items = listSavedRoutingPresets();
  const existing = items.find((item) => item.name === name);
  const item: SavedRoutingPreset = { id: existing?.id ?? `preset-${crypto.randomUUID()}`, name, note: note?.trim() || undefined, savedAt: now(), policy };
  window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify([item, ...items.filter((x) => x.name !== name)]));
  return item;
}

export function deleteRoutingPreset(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(listSavedRoutingPresets().filter((item) => item.id !== id)));
}

function routeFor(operation: AiOperation, policy: AiRoutingPolicy): AiRoute | undefined {
  const route = policy.operationRoutes[operation] ?? policy.defaultRoute;
  if (!route) return undefined;
  // Preserve the exact committed model ID after trimming, without inferring a provider name.
  if (!route.model) return route;
  const parsed=AiModelIdSchema.safeParse(route.model);
  return {...route,model:parsed.success?parsed.data:undefined};
}

export function resolveOperationConnection(operation: AiOperation): RoutedAiConnection | null {
  const connections = listProviderConnections().filter((item) => item.enabled && item.apiKey.trim());
  if (!connections.length) return null;
  const policy = getAiRoutingPolicy();
  const explicit = policy.operationRoutes[operation];
  const route = routeFor(operation, policy);
  let connection = route?.connectionId ? connections.find((item) => item.id === route.connectionId) : undefined;
  let source: RoutedAiConnection["routeSource"] = explicit ? "operation" : "default";
  if (!connection) {
    connection = connections[0];
    source = "first-enabled";
  }
  if (!connection) return null;
  const preset = getPreset(connection.providerId);
  const model = route?.model || connection.defaultModel || preset.defaultModel;
  const baseUrl = normalizeBaseUrl(connection.baseUrl?.trim() || preset.defaultBaseUrl);
  if (!baseUrl) return null;
  return {
    connection,
    preset,
    model,
    routeSource: source,
    resolved: {
      preset,
      config: {
        enabled: true,
        providerId: connection.providerId,
        apiKey: connection.apiKey,
        baseUrl: connection.baseUrl,
        model,
      },
      baseUrl,
    },
  };
}


export function resolveOperationConnections(operation: AiOperation): RoutedAiConnection[] {
  const connections = listProviderConnections().filter((item) => item.enabled && item.apiKey.trim());
  if (!connections.length) return [];
  const policy = getAiRoutingPolicy();
  const explicit = policy.operationRoutes[operation];
  const route = routeFor(operation, policy);
  const orderedIds = [route?.connectionId, ...(route?.fallbackConnectionIds ?? []), ...connections.map((item) => item.id)].filter(Boolean) as string[];
  const uniqueIds = [...new Set(orderedIds)];
  const results: RoutedAiConnection[] = [];
  for (const id of uniqueIds) {
    const connection = connections.find((item) => item.id === id);
    if (!connection) continue;
    const preset = getPreset(connection.providerId);
    const isPrimary = id === route?.connectionId;
    const baseUrl = normalizeBaseUrl(connection.baseUrl?.trim() || preset.defaultBaseUrl);
    if (!baseUrl) continue;
    // 同一连接内的回退链：首选模型跑不通时优先试本连接测试通过的模型，
    // 让「某个模型跑不通自动切换可用模型」在不人工干预的情况下成立。
    // 排序叠加模型健康记忆（近期连续失败的降到链尾）与实测延迟（同等可用优先快的）。
    const tested = (connection.testedModels ?? []).filter(Boolean);
    const primaryModel = isPrimary && route?.model ? route.model : connection.defaultModel || preset.defaultModel;
    const fallbackModels = orderModelCandidates(connection.id, [...new Set([...tested, connection.defaultModel].filter(model => Boolean(model) && model !== primaryModel))], connection.modelLatency);
    // The route model is a user selection for this node. Health memory may order fallbacks, but
    // must never silently replace the selected model before it has been attempted.
    const modelCandidates = [primaryModel, ...fallbackModels].filter(Boolean).slice(0, isPrimary ? 3 : 2);
    for (const model of modelCandidates) {
      results.push({
        connection, preset, model,
        routeSource: isPrimary ? (explicit ? "operation" : "default") : "first-enabled",
        resolved: { preset, config: { enabled: true, providerId: connection.providerId, apiKey: connection.apiKey, baseUrl: connection.baseUrl, model }, baseUrl },
      });
    }
  }
  return results;
}


export type TestedModelChoice = { connectionId: string; providerId: string; providerName: string; model: string; label: string; note?: string };

export function listTestedModelChoices(): TestedModelChoice[] {
  return listProviderConnections().filter((connection) => connection.enabled && connection.apiKey.trim() && connection.lastTestStatus === "ok").flatMap((connection) => {
    const models = connection.testedModels?.length ? connection.testedModels : [connection.defaultModel].filter(Boolean);
    return [...new Set(models)].map((model) => ({ connectionId: connection.id, providerId: connection.providerId, providerName: connection.label, model, label: `${connection.label} · ${connection.modelNotes?.[model] || model}`, note: connection.modelNotes?.[model] }));
  });
}

function projectRouteForOperation(operation: AiOperation, profile?: ProjectAiProfile): ProjectModelRoute | undefined {
  if (!profile || profile.mode !== "project") return undefined;
  const operationRoute = profile.operationRoutes?.[operation];
  if (operationRoute) return operationRoute;
  if (operation === "copilot") return profile.copilot ?? profile.primary;
  if (["evaluate","evaluate-population","eval-suite","rubric","artifact-acceptance","release-review","gap-cluster"].includes(operation)) return profile.judge ?? profile.primary;
  if (["build-candidate","repair-artifact","materialize","execute-artifact","execute-artifact-batch"].includes(operation)) return profile.builder ?? profile.primary;
  return profile.primary;
}

export function resolveProjectOperationConnections(operation: AiOperation, profile?: ProjectAiProfile): RoutedAiConnection[] {
  const route = projectRouteForOperation(operation, profile);
  if (!route) return resolveOperationConnections(operation);
  const connections = listProviderConnections().filter((item) => item.enabled && item.apiKey.trim());
  const connection = connections.find((item) => item.id === route.connectionId);
  if (!connection) return resolveOperationConnections(operation);
  const preset = getPreset(connection.providerId);
  const baseUrl = normalizeBaseUrl(connection.baseUrl?.trim() || preset.defaultBaseUrl);
  if (!baseUrl) return resolveOperationConnections(operation);
  const tested = (connection.testedModels ?? []).filter(Boolean);
  const fallbackModels = orderModelCandidates(connection.id, [...new Set([...tested, connection.defaultModel].filter(model => Boolean(model) && model !== route.model))], connection.modelLatency);
  const models = [route.model, ...fallbackModels].filter(Boolean).slice(0,3);
  const primary = models.map((model,index): RoutedAiConnection => ({ connection, preset, model, routeSource: index===0 ? "operation" : "first-enabled", resolved: { preset, config: { enabled:true, providerId:connection.providerId, apiKey:connection.apiKey, baseUrl:connection.baseUrl, model }, baseUrl } }));
  const globalFallback = resolveOperationConnections(operation).filter((item)=>item.connection.id!==connection.id);
  return [...primary, ...globalFallback];
}

export function getOperationRoutingSummary() {
  const policy = getAiRoutingPolicy();
  return (Object.keys(OPERATION_META) as AiOperation[]).map((operation) => {
    const route = resolveOperationConnection(operation);
    return {
      operation,
      ...OPERATION_META[operation],
      connectionId: route?.connection.id,
      providerId: route?.connection.providerId,
      providerName: route?.connection.label,
      model: route?.model,
      live: Boolean(route),
      routeSource: route?.routeSource,
      independentEvaluatorWarning: operation === "evaluate" && policy.requireIndependentEvaluator
        ? (() => {
            const generator = resolveOperationConnection("plan");
            return generator && route && generator.connection.id === route.connection.id && generator.model === route.model;
          })()
        : false,
    };
  });
}

export function applyRoutingPreset(kind: "balanced" | "quality" | "cost" | "independent") {
  const connections = listProviderConnections().filter((item) => item.enabled && item.apiKey.trim());
  if (!connections.length) return getAiRoutingPolicy();
  const first = connections[0]!;
  const second = connections[1];
  const model = first.defaultModel;
  const secondModel = second?.defaultModel;
  const operationRoutes: AiRoutingPolicy["operationRoutes"] = {};
  const put = (ops: AiOperation[], connection: ProviderConnection, selectedModel = connection.defaultModel) => {
    for (const op of ops) operationRoutes[op] = { connectionId: connection.id, model: selectedModel, fallbackConnectionIds: connections.filter((x) => x.id !== connection.id).map((x) => x.id) };
  };
  put(["intake", "command", "target", "copilot"], first, model);
  put(["problem-analysis", "diagnose", "distill", "next-queue"], kind === "quality" && second ? second : first, kind === "quality" && second ? secondModel : model);
  put(["plan", "build-candidate", "execute-artifact", "execute-artifact-batch", "materialize", "repair-artifact"], first, model);
  put(["eval-suite", "rubric", "artifact-acceptance", "release-review", "evaluate", "evaluate-population"], second ?? first, secondModel ?? model);
  const next: AiRoutingPolicy = {
    mode: kind === "independent" || second ? "independent-eval" : "specialized",
    operationRoutes,
    defaultRoute: { connectionId: first.id, model, fallbackConnectionIds: connections.slice(1).map((x) => x.id) },
    requireIndependentEvaluator: kind !== "cost",
    fallbackToDemo: false,
  };
  saveAiRoutingPolicy(next);
  return next;
}

export const SUPPORTED_PROVIDER_PRESETS = BYOK_PROVIDERS.filter((item) => ["openai", "anthropic", "gemini", "xai", "deepseek", "openrouter", "opencode", "custom", "moonshot", "dashscope", "zai", "mistral"].includes(item.id));
