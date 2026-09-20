import type { TargetAdapter } from "./types";

function candidateFactor(id?: string, learned = false) {
  if (id === "C") return { evidence: "all claims mapped to evidence", risk: "includes falsifiers", latency: 17800, cost: 0.36 };
  if (id === "B") return { evidence: "most claims mapped to evidence", risk: "includes risk section", latency: 22600, cost: 0.44 };
  if (id === "A") return { evidence: "prompt reminds citations", risk: "standard risk section", latency: 20100, cost: 0.40 };
  if (id === "D") return { evidence: "citation validator checks claims", risk: "standard risk section", latency: 24400, cost: 0.48 };
  if (learned) return { evidence: "all claims mapped to evidence", risk: "includes falsifiers", latency: 18000, cost: 0.37 };
  return { evidence: "some claims miss evidence", risk: "risk section incomplete", latency: 21400, cost: 0.41 };
}

export const mockTargetAdapter: TargetAdapter = {
  name: "Mock Research Agent",
  live: false,
  async run({ project, testCase, variant }) {
    const learned = !variant && project.lessons.some((lesson) => lesson.status === "verified-skill");
    const f = candidateFactor(variant?.id, learned);
    const output = [
      `任务：${testCase.title}`,
      "结论：公司具有增长机会，但需要结合证据与风险条件判断。",
      `证据状态：${f.evidence}.`,
      `风险状态：${f.risk}.`,
      variant ? `实验版本：${variant.name}；改动：${variant.change}` : `当前版本：${project.version} Baseline`,
    ].join("\n");
    return {
      testCaseId: testCase.id,
      output,
      latencyMs: f.latency,
      cost: f.cost,
      trace: [
        { id: `${testCase.id}-r`, stage: "Research", summary: "完成资料检索", status: "pass", detail: "Mock adapter returned source bundle" },
        { id: `${testCase.id}-a`, stage: "Analysis", summary: "完成分析", status: "pass", detail: "Generated core claims" },
        { id: `${testCase.id}-e`, stage: "Evidence", summary: variant?.id === "C" || variant?.id === "B" ? "执行 Evidence Gate" : "Evidence Gate 不完整", status: variant?.id === "C" || variant?.id === "B" ? "pass" : "warning", detail: f.evidence },
      ],
      verificationStatus: variant?.id === "C" || variant?.id === "B" || learned ? "verified" : "partial",
    };
  },
  async runBatch({ project, testCases, variant }) {
    const results = [];
    for (const testCase of testCases) results.push(await mockTargetAdapter.run({ project, testCase, variant }));
    return results;
  },
  async release({ action }) {
    const traffic = action === "shadow" ? 0 : action === "canary-5" ? 5 : action === "canary-20" ? 20 : action === "canary-50" ? 50 : action === "promote" ? 100 : 0;
    const healthy = action !== "rollback";
    return {
      ok: true,
      evidenceMode: "simulation",
      trafficPercent: traffic,
      healthy,
      note: action === "rollback" ? "Mock release rolled back to previous Champion" : `Mock release advanced to ${action}`,
      kpis: [
        { key: "online-success", label: "线上成功率", value: healthy ? 92 : 84, unit: "%", target: 90, direction: "higher" },
        { key: "online-evidence", label: "线上证据覆盖", value: healthy ? 90 : 76, unit: "%", target: 90, direction: "higher" },
        { key: "online-cost", label: "线上平均成本", value: healthy ? 0.37 : 0.52, unit: "¥", target: 0.5, direction: "lower" },
        { key: "online-errors", label: "错误率", value: healthy ? 1.2 : 5.4, unit: "%", target: 2, direction: "lower" },
      ],
    };
  },
};
