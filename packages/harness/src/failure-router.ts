export type FailureKind = "transient-system" | "input" | "capability" | "safety" | "logic" | "cancelled";

export type FailureDisposition = {
  kind: FailureKind;
  retryable: boolean;
  maxAttempts: number;
  backoffMs: number;
  reason: string;
};

function messageOf(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "unknown error");
}

/**
 * Classify runtime failures before surfacing them to a person.
 * The default is conservative: only clearly transient, idempotent offline failures are auto-retried.
 */
export function classifyRuntimeFailure(error: unknown): FailureDisposition {
  const text = messageOf(error);
  if (/AbortError|aborted|用户暂停|cancelled/i.test(text)) {
    return { kind: "cancelled", retryable: false, maxAttempts: 1, backoffMs: 0, reason: "任务被主动中止" };
  }
  if (/\b429\b|rate.?limit|请求频率|temporar|timeout|timed out|network|fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|\b50[0234]\b|service unavailable/i.test(text)) {
    return { kind: "transient-system", retryable: true, maxAttempts: 3, backoffMs: /429|rate.?limit|请求频率/i.test(text) ? 1800 : 650, reason: "临时服务或网络故障" };
  }
  if (/Runner|浏览器|E2E|visual|视觉|截图|人工|外部验证|capability|未连接.*执行/i.test(text)) {
    return { kind: "capability", retryable: false, maxAttempts: 1, backoffMs: 0, reason: "缺少外部验证能力" };
  }
  if (/Safety|安全门槛|不可逆|权限|生产|发布|支付|交易|删除|覆盖/i.test(text)) {
    return { kind: "safety", retryable: false, maxAttempts: 1, backoffMs: 0, reason: "触及安全或高影响边界" };
  }
  if (/请先|缺少.*输入|无法读取|解析失败|文件.*损坏|目标.*不完整|Rubric.*未|Acceptance.*未/i.test(text)) {
    return { kind: "input", retryable: false, maxAttempts: 1, backoffMs: 0, reason: "输入或契约不足" };
  }
  return { kind: "logic", retryable: false, maxAttempts: 1, backoffMs: 0, reason: "非瞬时执行错误" };
}

export function retryDelayMs(disposition: FailureDisposition, attempt: number) {
  return Math.min(8000, disposition.backoffMs * Math.max(1, attempt));
}

