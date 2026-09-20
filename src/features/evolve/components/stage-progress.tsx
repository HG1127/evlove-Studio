import { Check, LockKeyhole, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EvolveProject, Stage } from "../schemas";
import { compileUserEvolutionSteps, preferredInternalStage, stepForStage, workflowStepState } from "../runtime/real-evolution-workflow";

export function StageProgress({ active, onChange, project, busy = false }: { active: Stage; onChange: (stage: Stage) => void; project: EvolveProject; busy?: boolean }) {
  const steps = compileUserEvolutionSteps(project);
  const viewed = stepForStage(project, active)?.id;
  const states = steps.map(step => workflowStepState(project, step.id));
  const next = steps.find((_, index) => states[index].status !== "complete" && states[index].status !== "locked");
  return <section aria-label="五步进化流程">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><div className="text-sm font-semibold text-slate-900">进化流程</div><p className="mt-1 text-xs text-slate-600">先建立原版基线，再修改、对比验证，最后领取同一份已验收文件。</p></div>
      <span className="text-xs text-slate-600">{states.filter(state => state.status === "complete").length} / 5 步已完成</span>
    </div>
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{steps.map((step, index) => {
      const state = states[index]; const current = viewed === step.id; const locked = state.status === "locked";
      return <li key={step.id}><button type="button" disabled={locked} aria-current={current ? "step" : undefined} title={busy && !locked ? `${state.detail}；后台任务仍在执行，可查看本步骤` : state.detail} onClick={() => onChange(preferredInternalStage(project, step.id))} className={cn("h-full w-full rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed", current ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white", !locked && "hover:border-indigo-300")}>
        <div className="flex items-center gap-2"><span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", state.status === "complete" ? "bg-emerald-50 text-emerald-700" : state.status === "attention" ? "bg-amber-50 text-amber-700" : current ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600")}>{state.status === "complete" ? <Check className="size-4"/> : locked ? <LockKeyhole className="size-3.5"/> : state.status === "attention" ? <CircleAlert className="size-4"/> : index + 1}</span><span className="text-xs font-semibold text-slate-800">{step.label}</span></div>
        <div className="mt-2 text-xs font-medium text-slate-600">{state.label}{current ? " · 正在查看" : ""}</div>
        <p className="mt-1 text-[11px] leading-5 text-slate-600">{locked || state.status === "attention" ? state.detail : step.question}</p>
      </button></li>;
    })}</ol>
    {next && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs text-slate-600">{busy ? "任务正在后台执行；可以查看其他已解锁步骤，修改与重复运行暂时锁定。" : `下一步：${next.label}。点击进入后，在内容区执行具体操作。`}</p>{viewed !== next.id && <button type="button" onClick={() => onChange(preferredInternalStage(project, next.id))} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">{busy ? "查看当前任务" : "前往下一步"}</button>}</div>}
  </section>;
}
