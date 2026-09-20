
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Bot, ChevronRight, Lightbulb, Play, Send, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAiProviderStatus } from "../ai/service";
import { Textarea } from "@/components/ui/input";
import type { CopilotAiResult } from "../ai/schemas";
import type { ProjectRuntime } from "../runtime/use-project-runtime";

const stageHints = {
  target: ["帮我检查这个目标是否可测量", "哪些内容应该列为保护项？"],
  baseline: ["解释当前 Baseline 的最大短板", "为什么不能直接开始修改？", "我想让它自动进化 5 轮"],
  problem: ["为什么推荐这个问题？", "哪个问题最值得本轮解决？"],
  diagnosis: ["用更简单的方式解释根因", "这个根因的反证条件是什么？"],
  plan: ["比较 A/B/C/D 方案", "为什么需要多个 Candidate？"],
  experiment: ["解释 Winner 为什么胜出", "成本和质量应该怎么权衡？"],
  validation: ["Hidden Holdout 为什么重要？", "现在满足 Release Ready 吗？"],
  release: ["Shadow 和 Canary 有什么区别？", "什么时候应该 Rollback？"],
  learning: ["这次真正学到了什么？", "下一轮为什么优先这个问题？", "生成最佳版本成果包"],
} as const;

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  evidence?: string[];
  suggestedAction?: CopilotAiResult["suggestedAction"];
  suggestedActionLabel?: string;
  executed?: boolean;
};

async function executeCopilotAction(runtime: ProjectRuntime, action: CopilotAiResult["suggestedAction"]) {
  switch (action) {
    case "confirm-target": if (runtime.approveGate("target-ready", "由用户通过 Copilot 动作确认")) runtime.setStage("baseline"); return;
    case "generate-eval-suite": await runtime.generateEvalSuite(); return;
    case "run-baseline": await runtime.executeBaseline(); return;
    case "analyze-problems": await runtime.analyzeProblems(); return;
    case "run-diagnosis": await runtime.diagnose(); return;
    case "generate-plan": await runtime.generatePlan(); return;
    case "approve-experiment": if (runtime.approveGate("experiment-ready", "由用户通过 Copilot 动作确认")) runtime.setStage("experiment"); return;
    case "run-experiment": await runtime.executeExperiment(); return;
    case "run-validation": await runtime.executeValidation(); return;
    case "approve-release": if (runtime.approveGate("release-ready", "由用户通过 Copilot 动作确认")) runtime.setStage("release"); return;
    case "start-shadow": await runtime.releaseAction("shadow"); return;
    case "advance-canary": {
      const current = runtime.project.release.status;
      if (current === "idle" || current === "rolled-back") await runtime.releaseAction("shadow");
      else if (current === "shadow") await runtime.releaseAction("canary-5");
      else if (current === "canary-5") await runtime.releaseAction("canary-20");
      else if (current === "canary-20") await runtime.releaseAction("canary-50");
      else if (current === "canary-50") await runtime.releaseAction("promote");
      return;
    }
    case "distill-learning": await runtime.distill(); return;
    case "generate-next-queue": await runtime.generateNextQueue(); return;
    case "run-campaign-round": await runtime.runCampaignRound(); return;
    case "run-campaign": await runtime.runCampaign(); return;
    case "materialize-outputs": await runtime.materializeOutputs(); return;
    case "none": return;
  }
}

export function StudioAssistant({ runtime }: { runtime: ProjectRuntime }) {
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<{ live: boolean; model: string; provider: string }>();
  const [messages, setMessages] = useState<Message[]>([
    { id: "hello", role: "assistant", text: "我会读取当前项目的目标、Baseline、Trace、Diagnosis、Candidate、Validation 和 Release 状态。除了解释，我也可以给出可执行的下一步；高影响动作仍需要你点击确认。" },
  ]);
  const hints = useMemo(() => stageHints[runtime.stage], [runtime.stage]);

  useEffect(() => {
    setProvider(getAiProviderStatus("copilot", { projectAiProfile: runtime.project.aiProfile }));
  }, [runtime.project.aiProfile]);

  const submit = async (message: string) => {
    const value = message.trim();
    if (!value || runtime.status.busy) return;
    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: "user", text: value }]);
    setInput("");
    try {
      const result = await runtime.askCopilot(value);
      setMessages((current) => [...current, {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: result.answer,
        evidence: result.evidence,
        suggestedAction: result.suggestedAction,
        suggestedActionLabel: result.suggestedActionLabel,
      }]);
    } catch (error) {
      setMessages((current) => [...current, { id: `e-${Date.now()}`, role: "assistant", text: error instanceof Error ? error.message : "AI 暂时无法响应" }]);
    }
  };

  const execute = async (messageId: string, action: CopilotAiResult["suggestedAction"]) => {
    if (action === "none" || runtime.status.busy) return;
    try {
      await executeCopilotAction(runtime, action);
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, executed: true } : message));
    } catch (error) {
      setMessages((current) => [...current, { id: `action-error-${Date.now()}`, role: "assistant", text: error instanceof Error ? `动作未执行：${error.message}` : "动作未执行" }]);
    }
  };

  const onSubmit = (event: FormEvent) => { event.preventDefault(); void submit(input); };

  return <aside className="sticky top-[84px] self-start overflow-hidden rounded-3xl border bg-white soft-shadow">
    <div className="border-b bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4">
      <div className="flex items-center gap-2"><div className="grid size-9 place-items-center rounded-xl bg-indigo-600 text-white"><Bot className="size-4" /></div><div><div className="text-sm font-bold">Evolve Copilot</div><div className={`text-[10px] ${provider?.live ? "text-emerald-600" : "text-amber-600"}`}>{provider ? `Copilot 独立路由 · ${provider.live ? "Live AI" : "Demo AI"} · ${provider.model}` : "读取 Copilot 路由…"}</div></div></div>
      <div className="mt-3 flex gap-2 rounded-xl border border-indigo-100 bg-white/80 p-3"><Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" /><p className="text-xs leading-5 text-slate-600">AI 可以建议并触发流程动作；Gate、Promote、Rollback 等动作必须由你点击按钮确认，服务端仍会再次校验。</p></div>
    </div>

    <div className="max-h-[470px] space-y-3 overflow-y-auto p-4">
      {messages.map((message) => <div key={message.id} className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        {message.role === "assistant" && <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><Sparkles className="size-3.5" /></div>}
        <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-5 ${message.role === "user" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700"}`}>
          {message.text}
          {message.evidence && message.evidence.length > 0 && <div className="mt-2 border-t pt-2 text-[10px] text-slate-400">依据：{message.evidence.join(" · ")}</div>}
          {message.role === "assistant" && message.suggestedAction && message.suggestedAction !== "none" && <Button type="button" size="sm" variant="secondary" disabled={message.executed || runtime.status.busy} className="mt-2 w-full" onClick={() => void execute(message.id, message.suggestedAction!)}><Play className="size-3.5" />{message.executed ? "已执行" : message.suggestedActionLabel || "执行建议动作"}</Button>}
        </div>
        {message.role === "user" && <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><UserRound className="size-3.5" /></div>}
      </div>)}
    </div>

    <div className="border-t p-4">
      <div className="mb-3 space-y-1.5">{hints.map((hint) => <button key={hint} type="button" onClick={() => void submit(hint)} className="flex w-full items-center justify-between rounded-xl border bg-white px-3 py-2 text-left text-[11px] text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50"><span>{hint}</span><ChevronRight className="size-3 text-slate-300" /></button>)}</div>
      <form onSubmit={onSubmit} className="space-y-2"><Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="问 Copilot：为什么推荐这个方案？" className="min-h-20 resize-none" /><Button className="w-full" type="submit" disabled={!input.trim() || runtime.status.busy}><Send className="size-4" />发送给 AI</Button></form>
    </div>
  </aside>;
}
