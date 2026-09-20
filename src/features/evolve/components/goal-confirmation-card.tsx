import { Button } from "@/components/ui/button";
import { goalReadiness } from "../runtime/goal-readiness";
import { retrieveTextContext } from "../runtime/context-retrieval";
import type { ProjectRuntime } from "../runtime/use-project-runtime";

export function GoalConfirmationCard({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const readiness = goalReadiness(p);
  const approved = runtime.gate("target-ready")?.status === "approved";
  const query = `${p.goal} ${p.evolutionCommand}`;
  const originalRequest = [...new Set((p.evolutionCommand || p.goal).split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean))].join("\n");
  if (approved) return <section aria-label="已确认目标" className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-sm font-bold text-slate-900">系统已建立目标与验收标准</h3><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700">自主执行</span></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{p.inputUnderstanding?.intentRestatement || originalRequest}</p></div>
      <Button className="shrink-0" disabled={runtime.status.busy} onClick={() => void runtime.runAutoPilot()}>继续自动进化</Button>
    </div>
    <details className="mt-3 border-t border-emerald-100 pt-2"><summary className="cursor-pointer text-xs font-semibold text-slate-600">查看已确认的要求与边界</summary><dl className="mt-3 grid gap-3 md:grid-cols-3"><div><dt className="text-[10px] font-semibold text-slate-400">原始要求</dt><dd className="mt-1 whitespace-pre-wrap text-xs leading-5">{originalRequest}</dd></div><div><dt className="text-[10px] font-semibold text-slate-400">必须保留</dt><dd className="mt-1 text-xs leading-5">{p.protectedItems.join("；") || "无"}</dd></div><div><dt className="text-[10px] font-semibold text-slate-400">验收标准</dt><dd className="mt-1 text-xs leading-5">{p.acceptanceRubric.map((criterion) => criterion.title).join("；")}</dd></div></dl></details>
  </section>;
  return <section aria-label="目标确认卡" className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-900">{readiness.questions.length ? "需要你确认一个会影响结果的问题" : "系统正在建立进化目标"}</h3><p className="mt-1 text-sm text-slate-600">普通歧义会采用安全默认值继续；只有系统不应该替你决定的事项才会停在这里。</p></div><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700">{readiness.questions.length ? "需要你处理" : "自动处理"}</span></div>
    <dl className="mt-4 grid gap-3 md:grid-cols-2">
      <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-600">你的原始要求</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{originalRequest}</dd></div>
      <div className="rounded-xl bg-indigo-50/50 p-3"><dt className="text-xs font-semibold text-indigo-700">系统理解 · 请核对</dt><dd className="mt-1 text-sm leading-6">{p.inputUnderstanding?.intentRestatement || p.sourceUnderstanding?.evolutionIntent || "等待分析材料和用途"}</dd></div>
      <div><dt className="text-xs font-semibold text-slate-600">必须保留</dt><dd className="mt-1 text-sm leading-6">{p.protectedItems.join("；") || "尚未明确，可在下方修改边界中补充"}</dd></div>
      <div><dt className="text-xs font-semibold text-slate-600">怎样判断完成</dt><dd className="mt-1 text-sm leading-6">{p.acceptanceRubric.length ? p.acceptanceRubric.map((c) => c.title).join("；") : "系统会先整理可核对的验收标准"}</dd></div>
    </dl>
    <details className="mt-4 rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-600">技术人员查看：材料依据与读取范围（{p.sourceArtifacts.length} 份）</summary><p className="mt-2 text-xs leading-5 text-slate-600">以下是按目标检索的原文片段，不代表全文已理解；编号后的 @ 表示文本字符位置。参考材料只作依据，不会自动改写。</p>
      {p.sourceArtifacts.map((a) => <details key={a.id} className="mt-3 border-t pt-2"><summary className="cursor-pointer text-sm font-medium">{a.name} · {a.role === "target" ? "要修改的成果" : a.role === "eval" ? "测试样本" : "参考依据"}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-6">{retrieveTextContext(a.textContent || a.textExcerpt, query, {maxChars:1800,maxChunks:2}) || "没有可展示的原文，请检查解析结果。"}</pre>{a.warnings.length > 0 && <p className="mt-2 text-xs text-amber-800">{a.warnings.join("；")}</p>}</details>)}
      {readiness.warnings.length > 0 && <p className="mt-3 text-xs leading-5 text-amber-800">{readiness.warnings.join("；")}</p>}
    </details>
    {readiness.blockers.length > 0 && <ul className="mt-4 space-y-1 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">{readiness.blockers.map((text) => <li key={text}>{text}</li>)}</ul>}
    <div className="mt-4 flex flex-wrap gap-2">
      <Button disabled={runtime.status.busy} onClick={() => void runtime.runAutoPilot()}>{readiness.ready ? "继续自主进化" : readiness.questions.length ? "处理问题后继续" : "让系统自动处理并继续"}</Button>
    </div>
  </section>;
}
