// AI 过程留痕日志：连接失败重试、演示兜底等降级事件按时间留存，
// 在设置页可追溯；只记元信息与错误摘要，不写入任何密钥内容。
export type AiAuditEvent = {
  at: string;
  operation: string;
  model: string;
  kind: "retry" | "demo-fallback" | "manual-check";
  message: string;
};

/** 事件类型的界面文案：徽章文本 + 是否红色告警级。 */
export function auditKindMeta(kind: AiAuditEvent["kind"]): { label: string; severe: boolean } {
  switch (kind) {
    case "demo-fallback": return { label: "已降级到演示引擎", severe: true };
    case "manual-check": return { label: "手动检测失败", severe: true };
    case "retry": return { label: "已自动换连接重试", severe: false };
  }
}

const KEY = "evolve-studio:ai-audit-events:v1";
const MAX_EVENTS = 60;

export function recordAiAuditEvent(event: Omit<AiAuditEvent, "at">) {
  if (typeof window === "undefined") return;
  const next = [{ ...event, at: new Date().toISOString() }, ...listAiAuditEvents()].slice(0, MAX_EVENTS);
  window.localStorage.setItem(KEY, JSON.stringify(next));
  // 广播给执行台等界面：自动切换发生后立刻可见，不用刷新或翻设置页。
  window.dispatchEvent(new CustomEvent("evolve-ai-audit-changed"));
}

export function listAiAuditEvents(): AiAuditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is AiAuditEvent => Boolean(item && typeof item === "object" && typeof (item as AiAuditEvent).at === "string")) : [];
  } catch {
    return [];
  }
}

export function clearAiAuditEvents() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

/** 最近 windowHours 小时内的留痕条数：用于「失败过多」的醒目提示。 */
export function countRecentAiAuditEvents(windowHours = 24) {
  const cutoff = Date.now() - windowHours * 3600_000;
  return listAiAuditEvents().filter((event) => new Date(event.at).getTime() >= cutoff).length;
}
