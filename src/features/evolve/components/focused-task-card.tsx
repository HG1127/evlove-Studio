import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { focusedTask, prioritizeProblems } from "../runtime/focused-task";

export function FocusedTaskCard({ runtime }: { runtime: ProjectRuntime }) {
  const task = focusedTask(runtime.project);
  const queue = prioritizeProblems(runtime.project.problems);
  return <section className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4" aria-label="本轮改进任务">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-indigo-600">本轮只解决这一件事</p>
        <h3 className="mt-1 text-base font-semibold text-slate-900">{task.title}</h3>
      </div>
      <label className="text-xs text-slate-500">改进方式
        <select aria-label="进化方式" disabled={runtime.status.busy} className="mt-1 block rounded-lg border bg-white px-3 py-2 text-xs text-slate-700" value={task.mode} onChange={e => runtime.commit(p => ({ ...p, campaign: { ...p.campaign, searchMode: e.target.value as "focused" | "explore" } }))}>
          <option value="focused">优先验证最值得试的方案</option>
          <option value="explore">比较多个不同方案</option>
        </select>
      </label>
    </div>
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      <div className="rounded-xl border border-indigo-100 bg-white/80 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">修改范围</div><div className="mt-1 text-sm text-slate-700">{task.scope}</div></div>
      <div className="rounded-xl border border-indigo-100 bg-white/80 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">接下来系统会做</div><div className="mt-1 text-sm text-slate-700">生成方案 → 构建实际成果 → 和当前版本对比验证</div></div>
    </div>
    {task.needsEvidence && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">当前问题证据还不够，先补充材料或完成根因诊断，再生成方案。</div>}
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer font-medium text-slate-500">技术人员查看：问题优先级与检索范围</summary>
      <p className="mt-2 leading-5 text-slate-500">系统优先处理已有证据、影响更大的问题。生成方案时最多读取 6 份相关材料，共享 24,000 字符原文预算；未读取部分不会被当成已检查。</p>
      <ol className="mt-2 space-y-2">{queue.map(({ problem, needsEvidence }, index) => <li key={problem.id} className="flex items-center justify-between gap-2 rounded-lg bg-white p-2"><span>{index + 1}. {problem.title} · {needsEvidence ? "待调查" : problem.severity === "high" ? "高影响" : "可改进"}</span><button disabled={runtime.status.busy} className="shrink-0 font-medium text-indigo-600 disabled:opacity-50" onClick={() => runtime.selectProblem(problem.id)}>{problem.id === task.problem?.id ? "当前问题" : "改这个"}</button></li>)}</ol>
    </details>
  </section>;
}
