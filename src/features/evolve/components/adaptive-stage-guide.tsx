import type { EvolveProject, Stage } from "../schemas";
import { humanStageEvidence, stepForStage, workflowStepState } from "../runtime/real-evolution-workflow";

export function AdaptiveStageGuide({ project, stage }: { project: EvolveProject; stage: Stage }) {
  const step = stepForStage(project, stage);
  const evidence = humanStageEvidence(project, step.id);
  const state = workflowStepState(project, step.id);
  if (stage === "target") return null;
  return <section aria-label="当前进度与证据" className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
    <div className="text-xs font-semibold text-indigo-700">{step.label}</div>
    <p className="mt-1 text-sm font-medium leading-6 text-slate-900">{state.status === "attention" || state.status === "locked" ? state.detail : evidence.next}</p>
    <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-700 sm:grid-cols-2"><p><b>现在要做：</b>{step.action}</p><p><b>完成后得到：</b>{step.output}</p></div>
    <details className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">技术人员查看：本步依据、系统发现与完成标准</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section className="rounded-xl bg-slate-50 p-3"><h3 className="text-sm font-semibold">系统读取依据</h3><ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">{evidence.read.length ? evidence.read.map((item) => <li key={item}>{item}</li>) : <li>尚无读取证据。</li>}</ul></section>
        <section className="rounded-xl bg-slate-50 p-3"><h3 className="text-sm font-semibold">内部判断</h3><ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">{evidence.findings.map((item) => <li key={item}>{item}</li>)}</ul></section>
      </div><p className="mt-3 text-sm leading-6 text-slate-600"><b>完成标准：</b>{step.done}<br/><b>内部产出：</b>{evidence.outputs.filter(Boolean).join("；")}</p>
    </details>
  </section>;
}
