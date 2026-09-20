import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutonomousAttention } from "../runtime/autonomous-evolution";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { PendingEvidencePanel } from "./stage-panels";

export function AttentionRequestPanel({
  runtime,
  attention,
  onOpenSource,
  onOpenAdvanced,
}: {
  runtime: ProjectRuntime;
  attention: AutonomousAttention;
  onOpenSource: () => void;
  onOpenAdvanced: () => void;
}) {
  const request = attention.request;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  if (!request) return null;

  const continueAutonomously = () => window.setTimeout(() => void runtime.resumeAutonomousEvolution(), 0);
  const revalidateAndContinue = () => window.setTimeout(() => {
    void runtime.requestValidation().then(() => runtime.runAutoPilot());
  }, 0);

  if (request.type === "clarification") {
    const answered = new Set(runtime.project.inputClarifications.filter((item) => item.answer.trim()).map((item) => item.question));
    const pending = request.questions.filter((item) => !answered.has(item.question));
    const submit = () => {
      setError(undefined);
      const missing = pending.filter((item) => !(drafts[item.question] ?? "").trim());
      if (missing.length) {
        setError(`请先回答 ${missing.length} 个会改变结果的问题。`);
        return;
      }
      for (const item of pending) runtime.answerClarification(item.question, drafts[item.question]!.trim());
      continueAutonomously();
    };
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600"/><div><h3 className="font-bold text-slate-950">只需要你确认这 {pending.length || request.questions.length} 项</h3><p className="mt-1 text-sm leading-6 text-slate-600">系统已经自动处理其他低风险歧义。这里只保留会明显改变最终结果的决定；提交后自动从断点继续。</p></div></div>
      <div className="mt-4 space-y-3">{pending.map((item)=><div key={item.question} className="rounded-2xl border bg-slate-50/70 p-4"><div className="text-sm font-semibold text-slate-900">{item.question}</div>{item.whyItMatters&&<p className="mt-1 text-xs leading-5 text-slate-500">为什么需要你：{item.whyItMatters}</p>}<textarea className="mt-3 min-h-20 w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300" value={drafts[item.question]??""} onChange={(event)=>setDrafts((current)=>({...current,[item.question]:event.target.value}))} placeholder="输入你的决定"/>{item.defaultAnswer&&<button type="button" className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800" onClick={()=>setDrafts((current)=>({...current,[item.question]:item.defaultAnswer??""}))}>采用系统建议：{item.defaultAnswer}</button>}</div>)}</div>
      {error&&<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      <div className="mt-4 flex justify-end"><Button disabled={!pending.length||runtime.status.busy} onClick={submit}><Check className="size-4"/>提交并继续自动进化</Button></div>
    </section>;
  }

  if (request.type === "input") {
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6"><h3 className="font-bold text-slate-950">需要补充输入后才能继续</h3><p className="mt-2 text-sm leading-6 text-slate-600">{request.reason}</p><p className="mt-1 text-xs text-slate-400">修正材料或重新上传后，系统会自动重新理解并继续，不需要重新走前面的流程。</p><div className="mt-4"><Button onClick={onOpenSource}>补充或修正材料 <ArrowRight className="size-4"/></Button></div></section>;
  }

  if (request.type === "capability" && /评审|judge/i.test(`${request.title} ${request.reason}`)) {
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600"/><div><h3 className="font-bold text-slate-950">AI 评审服务需要恢复</h3><p className="mt-1 text-sm leading-6 text-slate-600">{request.reason}</p><p className="mt-1 text-xs leading-5 text-slate-400">当前成果、本地 TXT/格式证据和 Candidate 都已保留。这不是视觉、人工或 Runner 证据缺口，不需要重新生成成果。</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><a href="#/settings" className="inline-flex h-9 items-center rounded-xl border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="mr-2 size-4"/>AI 模型与连接</a><Button variant="secondary" onClick={revalidateAndContinue}>重新尝试评审并继续</Button></div>
    </section>;
  }

  if (request.type === "evidence" || request.type === "capability") {
    const ids = new Set(request.criterionIds);
    const criteria = runtime.project.acceptanceRubric.filter((criterion)=>ids.has(criterion.id));
    return <section id="evolve-attention-request" tabIndex={-1} className="space-y-3 outline-none"><div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3"><div className="font-semibold text-amber-950">系统只缺真实验证，不会继续盲目改成果</div><p className="mt-1 text-sm leading-6 text-amber-900/75">{request.reason}</p></div>{criteria.length?<PendingEvidencePanel runtime={runtime} criteria={criteria}/>:<div className="rounded-2xl border bg-white p-4"><p className="text-sm leading-6 text-slate-600">当前需要连接真实 Runner 或对应外部验证能力。配置完成后点击继续，系统会复用当前候选而不是重新生成。</p><div className="mt-3 flex flex-wrap gap-2"><a href="#/settings" className="inline-flex h-9 items-center rounded-xl border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="mr-2 size-4"/>验证能力设置</a><Button variant="secondary" onClick={revalidateAndContinue}>配置完成，重新验证并继续</Button></div></div>}</section>;
  }

  return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6"><h3 className="font-bold text-slate-950">自动进化到达安全边界</h3><p className="mt-2 text-sm leading-6 text-slate-600">{request.reason}</p><p className="mt-1 text-xs text-slate-400">这不是成果完成。调整轮数、预算或时间边界后再继续；系统不会把“跑到上限”冒充成功。</p><div className="mt-4 flex flex-wrap gap-2"><Button onClick={onOpenAdvanced}><Settings2 className="size-4"/>调整高级边界</Button><Button variant="secondary" onClick={continueAutonomously}>按当前设置重试</Button></div></section>;
}

