import { useState } from "react";
import { Activity, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EvolveProject, OutcomeAnalyticsResponse } from "@evolution/contracts";
import { getServerOutcomeAnalysis } from "../runtime/server-outcome-client";

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; analysis: OutcomeAnalyticsResponse }
  | { status: "error"; message: string };

const verdictLabels: Record<OutcomeAnalyticsResponse["verdict"], string> = {
  insufficient: "证据不足", healthy: "暂无显著回归", watch: "继续观察", regression: "检测到回归",
};

function displayNumber(value: number | undefined) {
  return value === undefined ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

export function OutcomeAnalyticsCard({ project }: { project: EvolveProject }) {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const candidateId = project.release.candidateId;
  const load = () => {
    if (!candidateId) return;
    setState({ status: "loading" });
    void getServerOutcomeAnalysis(project.id, candidateId)
      .then((analysis) => setState({ status: "ready", analysis }))
      .catch((error: unknown) => setState({ status: "error", message: error instanceof Error ? error.message : "Outcome 分析暂时不可用" }));
  };

  return <Card><CardContent className="pt-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 font-semibold"><Activity className="size-4 text-indigo-600"/>Production Outcome 分析</div><p className="mt-1 text-xs leading-5 text-slate-500">读取服务端已记录的 Stable / Candidate 样本、回归和时间漂移；样本不足或部署身份混杂时不会报告健康结论。</p></div><Button type="button" variant="secondary" size="sm" onClick={load} disabled={!candidateId || state.status === "loading"}><RefreshCw className="mr-1.5 size-3.5"/>{state.status === "loading" ? "读取中…" : state.status === "idle" ? "读取分析" : "重新读取"}</Button></div>
    <div className="mt-3 text-[11px] text-slate-500">Mission {project.id} · Candidate {candidateId ?? "尚未绑定"} · 当前 Deployment {project.release.deploymentId ?? "尚未绑定"}</div>
    {!candidateId && <p className="mt-4 rounded-xl border bg-slate-50 p-3 text-xs text-slate-500">先完成 Release Candidate 绑定，再读取真实 Outcome 样本。</p>}
    {state.status === "idle" && candidateId && <p className="mt-4 rounded-xl border bg-slate-50 p-3 text-xs text-slate-500">尚未读取服务端统计；这里不把 Release KPI 快照当作 Stable / Candidate 对比证据。</p>}
    {state.status === "loading" && <p aria-live="polite" className="mt-4 text-xs text-slate-500">正在读取服务端 Outcome 分析…</p>}
    {state.status === "error" && <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><TriangleAlert className="mt-0.5 size-4 shrink-0"/><span>读取失败：{state.message}</span></div>}
    {state.status === "ready" && <div className="mt-4 space-y-3" aria-live="polite"><div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2.5 py-1 font-semibold ${state.analysis.verdict === "regression" ? "bg-rose-100 text-rose-700" : state.analysis.verdict === "healthy" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{verdictLabels[state.analysis.verdict]}</span><span className="text-slate-500">{state.analysis.sampleCount} 条样本 · 每组至少 {state.analysis.minimumSamplesPerArm} 条</span></div><p className="rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-600">{state.analysis.message}</p>{state.analysis.metrics.length > 0 && <div className="grid gap-2 md:grid-cols-2">{state.analysis.metrics.map((metric) => <div key={`${metric.metricKey}:${metric.segment}`} className="rounded-xl border p-3 text-xs"><div className="font-semibold">{metric.metricKey} · {metric.segment}</div><div className="mt-2 grid grid-cols-2 gap-2 text-slate-600"><span>Stable {displayNumber(metric.stable.mean)} {metric.unit}</span><span>Candidate {displayNumber(metric.candidate.mean)} {metric.unit}</span></div><div className="mt-2 text-[11px] text-slate-500">样本 {metric.stable.count} / {metric.candidate.count} · {metric.evidenceStatus === "estimated" ? metric.significance : "证据不足"}</div></div>)}</div>}{state.analysis.regressions.length > 0 && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">回归：{state.analysis.regressions.map((item) => `${item.metricKey}/${item.segment}`).join("、")}</p>}{state.analysis.drift.some((item) => item.status === "drifting") && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Candidate 样本存在时间漂移，需继续观察。</p>}</div>}
  </CardContent></Card>;
}