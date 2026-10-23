import { lazy, Suspense, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutonomousAttention } from "../runtime/autonomous-evolution";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { evidenceRouteForCriterion } from "@evolution/core";
import { isLocalBaselineEvidencePause, isLocalBaselineJudgePause, isLocalDemoBaselinePause } from "@evolution/harness";

// Do not load the large Stage workspace for a simple error notice.
const PendingEvidencePanel=lazy(()=>import("./stage-panels").then(module=>({default:module.PendingEvidencePanel})));

export function AttentionRequestPanel({
  runtime,
  attention,
  serverStartBlocked=false,
  onOpenSource,
  onOpenAdvanced,
  onOpenRuntime,
}: {
  runtime: ProjectRuntime;
  attention: AutonomousAttention;
  serverStartBlocked?:boolean;
  onOpenSource: () => void;
  onOpenAdvanced: () => void;
  onOpenRuntime: () => void;
}) {
  const request = attention.request;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [retrying, setRetrying] = useState(false);

  if (!request) return null;
  const retryDisabled=runtime.status.busy||retrying||serverStartBlocked;

  const continueAutonomously = () => {
    if(serverStartBlocked)return;
    window.setTimeout(() => void runtime.resumeAutonomousEvolution(), 0);
  };
  const retryCampaign = (blockedMessage: string) => {
    if(serverStartBlocked)return;
    setError(undefined);
    setRetrying(true);
    window.setTimeout(() => {
      void runtime.resumeAutonomousEvolution().then((resumed) => {
        if (!resumed) setError(blockedMessage);
      }).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "重试失败，请检查运行状态后再试。");
      }).finally(() => setRetrying(false));
    }, 0);
  };
  const revalidateAndContinue = () => {
    if(serverStartBlocked)return;
    window.setTimeout(() => {void runtime.revalidateAndContinue();}, 0);
  };
  const retryLocalEvidence = async () => {
    if(serverStartBlocked)return;
    setRetrying(true);
    setError(undefined);
    try {
      const resumed = await runtime.revalidateAndContinue();
      if (!resumed) setError(request.diagnosticCode === "artifact-repair-recovery" ? "自动修复或后续验收仍未完成，请查看最新运行记录；当前成果与断点已保留。" : "复验仍未取得完整证据。请根据上面的逐项记录补齐后再试；原 Candidate 已保留。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新验收未能启动，请查看技术运行记录。");
    } finally {
      setRetrying(false);
    }
  };

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
      <div className="mt-4 flex justify-end"><Button disabled={!pending.length||runtime.status.busy||serverStartBlocked} onClick={submit}><Check className="size-4"/>提交并继续自动进化</Button></div>
    </section>;
  }

  if (request.type === "input") {
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6"><h3 className="font-bold text-slate-950">需要补充输入后才能继续</h3><p className="mt-2 text-sm leading-6 text-slate-600">{request.reason}</p><p className="mt-1 text-xs text-slate-400">修正材料或重新上传后，系统会自动重新理解并继续，不需要重新走前面的流程。</p><div className="mt-4"><Button onClick={onOpenSource}>补充或修正材料 <ArrowRight className="size-4"/></Button></div></section>;
  }

  if (request.type === "capability" && (isLocalBaselineEvidencePause(runtime.project) || isLocalBaselineJudgePause(runtime.project))) {
    const judgeIssue = isLocalBaselineJudgePause(runtime.project);
    const demoJudge = isLocalDemoBaselinePause(runtime.project);
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6">
      <h3 className="font-bold text-slate-950">{demoJudge ? "当前基线需要真实 AI 评审" : judgeIssue ? "Baseline 评审未完成" : "当前基线需要补齐可靠验证证据"}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{request.reason}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{demoJudge
        ? "演示评审不能用于诊断或验收。配置并测试真实评审模型后，系统会保留已核验的题目结果，并重新测量当前 Baseline。"
        : judgeIssue
          ? "真实评审调用未完成。请检查并测试 AI 模型连接；本轮断点已保留，恢复后重新测量 Baseline。"
          : "请检查 Target Runner 或文件验证能力。恢复后系统会复用已核验的题目结果，只补测缺少证据的 Baseline 题目。"}</p>
      {error && <p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><a href="#/settings" className="inline-flex h-9 items-center rounded-xl border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="mr-2 size-4"/>{judgeIssue ? "AI 模型与连接" : "验证能力设置"}</a><Button variant="secondary" disabled={retryDisabled} onClick={() => retryCampaign(judgeIssue ? "请先配置并测试真实评审模型，再重新测量基线。" : "请先检查真实评审或 Runner 验证能力，并确认运行边界允许继续。")}>{retrying ? "正在重新测量…" : "配置完成，重新测量基线"}</Button></div>
    </section>;
  }
  if (request.diagnosticCode === "local-evidence-incomplete") {
    const ids = new Set(request.criterionIds);
    const criteria = runtime.project.acceptanceRubric.filter((criterion) => ids.has(criterion.id));
    const scores = runtime.project.validationRun.evaluation?.criterionScores ?? [];
    const runs = runtime.project.validationRun.runs;
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600"/><div><h3 className="font-bold text-slate-950">本地证据未覆盖完整成果</h3><p className="mt-1 text-sm leading-6 text-slate-600">{request.reason}</p><p className="mt-1 text-xs leading-5 text-slate-500">这不是 AI 连接故障，也不是成果质量失败；在证据范围改变前反复点击复验不会产生新结论。</p></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{criteria.map((criterion) => {
        const caseIds = scores.find((score) => score.criterionId === criterion.id)?.testCaseIds
          ?? runtime.project.hiddenEvalSuite.filter((testCase) => testCase.criterionIds.includes(criterion.id)).map((testCase) => testCase.id);
        const run = runs.find((item) => caseIds.includes(item.testCaseId) && item.verificationStatus !== "verified");
        const trace = run?.trace.find((item) => item.status === "warning" || item.status === "fail");
        const detail = run?.error ?? trace?.detail ?? trace?.summary ?? run?.output.slice(0, 160) ?? "未找到本次验收的完整执行记录";
        return <div key={criterion.id} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3"><div className="text-xs font-semibold text-slate-800">{criterion.title} <span className="font-normal text-slate-400">{criterion.id}</span></div><p className="mt-1 text-xs leading-5 text-slate-600">{run?.verificationStatus === "partial" ? "仅有片段/静态证据" : "执行或证据绑定未完成"}：{detail}</p></div>;
      })}</div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{request.suggestedAction}</p>
      {error && <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><Button onClick={onOpenRuntime}>查看技术运行记录 <ArrowRight className="size-4"/></Button><Button variant="secondary" onClick={onOpenSource}>检查输入与目标文件</Button><Button variant="secondary" disabled={retryDisabled} onClick={() => void retryLocalEvidence()}>{retrying ? "正在重新验收…" : "证据补齐后重新验收"}</Button></div>
    </section>;
  }
  if (request.type === "capability" && (request.diagnosticCode === "judge-recovery" || request.title === "AI 评审连接未能完成结构化验收")) {
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6">
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600"/><div><h3 className="font-bold text-slate-950">AI 评审服务需要恢复</h3><p className="mt-1 text-sm leading-6 text-slate-600">{request.reason}</p><p className="mt-1 text-xs leading-5 text-slate-400">当前成果、本地 TXT/格式证据和 Candidate 都已保留。这不是视觉、人工或 Runner 证据缺口，不需要重新生成成果。</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><a href="#/settings" className="inline-flex h-9 items-center rounded-xl border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="mr-2 size-4"/>AI 模型与连接</a><Button variant="secondary" disabled={retryDisabled} onClick={revalidateAndContinue}>重新尝试评审并继续</Button></div>
    </section>;
  }

  if (request.diagnosticCode === "artifact-repair-recovery") {
    return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6">
      <h3 className="font-bold text-slate-950">AI 自动修复需要重试</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{request.reason}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">当前成果和已取得的验证证据已保留。系统将从失败项修复继续，修复成功后重新验证新成果；其余待验证项会随后单独检查。</p>
      {error && <p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2"><a href="#/settings" className="inline-flex h-9 items-center rounded-xl border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="mr-2 size-4"/>AI 模型与连接</a><Button disabled={retryDisabled} onClick={() => void retryLocalEvidence()}>{retrying ? "正在重试修复…" : "重试自动修复并继续"}</Button><Button variant="secondary" onClick={onOpenRuntime}>查看运行记录</Button></div>
    </section>;
  }

  if (request.type === "evidence" || request.type === "capability") {
    const ids = new Set(request.criterionIds);
    const criteria = runtime.project.acceptanceRubric.filter((criterion)=>ids.has(criterion.id));
    const localOnly = criteria.length > 0 && criteria.every((criterion) => evidenceRouteForCriterion(runtime.project, criterion) === "local");
    return <section id="evolve-attention-request" tabIndex={-1} className="space-y-3 outline-none"><div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3"><div className="font-semibold text-amber-950">{localOnly ? "当前成果还有系统检查未完成" : "当前成果还需补充对应验证证据"}</div><p className="mt-1 text-sm leading-6 text-amber-900/75">{request.reason}</p></div>{criteria.length?<Suspense fallback={<div role="status" className="rounded-xl border bg-white p-4 text-sm text-slate-500">正在加载证据核验…</div>}><PendingEvidencePanel runtime={runtime} criteria={criteria}/></Suspense>:<div className="rounded-2xl border bg-white p-4"><p className="text-sm leading-6 text-slate-600">当前需要连接真实 Runner 或对应外部验证能力。配置完成后点击继续，系统会复用当前候选而不是重新生成。</p><div className="mt-3 flex flex-wrap gap-2"><a href="#/settings" className="inline-flex h-9 items-center rounded-xl border bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="mr-2 size-4"/>验证能力设置</a><Button variant="secondary" disabled={retryDisabled} onClick={revalidateAndContinue}>配置完成，重新验证并继续</Button></div></div>}</section>;
  }

  return <section id="evolve-attention-request" tabIndex={-1} className="rounded-3xl border border-amber-200 bg-white p-5 outline-none soft-shadow sm:p-6"><h3 className="font-bold text-slate-950">自动进化到达安全边界</h3><p className="mt-2 text-sm leading-6 text-slate-600">{request.reason}</p><p className="mt-1 text-xs text-slate-400">这不是成果完成。调整轮数、预算或时间边界后再继续；系统不会把“跑到上限”冒充成功。</p>{serverStartBlocked&&<p role="status" className="mt-2 text-xs font-medium text-amber-800">后端旧 Job / Workflow 状态尚待核验，暂不允许重试。可先打开技术运行记录；此操作不会启动新任务。</p>}{error&&<p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}<div className="mt-4 flex flex-wrap gap-2"><Button onClick={onOpenAdvanced}><Settings2 className="size-4"/>调整高级边界</Button><Button variant="secondary" disabled={retryDisabled} onClick={() => retryCampaign("当前设置仍无法启动新一轮，请调整高级边界后重试。")}>{retrying ? "正在重试…" : "按当前设置重试"}</Button></div></section>;
}
