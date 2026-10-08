import type { AiOperation } from "./schemas";

export type AiPerformanceEvent = {
  id: string;
  at: string;
  operation: AiOperation;
  provider: string;
  model: string;
  durationMs: number;
  inputChars: number;
  cached: boolean;
  routeAttempt: number;
  status: "ok" | "error" | "demo";
  message?: string;
};

export type OperationProfile = {
  timeoutMs: number;
  schemaRetries: number;
  maxRoutes: number;
  cacheTtlMs: number;
  reasoningHint: "fast" | "balanced" | "deep";
};

const KEY = "evolve-studio:ai-performance:v2.8";
const CACHE_KEY = "evolve-studio:ai-result-cache:v2.8";
const MAX_EVENTS = 120;
const MAX_CACHE = 48;

const FAST = 45_000;
const STANDARD = 70_000;
// 进化方案需要同时读根因、验收标准和源成果证据，并产出多个可执行候选；70 秒在
// 聚合网关的高峰期不足以完成一条真实回复。单条路由给到 90 秒，仍由服务层控制总预算。
const PLAN = 90_000;
const LONG = 120_000;

export const OPERATION_PROFILES: Record<AiOperation, OperationProfile> = {
  intake: { timeoutMs: STANDARD, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 0, reasoningHint: "balanced" },
  understand: { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  command: { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 60_000, reasoningHint: "fast" },
  target: { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  "eval-suite": { timeoutMs: STANDARD, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 2 * 60 * 60_000, reasoningHint: "balanced" },
  "problem-analysis": { timeoutMs: STANDARD, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 60 * 60_000, reasoningHint: "balanced" },
  diagnose: { timeoutMs: STANDARD, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 60 * 60_000, reasoningHint: "deep" },
  plan: { timeoutMs: PLAN, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 0, reasoningHint: "deep" },
  rubric: { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 6 * 60 * 60_000, reasoningHint: "balanced" },
  // 重型生成/执行节点也保留 2 条真实路由：单模型故障时先在真实模型之间自动切换，
  // 而不是直接降级到演示引擎——那些节点产出的是成果物本体，演示兜底会污染整轮结果。
  "build-candidate": { timeoutMs: 110_000, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  "artifact-acceptance": { timeoutMs: STANDARD, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 60 * 60_000, reasoningHint: "deep" },
  "repair-artifact": { timeoutMs: 180_000, schemaRetries: 0, maxRoutes: 2, cacheTtlMs: 0, reasoningHint: "balanced" },
  "execute-artifact": { timeoutMs: 45_000, schemaRetries: 0, maxRoutes: 2, cacheTtlMs: 15 * 60_000, reasoningHint: "fast" },
  "execute-artifact-batch": { timeoutMs: 45_000, schemaRetries: 0, maxRoutes: 2, cacheTtlMs: 20 * 60_000, reasoningHint: "fast" },
  "evaluate-population": { timeoutMs: 40_000, schemaRetries: 0, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "fast" },
  materialize: { timeoutMs: LONG, schemaRetries: 0, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  "release-review": { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  distill: { timeoutMs: STANDARD, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  "next-queue": { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  copilot: { timeoutMs: FAST, schemaRetries: 0, maxRoutes: 2, cacheTtlMs: 0, reasoningHint: "fast" },
  evaluate: { timeoutMs: 90_000, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  "gap-cluster": { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "fast" },
  "gap-advice": { timeoutMs: FAST, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 30 * 60_000, reasoningHint: "balanced" },
  "visual-judge": { timeoutMs: STANDARD, schemaRetries: 1, maxRoutes: 2, cacheTtlMs: 0, reasoningHint: "balanced" },
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(window.localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}

export function recordAiPerformance(event: Omit<AiPerformanceEvent, "id" | "at">) {
  if (typeof window === "undefined") return;
  const next: AiPerformanceEvent = { ...event, id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString() };
  const items = [next, ...listAiPerformance()].slice(0, MAX_EVENTS);
  try{window.localStorage.setItem(KEY, JSON.stringify(items));}catch{/* telemetry must not retry a completed AI call */}
  window.dispatchEvent(new CustomEvent("evolve-ai-performance-changed"));
}

export function listAiPerformance(): AiPerformanceEvent[] {
  return readJson<AiPerformanceEvent[]>(KEY, []);
}

export function clearAiPerformance() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent("evolve-ai-performance-changed"));
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function payloadChars(payload: unknown) {
  try { return JSON.stringify(payload).length; } catch { return 0; }
}

export function fastHash(value: unknown) {
  const text = stable(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${(hash >>> 0).toString(16)}-${text.length}`;
}

type CacheEntry = { key: string; expiresAt: number; value: unknown; operation: AiOperation; model: string };
const MEMORY_CACHE = new Map<string, CacheEntry>();
let persistentCacheSnapshot: CacheEntry[] | undefined;

function trimMemoryCache() {
  while (MEMORY_CACHE.size > MAX_CACHE * 2) {
    const oldest = MEMORY_CACHE.keys().next();
    if (oldest.done) break;
    MEMORY_CACHE.delete(oldest.value);
  }
}

function cacheKey(operation: AiOperation, model: string, payload: unknown) {
  return `${operation}:${model}:${fastHash(payload)}`;
}


function cacheEntries() {
  if (!persistentCacheSnapshot) persistentCacheSnapshot = readJson<CacheEntry[]>(CACHE_KEY, []);
  const now = Date.now();
  persistentCacheSnapshot = persistentCacheSnapshot.filter((item) => item.expiresAt > now);
  return persistentCacheSnapshot;
}

export function getCachedAiResult<T>(operation: AiOperation, model: string, payload: unknown): T | undefined {
  const profile = OPERATION_PROFILES[operation];
  if (!profile.cacheTtlMs || typeof window === "undefined") return undefined;
  const key = cacheKey(operation, model, payload);
  const memory = MEMORY_CACHE.get(key);
  if (memory && memory.expiresAt > Date.now()) return memory.value as T;
  if (memory) MEMORY_CACHE.delete(key);
  const persisted = cacheEntries().find((item) => item.key === key);
  if (persisted) { MEMORY_CACHE.set(key, persisted); trimMemoryCache(); }
  return persisted?.value as T | undefined;
}

export function setCachedAiResult(operation: AiOperation, model: string, payload: unknown, value: unknown) {
  const profile = OPERATION_PROFILES[operation];
  if (!profile.cacheTtlMs || typeof window === "undefined") return;
  const key = cacheKey(operation, model, payload);
  const next: CacheEntry = { key, expiresAt: Date.now() + profile.cacheTtlMs, value, operation, model };
  MEMORY_CACHE.set(key, next);
  trimMemoryCache();
  // Large candidate/artifact results are fast and useful inside the current session but expensive to
  // stringify into localStorage after every completion. Keep those memory-only.
  let serialized: string;
  try { serialized = JSON.stringify(next); } catch { return; }
  if (serialized.length > 200_000) return;
  const current = cacheEntries().filter((item) => item.key !== key);
  persistentCacheSnapshot = [next, ...current].slice(0, MAX_CACHE);
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(persistentCacheSnapshot)); } catch { /* quota: memory cache still works */ }
}

export function clearAiResultCache() {
  MEMORY_CACHE.clear();
  persistentCacheSnapshot = undefined;
  if (typeof window !== "undefined") window.localStorage.removeItem(CACHE_KEY);
}

export function summarizeAiPerformance(events = listAiPerformance()) {
  const byOperation = new Map<string, AiPerformanceEvent[]>();
  for (const event of events) byOperation.set(event.operation, [...(byOperation.get(event.operation) ?? []), event]);
  return [...byOperation.entries()].map(([operation, items]) => ({
    operation,
    count: items.length,
    averageMs: Math.round(items.reduce((sum, item) => sum + item.durationMs, 0) / Math.max(1, items.length)),
    p95Ms: [...items].sort((a, b) => a.durationMs - b.durationMs)[Math.max(0, Math.ceil(items.length * 0.95) - 1)]?.durationMs ?? 0,
    cacheHits: items.filter((item) => item.cached).length,
    errors: items.filter((item) => item.status === "error").length,
    avgInputChars: Math.round(items.reduce((sum, item) => sum + item.inputChars, 0) / Math.max(1, items.length)),
  })).sort((a, b) => b.averageMs - a.averageMs);
}
