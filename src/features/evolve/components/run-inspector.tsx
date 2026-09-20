// 运行明细查看器：回看已完成节点时，逐题查看模型的执行输出与 Trace。
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TargetRunResult, TestCase } from "../schemas";

function statusBadge(status: string) {
  return status === "pass"
    ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">通过</Badge>
    : status === "fail"
      ? <Badge className="border-rose-200 bg-rose-50 text-rose-700">失败</Badge>
      : status === "info"
        ? <Badge className="border-slate-200 bg-slate-50 text-slate-500">信息</Badge>
        : <Badge className="border-amber-200 bg-amber-50 text-amber-700">注意</Badge>;
}


function verificationBadge(status: TargetRunResult["verificationStatus"], testCase?: TestCase) {
  if (status === "verified") {
    const label = testCase?.executionMode === "external-runner" ? "真实运行证据"
      : testCase?.executionMode === "visual-review" ? "视觉证据"
        : testCase?.executionMode === "manual" ? "人工确认"
          : testCase?.executionMode === "roundtrip" ? "文件确定性证据"
            : testCase?.executionMode === "static-evidence" ? "静态结构证据"
              : "AI 语义证据";
    return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{label}</Badge>;
  }
  if (status === "partial") return <Badge className="border-sky-200 bg-sky-50 text-sky-700">部分/静态证据</Badge>;
  if (status === "failed") return <Badge className="border-rose-200 bg-rose-50 text-rose-700">执行失败</Badge>;
  return <Badge className="border-amber-200 bg-amber-50 text-amber-700">未验证</Badge>;
}

// 模型输出里可能混入字面 <br/> 标签（本该是换行），直接渲染会糊成一面墙；
// 归一成真换行并压缩连续空行，长输出再限高内滚，弹窗不被单题撑满。
function formatOutput(output: string) {
  return output.replace(/<br\s*\/?>/gi, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function RunInspector({ title, runs, testCases, onClose }: { title: string; runs: TargetRunResult[]; testCases: TestCase[]; onClose: () => void }) {
  const titleFor = (testCaseId: string) => testCases.find((testCase) => testCase.id === testCaseId)?.title ?? testCaseId;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
    <div className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <div className="text-sm font-bold">{title}</div>
          <div className="text-xs text-slate-400">共 {runs.length} 题 · 点击蒙层或右上角关闭</div>
        </div>
        <Button variant="ghost" size="sm" className="size-8 p-0" onClick={onClose} aria-label="关闭"><X className="size-4" /></Button>
      </div>
      <div className="space-y-3 overflow-y-auto p-5">
        {runs.map((run) => {
          const testCase = testCases.find((item) => item.id === run.testCaseId);
          const failed = Boolean(run.error);
          return <div key={`${run.testCaseId}-${run.trace.length}`} className={cn("rounded-2xl border", failed && "border-rose-300")}>
            <div className={cn("flex items-center justify-between gap-2 border-b px-4 py-2.5", failed ? "border-rose-200 bg-rose-50" : "bg-slate-50")}>
              <div className="flex min-w-0 items-center gap-2">
                {failed && <Badge className="shrink-0 border-rose-200 bg-rose-100 text-rose-700">执行失败</Badge>}
                {verificationBadge(run.verificationStatus, testCase)}
                <div className={cn("truncate text-xs font-semibold", failed && "text-rose-900")}>{titleFor(run.testCaseId)}</div>
              </div>
              <div className="flex shrink-0 gap-3 text-[10px] text-slate-400">
                {testCase?.hidden && <span>Hidden</span>}
                <span>{(run.latencyMs / 1000).toFixed(1)}s</span>
                <span>¥{run.cost}</span>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <div className={cn("max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl p-3 text-xs leading-5", failed ? "bg-rose-50 text-rose-800" : "bg-slate-50 text-slate-700")}>{formatOutput(run.output)}</div>
              {failed && <div className="rounded-xl border border-rose-200 bg-white p-3 text-[11px] leading-5 text-rose-700"><b>失败原因：</b>{run.error}；可在结果页对失败题发起补考。</div>}
              {!failed && run.verificationStatus === "unverified" && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><b>未验证：</b>当前 Runtime 没有这道题所需的真实执行、视觉或人工证据能力。这个状态不会被解释为成果失败，但 Release 前必须补齐。</div>}
              {!failed && run.verificationStatus === "partial" && <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-[11px] leading-5 text-sky-800"><b>部分证据：</b>当前只获得静态源码/结构证据，能证明实现线索存在，但不能证明真实用户行为或 E2E 已通过。</div>}
              {!failed && run.verificationStatus === "verified" && testCase?.executionMode === "artifact-runtime" && <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-5 text-violet-800"><b>证据边界：</b>AI 已读取完整成果快照并定位本题要求的内容，可用于确认显性内容存在、缺失或矛盾；这不代表浏览器 E2E、视觉体验或真人照做已经通过。</div>}
              {run.trace.length > 0 && <div className="space-y-1.5">
                {run.trace.map((step) => <div key={step.id} className="rounded-lg border px-3 py-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-600">{step.stage}</span>
                    {statusBadge(step.status)}
                  </div>
                  <div className="mt-1 leading-5 text-slate-500">{step.summary}{step.detail ? ` · ${step.detail}` : ""}</div>
                </div>)}
              </div>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
