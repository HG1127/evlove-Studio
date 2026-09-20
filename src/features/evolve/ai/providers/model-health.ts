// 模型健康记忆：记住「连接+模型」最近的失败情况，冷却窗口内把它降到路由链末尾。
// 没有这层记忆时，每次 AI 调用都要先在坏模型上重新等一遍超时才轮到备用模型——
// 自动切换虽然成立，但要为同一个坏模型反复付时间成本。只做内存态：刷新后清零，
// 给恢复的服务重新探测的机会，避免把临时故障永久拉黑。

type Entry = { fails: number; lastFailAt: number };

/** 失败记录的有效期：超过这个窗口的旧失败不再参与判断。 */
const FAIL_WINDOW_MS = 5 * 60_000;
/** 窗口内累计失败达到该次数才进入冷却：单次失败可能是抖动，不该立刻拉黑。 */
const COOLDOWN_THRESHOLD = 2;

const entries = new Map<string, Entry>();
const key = (connectionId: string, model: string) => `${connectionId}::${model}`;

export function noteRouteFailure(connectionId: string, model: string, nowMs = Date.now()) {
  const k = key(connectionId, model);
  const prev = entries.get(k);
  entries.set(k, prev && nowMs - prev.lastFailAt <= FAIL_WINDOW_MS
    ? { fails: prev.fails + 1, lastFailAt: nowMs }
    : { fails: 1, lastFailAt: nowMs });
}

export function noteRouteSuccess(connectionId: string, model: string) {
  entries.delete(key(connectionId, model));
}

export function isCoolingDown(connectionId: string, model: string, nowMs = Date.now()): boolean {
  const k = key(connectionId, model);
  const entry = entries.get(k);
  if (!entry) return false;
  if (nowMs - entry.lastFailAt > FAIL_WINDOW_MS) { entries.delete(k); return false; }
  return entry.fails >= COOLDOWN_THRESHOLD;
}

/** 测试用途：清空健康记忆。 */
export function resetModelHealth() {
  entries.clear();
}

/**
 * 路由链排序：冷却中的模型降到末尾（全部冷却时保持原序，宁试不瘫）；
 * 健康模型里，若主模型（入参首个）仍健康则稳居首位（尊重用户显式选择），
 * 其余按实测延迟升序（未测过的排后，sort 稳定性保证原相对顺序）；主模型自己冷却时让位，全部健康模型改按延迟排。
 */
export function orderModelCandidates(connectionId: string, models: string[], latencyMs?: Record<string, number>): string[] {
  if (models.length <= 1) return models;
  const cooled = models.filter((model) => isCoolingDown(connectionId, model));
  const healthy = models.filter((model) => !isCoolingDown(connectionId, model));
  if (!healthy.length) return models; // 全部冷却：保持原序，宁可重试也不瘫掉
  const byLatency = (a: string, b: string) => (latencyMs?.[a] ?? Number.MAX_SAFE_INTEGER) - (latencyMs?.[b] ?? Number.MAX_SAFE_INTEGER);
  const [first] = models;
  const firstHealthy = first !== undefined && !isCoolingDown(connectionId, first);
  const orderedHealthy = firstHealthy
    ? [first!, ...healthy.filter((model) => model !== first).sort(byLatency)]
    : [...healthy].sort(byLatency);
  return [...orderedHealthy, ...cooled];
}
