import type { RuntimeStatus } from "./run-manager";

const EXPECTED_SECONDS: Array<[RegExp, number]> = [
  [/解析|输入/, 75],
  [/测试|Eval|验收标准|Rubric/i, 120],
  [/问题|根因|诊断/, 105],
  [/方案|Candidate|进化/, 150],
  [/实验|Baseline|Validation|验证|评估/i, 180],
];

function expectedSeconds(status: RuntimeStatus) {
  const text = `${status.phase ?? ""} ${status.label ?? ""}`;
  return EXPECTED_SECONDS.find(([pattern]) => pattern.test(text))?.[1] ?? 120;
}

export type DisplayProgress = { percent: number; estimated: boolean; caption: string; etaSeconds?: number };

/** 有真实分项时显示真实进度；只有 start/end 事件时提供明确标注、且不会自动到 100% 的估算。 */
export function displayProgress(status: RuntimeStatus): DisplayProgress {
  const done = status.done ?? 0;
  const total = status.total ?? 0;
  if (total > 1 || done > 0) {
    const percent = Math.min(100, Math.max(0, status.percent ?? Math.round(done / Math.max(total, 1) * 100)));
    return { percent, estimated: false, caption: /候选文件/.test(status.phase??"")?`${done}/${total} 个方案已处理`:`${done}/${total} 项完成`, etaSeconds: status.etaSeconds };
  }

  const elapsed = Math.max(0, status.elapsedSeconds ?? 0);
  const expected = expectedSeconds(status);
  const percent = Math.min(90, Math.max(3, Math.round(3 + 87 * (1 - Math.exp(-elapsed / expected)))));
  return {
    percent,
    estimated: true,
    caption: elapsed < expected ? "根据同类步骤耗时估算" : "已超过常见耗时，仍在等待结果",
    etaSeconds: elapsed < expected ? expected - elapsed : undefined,
  };
}
