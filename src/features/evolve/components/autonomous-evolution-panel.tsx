import { AlertTriangle, CheckCircle2, CirclePause, Loader2, PackageCheck, Play, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { autonomousAttention, autonomousEvolutionState, autonomousProgress } from "../runtime/autonomous-evolution";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { canRetryStoredServerExperiment, serverMainFlowRetryUnavailableReason } from "../runtime/server-experiment-retry";
import { ServerExperimentRetry } from "./server-experiment-retry";

export function AutonomousEvolutionPanel({
  runtime,
  onOpenSource,
  onOpenOutputs,
  onOpenAdvanced,
  onOpenRuntime,
}: {
  runtime: ProjectRuntime;
  onOpenSource: () => void;
  onOpenOutputs: () => void;
  onOpenAdvanced: () => void;
  onOpenRuntime: () => void;
}) {
  const project = runtime.project;
  const state = autonomousEvolutionState(project, runtime.status.busy);
  const attention = autonomousAttention(project);
  const progress = autonomousProgress(project);
  const completedCount = progress.filter((item) => item.done).length;

  const copy = state === "completed"
    ? { title: "进化完成，等待你验收成果", detail: "最终版本已经通过独立验证和成果完整性检查，并已生成可领取成果物。", tone: "border-emerald-200 bg-emerald-50/60" }
    : state === "attention"
      ? { title: attention?.title ?? "需要你处理一个问题", detail: attention?.detail ?? "系统无法安全地自行决定这一项。", tone: "border-amber-200 bg-amber-50/60" }
      : state === "running" || state === "preparing"
        ? { title: "Evolve 正在自主进化", detail: runtime.status.phase ?? runtime.status.label ?? "系统会自行理解、改进、比较和复验；没有必要不会打扰你。", tone: "border-indigo-200 bg-indigo-50/60" }
        : state === "waiting-input"
          ? { title: "输入要进化的内容和要求", detail: "提交后系统会直接开始自主进化。", tone: "border-slate-200 bg-white" }
          : { title: project.campaign.status === "paused" ? "自主进化已暂停" : "准备开始自主进化", detail: project.campaign.stopReason || "系统会持续运行直到完整验收通过，或遇到真正需要你决定的问题。", tone: "border-indigo-200 bg-white" };

  const resolveAttention = () => {
    if (!attention) return;
    if (attention.request?.diagnosticCode === "local-evidence-incomplete") {
      onOpenRuntime();
      return;
    }
    const panel = document.getElementById("evolve-attention-request");
    if (panel) {
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => panel.focus({ preventScroll: true }), 250);
      return;
    }
    // Fallback only if the unified attention panel has not mounted yet.
    if (attention.kind === "source") onOpenSource();
    else if (attention.kind === "limit") onOpenAdvanced();
    else runtime.setStage(attention.stage);
  };

  return <section className={`rounded-3xl border p-5 soft-shadow sm:p-6 ${copy.tone}`}>
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {state === "completed" ? <CheckCircle2 className="size-5 text-emerald-600" /> : state === "attention" ? <AlertTriangle className="size-5 text-amber-600" /> : state === "running" || state === "preparing" ? <Loader2 className="size-5 animate-spin text-indigo-600" /> : <Sparkles className="size-5 text-indigo-600" />}
          <h2 className="text-lg font-bold text-slate-950">{copy.title}</h2>
          <Badge>{completedCount}/4</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{copy.detail}</p>
        {state === "attention" && serverMainFlowRetryUnavailableReason(project) && <p className="mt-1 text-xs text-amber-800">{serverMainFlowRetryUnavailableReason(project)}</p>}
        {state === "running" && runtime.status.detail && <p className="mt-1 text-xs text-indigo-600">{runtime.status.detail}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {state === "waiting-input" && <Button onClick={onOpenSource}>输入任务</Button>}
        {(state === "ready" || state === "preparing") && !runtime.status.busy && <Button onClick={() => void runtime.runAutoPilot()}><Play className="size-4" />{project.campaign.status === "paused" ? "继续自主进化" : "开始自主进化"}</Button>}
        {state === "running" && <Button variant="secondary" onClick={runtime.pauseCampaign}><CirclePause className="size-4" />暂停</Button>}
        {state === "attention" && canRetryStoredServerExperiment(project) && <ServerExperimentRetry key={project.id + ":" + project.updatedAt} project={project} busy={runtime.status.busy} onOpenRuntime={onOpenRuntime}/> }
        {state === "attention" && !canRetryStoredServerExperiment(project) && <Button onClick={resolveAttention}><AlertTriangle className="size-4" />{attention?.request?.diagnosticCode === "local-evidence-incomplete" ? "查看证据详情" : "处理这个问题"}</Button>}
        {state === "completed" && <Button onClick={onOpenOutputs}><PackageCheck className="size-4" />验收成果</Button>}
      </div>
    </div>

    <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {progress.map((item, index) => <div key={item.id} className={`rounded-xl border px-3 py-2.5 ${item.done ? "border-emerald-200 bg-white/80" : "border-slate-200 bg-white/50"}`}>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><span className={`grid size-5 place-items-center rounded-full text-[10px] ${item.done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"}`}>{item.done ? "✓" : index + 1}</span>{item.label}</div>
      </div>)}
    </div>

    {state === "attention" && attention && <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs leading-5 text-amber-900"><b>为什么需要你：</b>{attention.request?.diagnosticCode === "local-evidence-incomplete" ? "本地只取得局部或未完成的证据；请查看具体测试记录，重复 AI 评审无法补齐。" : attention.kind === "clarification" ? "这个决定会显著改变结果或具有较高影响，系统不会自行猜测。" : attention.kind === "validation" ? "这项要求需要视觉、人工或真实外部运行证据，系统不能伪造。" : attention.kind === "model" ? "AI 调用未完成。请重试或检查当前节点的模型连接；当前成果与断点已保留。" : attention.kind === "limit" ? "自动搜索已触及安全边界，但尚未达到完整验收要求。" : "当前输入无法可靠读取或生成，需要你修正材料。"}</div>}
  </section>;
}
