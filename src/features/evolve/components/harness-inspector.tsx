import { Activity, Box, BrainCircuit, CircleAlert, Gauge, Route, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvolveProject } from "../schemas";
import { EVOLUTION_HARNESS_COMPONENTS, inspectEvolutionHarness, type HarnessToolAvailability } from "../runtime/evolution-harness";

function availabilityClass(value: HarnessToolAvailability) {
  if (value === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "local") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

export function HarnessInspector({ project }: { project?: EvolveProject }) {
  const plan = project ? inspectEvolutionHarness(project) : undefined;
  return <section className="space-y-3">
    <div>
      <div className="text-xs font-semibold text-indigo-600">Evolution Harness</div>
      <h2 className="mt-1 text-xl font-bold text-slate-900">执行内核</h2>
      <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">
        Harness 不定义“进化业务逻辑”，而是统一负责每一步如何被可靠执行：上下文、模型、工具、预算、策略、失败处理和断点恢复。
      </p>
    </div>

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {EVOLUTION_HARNESS_COMPONENTS.map((item) => <Card key={item.id}>
        <CardContent className="pt-5">
          <div className="flex items-start justify-between gap-2"><div className="font-semibold text-slate-800">{item.title}</div><Badge className={item.status === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-200 bg-sky-50 text-sky-700"}>{item.status === "ready" ? "已收口" : "本地版"}</Badge></div>
          <p className="mt-2 text-xs leading-5 text-slate-500">{item.responsibility}</p>
        </CardContent>
      </Card>)}
    </div>

    {plan ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><BrainCircuit className="size-4 text-indigo-600" />当前 Mission · Harness Plan</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{plan.version}</Badge>
            <Badge className={plan.policy.mode === "auto" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : plan.policy.mode === "human" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"}>{plan.policy.mode === "auto" ? "AUTO" : plan.policy.mode === "human" ? "HUMAN GATE" : "BLOCKED"}</Badge>
            <Badge>{plan.policy.risk.toUpperCase()} RISK</Badge>
          </div>

          <div className="rounded-2xl border bg-slate-50 p-4">
            <div className="flex items-start gap-3"><Route className="mt-0.5 size-4 shrink-0 text-indigo-600" /><div><div className="text-xs font-semibold text-slate-800">下一动作：{plan.decision.action}</div><p className="mt-1 text-xs leading-5 text-slate-500">{plan.decision.reason}</p></div></div>
            <div className="mt-3 border-t pt-3 text-[11px] leading-5 text-slate-500"><b className="text-slate-700">Policy：</b>{plan.policy.reason}</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={<Gauge className="size-3.5" />} label="Rounds" value={`${plan.budget.rounds.used}/${plan.budget.rounds.max}`} detail={`剩余 ${plan.budget.rounds.remaining}`} />
            <Metric icon={<Activity className="size-3.5" />} label="Patience" value={`${plan.budget.patience.used}/${plan.budget.patience.max}`} detail={`剩余 ${plan.budget.patience.remaining}`} />
            <Metric icon={<Box className="size-3.5" />} label="Candidates" value={String(plan.budget.candidatesPerRound)} detail="每轮上限" />
            <Metric icon={<BrainCircuit className="size-3.5" />} label="Context" value={`${Math.round(plan.context.usedChars / 1000)}k / ${Math.round(plan.context.budgetChars / 1000)}k`} detail={`${plan.context.selectedArtifacts.length}/${plan.context.totalArtifacts} 个 Artifact`} />
          </div>

          {(plan.budget.cost.max !== undefined || plan.budget.wallTime.maxMinutes !== undefined) && <div className="rounded-xl border p-3 text-xs text-slate-500">
            {plan.budget.cost.max !== undefined && <div>成本：{plan.budget.cost.used.toFixed(3)} / {plan.budget.cost.max} · 剩余 {plan.budget.cost.remaining?.toFixed(3)}</div>}
            {plan.budget.wallTime.maxMinutes !== undefined && <div className="mt-1">连续运行：{Math.round(plan.budget.wallTime.elapsedMinutes ?? 0)} / {plan.budget.wallTime.maxMinutes} 分钟</div>}
          </div>}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border p-3">
              <div className="text-xs font-semibold text-slate-700">Context Builder</div>
              <div className="mt-2 space-y-1 text-[11px] leading-5 text-slate-500">
                {plan.context.selectedArtifacts.map((item) => <div key={item.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{item.name}</span><span className="shrink-0">{item.coverage} · {Math.round(item.chars / 1000)}k</span></div>)}
                {plan.context.omittedArtifactIds.length > 0 && <div className="pt-1 text-amber-600">省略 {plan.context.omittedArtifactIds.length} 个低相关 Artifact；需要时下一步重新检索。</div>}
              </div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-xs font-semibold text-slate-700">Model Route / Checkpoint</div>
              <div className="mt-2 space-y-1 text-[11px] leading-5 text-slate-500">
                <div>Operation：{plan.modelRoute.operation ?? "无需模型"}</div>
                <div>模型：{plan.modelRoute.live ? `${plan.modelRoute.provider ?? "Provider"} · ${plan.modelRoute.model ?? "Model"}` : "当前无真实模型路由 / 本地动作"}</div>
                <div>Fallback：{plan.modelRoute.fallbackCount}</div>
                <div className="break-all">Checkpoint：{plan.checkpoint.id}</div>
                <div>Stage / Round：{plan.checkpoint.stage} / {plan.checkpoint.round}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-indigo-600" />Tool Contracts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {plan.tools.map((tool) => <div key={tool.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2"><div><div className="text-xs font-semibold text-slate-800">{tool.label}</div><div className="mt-0.5 text-[10px] text-slate-400">{tool.capability}</div></div><Badge className={availabilityClass(tool.availability)}>{tool.availability}</Badge></div>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px]"><Badge>{tool.sideEffect}</Badge><Badge>{tool.evidenceClass}</Badge><Badge>{tool.rollback}</Badge><Badge>{tool.retryPolicy}</Badge></div>
            <p className="mt-2 text-[10px] leading-4 text-slate-400">{tool.note}</p>
          </div>)}
        </CardContent>
      </Card>
    </div> : <Card><CardContent className="flex items-start gap-3 py-8 text-sm text-slate-500"><CircleAlert className="mt-0.5 size-4 text-amber-500" /><div><b className="text-slate-700">还没有 Mission 可供 Harness 检查。</b><p className="mt-1 text-xs leading-5">创建项目后，这里会显示真实的下一动作、上下文、预算、模型路由和 Tool Contract。</p></div></CardContent></Card>}
  </section>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border bg-slate-50 p-3"><div className="flex items-center gap-1.5 text-[10px] text-slate-400">{icon}{label}</div><div className="mt-1 text-sm font-bold text-slate-800">{value}</div><div className="mt-0.5 text-[10px] text-slate-400">{detail}</div></div>;
}
