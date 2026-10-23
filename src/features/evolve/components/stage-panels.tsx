import { BaselineRetryAction } from "./baseline-retry-action";
import { experimentNeedsEvidenceRepair, computeGapAnalysis, buildGapAdvicePayload, evidenceRouteForCriterion, productionOutcomeFreshness, productionOutcomeTrend, projectHasOnlineReleaseTarget, releaseAuditTimeline, requiresSandboxHtmlSourceExecution, type GapAnalysis } from "@evolution/core";
import { compileUserEvolutionSteps, preferredInternalStage, stepForStage, workflowStepState } from "../runtime/real-evolution-workflow";

import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  Eye,
  FileText,
  FlaskConical,
  GitCompareArrows,
  GripVertical,
  History,
  Info,
  Loader2,
  LockKeyhole,
  Plus,
  Play,
  PlugZap,
  RefreshCcw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Unplug,
  WandSparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EvalSuiteEditor } from "./eval-suite-editor";
import { FocusedTaskCard } from "./focused-task-card";

import { RunInspector } from "./run-inspector";
import { putArtifactBlob } from "../runtime/artifact-blob-store";
import { resetDownstream } from "../runtime/downstream";
import {sourceParseLabel,sourceParseState} from "../runtime/source-parse-presentation";
import { ingestSources, runAi } from "../runtime/api";
import { GapClusterAiResultSchema, GapAdviceAiResultSchema, type GapClusterAiResult } from "../ai/schemas";

import type { AcceptanceCriterion, AdviceSettlement, EvolveProject, SourceArtifact, TargetRunResult, ValidationRun } from "../schemas";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { resolveProjectArtifactStrategy } from "../runtime/artifact-strategy";
import { GoalConfirmationCard } from "./goal-confirmation-card";
import { goalReadiness } from "../runtime/goal-readiness";
import { baselineReadiness } from "../runtime/baseline-readiness";
import { evidenceRefSummary } from "../runtime/evidence-provenance";
import { addVisualEvidence, getVisualEvidence, VISUAL_EVIDENCE_EVENT } from "../runtime/visual-evidence";
import { connectedTargetConnection, getRunnerGatewayConfig, getTargetProxyCapabilities, testRunnerGateway } from "../runtime/target-runner-config";
import { latestSupplementalEvidenceForCriterion } from "../runtime/supplemental-validation-evidence";
import { checkServerVercelReleaseHealth, getServerVercelReleaseCapabilities, listServerVercelDeployments } from "../runtime/server-release-client";
import type { TargetProxyCapabilities, VercelDeploymentSummary, VercelReleaseCapabilities, VercelReleaseHealth } from "@evolution/contracts";

// 交付物预览与下载会带入格式化、压缩等依赖，只在到达交付阶段后再加载。
const ProjectOutputsPanel = lazy(() => import("./project-outputs-panel").then((module) => ({ default: module.ProjectOutputsPanel })));

function SectionTitle({ eyebrow, title, desc, action }: { eyebrow: string; title: string; desc: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-indigo-500">{eyebrow}</div><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{desc}</p></div>{action}</div>;
}

function GateCard({ title, approved, onApprove, disabled, children }: { title: string; approved: boolean; onApprove: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border p-4", approved ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/50")}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-semibold">{approved ? <BadgeCheck className="size-4 text-emerald-600" /> : <LockKeyhole className="size-4 text-amber-600" />}{title}</div><div className="mt-1 text-xs leading-5 text-slate-500">{children}</div></div><Button variant={approved ? "secondary" : "default"} disabled={approved || disabled} onClick={onApprove}>{approved ? "已确认" : "确认并继续"}</Button></div></div>;
}

/** 次要面板折叠容器：验证页只把核心结论平铺，归因/建议/账本收进可展开区块，避免一屏堆满。 */
function CollapsibleSection({ title, meta, defaultOpen = false, children }: { title: string; meta?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <div className="overflow-hidden rounded-2xl border bg-white">
    <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-slate-50">
      {open ? <ChevronDown className="size-4 shrink-0 text-slate-400" /> : <ChevronRight className="size-4 shrink-0 text-slate-400" />}
      <span className="text-sm font-semibold text-slate-800">{title}</span>
      {meta && <span className="truncate text-[11px] text-slate-400">{meta}</span>}
      <span className="ml-auto shrink-0 text-[11px] text-slate-400">{open ? "收起" : "展开"}</span>
    </button>
    {open && <div className="space-y-3 border-t bg-slate-50/40 p-4">{children}</div>}
  </div>;
}

/** 统一技术入口：业务用户默认只看结论与下一步，证据链、Trace、评分参数等按需展开。 */
function TechnicalDetails({ label = "技术人员查看", meta, children }: { label?: string; meta?: string; children: React.ReactNode }) {
  return <CollapsibleSection title={label} meta={meta}>{children}</CollapsibleSection>;
}

// 进化命令是分次追加的拼接文本；拆成条目展示，并允许逐条撤回追加的要求（原始命令本身保留）。
type EvolutionItem = { kind: "base" | "extra" | "gap"; text: string };

function splitEvolutionCommand(command: string): EvolutionItem[] {
  const parts = command.split(/\n\n(补充要求：|重点加强（来自差距聚类）：)/);
  const items: EvolutionItem[] = parts[0]?.trim() ? [{ kind: "base", text: parts[0] }] : [];
  for (let index = 1; index + 1 < parts.length; index += 2) items.push({ kind: parts[index] === "补充要求：" ? "extra" : "gap", text: parts[index + 1] ?? "" });
  return items.filter((item) => item.text.trim());
}

function joinEvolutionCommand(items: EvolutionItem[]): string {
  let result = "";
  for (const item of items) {
    result += item.kind === "base" ? (result ? `\n\n${item.text}` : item.text) : (result ? (item.kind === "extra" ? `\n\n补充要求：${item.text}` : `\n\n重点加强（来自差距聚类）：${item.text}`) : item.text);
  }
  return result;
}

// 进化要求是项目级全局契约，容易被误读成「只在当前节点用一次」；
// 在命令编辑区与各个「转为进化要求」入口统一说明它被哪些节点读取、何时生效。
export function CommandScopeNote({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <p className="mt-2 text-[10px] leading-4 text-slate-400">加入后会并入项目级进化要求：之后每一次作答（Baseline / 实验 / 盲测 / 补考）与每一次 AI 决策（出题、分析、诊断、方案、评审、归因）都会读取它，自下一次运行起生效；不会插队正在运行的轮次，也不改写已存档结论。</p>;
  }
  return <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-[11px] leading-5 text-indigo-900/80">
    <div className="flex items-center gap-1.5 font-semibold text-indigo-700"><Info className="size-3.5" />这些要求在哪里生效</div>
    <ul className="mt-1.5 space-y-1">
      <li>· 作答层：之后 Baseline 体检、沙箱实验、盲测验证、失败补考的每一次作答，都会带着这些要求生成；</li>
      <li>· 决策层：出题、问题分析、根因诊断、方案生成、发布评审、差距归因都会读取这些要求，候选方案必须遵守；</li>
      <li>· 时间层：自下一次运行起生效，不插队正在运行的自动轮，不追溯改写已存档分数；多条要求累积生效，排在前面的视为更强调。</li>
    </ul>
  </div>;
}

function AcceptanceRubricEditor({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const state = p.acceptanceRubricState;
  const criteria = p.acceptanceRubric;
  const strategy = resolveProjectArtifactStrategy(p);
  const hardCount = criteria.filter((criterion) => criterion.hardGate).length;
  const userCount = criteria.filter((criterion) => criterion.source === "user-command" || criterion.source === "source-understanding").length;
  const statusTone = state.status === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : state.status === "invalid" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700";

  const patch = (criterion: AcceptanceCriterion, next: Partial<AcceptanceCriterion>) => runtime.updateAcceptanceCriterion(criterion.id, next);
  return <Card className={state.status === "ready" ? "border-emerald-200" : "border-indigo-200"}><CardContent className="pt-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-slate-900">怎样判断这次真的改好了</div><Badge className={statusTone}>{state.status === "ready" ? "已整理" : "待整理"}</Badge></div><p className="mt-1 text-sm leading-6 text-slate-500">系统会用下面这些要求检查新版。业务用户只需要确认内容是否符合预期，评分权重和证据规则由技术人员维护。</p></div>
      <Button variant="soft" size="sm" disabled={runtime.status.busy} onClick={() => void runtime.compileAcceptanceRubric(criteria.length > 0)}><WandSparkles className="size-3.5" />{criteria.length ? "重新整理" : "整理验收标准"}</Button>
    </div>
    {criteria.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{criteria.slice(0, 8).map((criterion) => <Badge key={criterion.id} className={criterion.hardGate ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-700"}>{criterion.title}{criterion.hardGate ? " · 必须通过" : ""}</Badge>)}{criteria.length > 8 && <Badge>+{criteria.length - 8}</Badge>}</div>}
    {state.status !== "ready" && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">验收标准还没有准备好。先点击“整理验收标准”，系统会根据你的要求和必须保留的内容自动生成。</div>}
    <div className="mt-4"><TechnicalDetails label="技术人员查看：评分规则、证据要求与验收策略" meta={`${criteria.length} 项 · ${hardCount} 项必须通过`}>
      <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50/70 to-sky-50/60 p-4"><div className="text-xs font-semibold text-violet-800">成果策略：{strategy.label}</div><p className="mt-1 text-[11px] leading-5 text-slate-600">{strategy.description}</p><div className="mt-2 flex flex-wrap gap-1.5"><Badge>用户目标 {strategy.userGoalBudget}%</Badge><Badge>成果质量 {strategy.artifactBudget}%</Badge><Badge>系统完整性 {strategy.systemBudget}%</Badge></div></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border bg-white p-3 text-xs">Criteria <b>{criteria.length}</b></div><div className="rounded-xl border bg-white p-3 text-xs">Weight <b>{state.weightTotal.toFixed(1)}</b></div><div className="rounded-xl border bg-white p-3 text-xs">Hard <b>{hardCount}</b></div><div className="rounded-xl border bg-white p-3 text-xs">用户来源 <b>{userCount}</b></div></div>
      {state.warnings.length > 0 && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{state.warnings.join("；")}</div>}
      {state.uncoveredCriterionIds.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">未覆盖测试：{state.uncoveredCriterionIds.join("、")}</div>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={!criteria.length} onClick={runtime.normalizeRubricWeights}>权重归一</Button><Button variant="secondary" size="sm" onClick={runtime.addAcceptanceCriterion}><Plus className="size-3.5" />新增验收项</Button></div>
      <div className="space-y-2">{criteria.map((criterion) => { const locked = criterion.id.startsWith("SYS-") || criterion.id.startsWith("PROTECT-"); return <div key={criterion.id} className={`rounded-2xl border p-3 ${criterion.hardGate ? "border-rose-100 bg-rose-50/30" : "bg-white"}`}><div className="grid gap-2 xl:grid-cols-[150px_minmax(220px,1fr)_82px_96px_100px_110px_auto] xl:items-start"><input className="h-8 rounded-lg border bg-white px-2 text-xs font-semibold" value={criterion.title} onChange={(e) => patch(criterion, { title: e.target.value })} /><textarea className="min-h-16 resize-y rounded-lg border bg-white px-2 py-1.5 text-xs leading-5" value={criterion.requirement} onChange={(e) => patch(criterion, { requirement: e.target.value })} /><input type="number" min={0} max={100} className="h-8 rounded-lg border bg-white px-2 text-xs" value={criterion.weight} onChange={(e) => patch(criterion, { weight: Number(e.target.value) || 0 })} /><input type="number" min={0} max={100} className="h-8 rounded-lg border bg-white px-2 text-xs" value={criterion.minScore} onChange={(e) => patch(criterion, { minScore: Number(e.target.value) || 0 })} /><select className="h-8 rounded-lg border bg-white px-1 text-[10px]" value={criterion.judgeType} onChange={(e) => patch(criterion, { judgeType: e.target.value as AcceptanceCriterion["judgeType"] })}><option value="llm">LLM</option><option value="structural">Structural</option><option value="integrity">完整性</option><option value="pairwise">Pairwise</option></select><div className="space-y-1 text-[10px]"><label className="flex gap-1"><input type="checkbox" checked={criterion.hardGate} onChange={(e) => patch(criterion, { hardGate: e.target.checked })}/>Hard</label><label className="flex gap-1"><input type="checkbox" checked={criterion.protectedConstraint} onChange={(e) => patch(criterion, { protectedConstraint: e.target.checked })}/>Protected</label></div>{!locked ? <Button variant="ghost" size="sm" className="text-rose-500" onClick={() => runtime.deleteAcceptanceCriterion(criterion.id)}><X className="size-3.5" /></Button> : <span/>}</div><textarea className="mt-2 min-h-12 w-full rounded-lg border bg-white px-2 py-1.5 text-[11px]" value={criterion.evidenceExpected.join("\n")} onChange={(e) => patch(criterion, { evidenceExpected: e.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })}/></div>; })}</div>
    </TechnicalDetails></div>
  </CardContent></Card>;
}

/** 深度输入理解卡：后台复述意图 / 隐含要求 / 默认假设，并把歧义变成可回答的确认题。
 *  用户亲答或采用默认假设都会写入口径，后续验收、出题、方案全部按同一套意图执行。 */
function InputUnderstandingCard({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const understanding = p.inputUnderstanding;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const answered = (question: string) => p.inputClarifications.find((item) => item.question === question);

  return <Card><CardContent className="pt-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600"><Sparkles className="size-4 text-indigo-600" />AI 深度理解</div>
      <div className="flex items-center gap-2">
        {understanding?.status === "running" && <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700"><Loader2 className="mr-1 size-3 animate-spin" />后台理解中</Badge>}
        {understanding?.status === "ready" && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><Check className="mr-1 size-3" />理解草案已就绪 · 请核对</Badge>}
        {understanding?.status === "failed" && <Badge className="border-rose-200 bg-rose-50 text-rose-700">理解失败：{understanding.error}</Badge>}
        <Button variant="ghost" size="sm" disabled={runtime.status.busy || understanding?.status === "running"} onClick={() => void runtime.deepenUnderstanding()}><RefreshCcw className="size-3.5" />{understanding?.status === "ready" ? "重新理解" : "开始理解"}</Button>
      </div>
    </div>
    {!understanding || understanding.status === "running" ? (
      <p className="mt-3 text-xs leading-5 text-slate-400">{understanding?.status === "running" ? "正在分析可读取的材料，整理目标、建议和需要确认的问题。" : "系统根据已解析材料整理理解草案；请核对原文依据，确认可能影响方向的问题。"}</p>
    ) : (
      <div className="mt-3 space-y-3">
        <p className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs leading-5 text-indigo-900/90"><b>AI 复述的意图：</b>{understanding.intentRestatement || "—"}</p>
        {(understanding.implicitRequirements.length > 0 || understanding.assumptions.length > 0) && (
          <div className="grid gap-3 md:grid-cols-2">
            {understanding.implicitRequirements.length > 0 && <div><div className="text-[10px] font-semibold text-slate-400">系统建议（未确认前不作为强制要求）</div><div className="mt-1.5 flex flex-wrap gap-1.5">{understanding.implicitRequirements.slice(0, 6).map((item) => <Badge key={item} className="border-sky-200 bg-sky-50 text-sky-700">{item}</Badge>)}</div></div>}
            {understanding.assumptions.length > 0 && <div><div className="text-[10px] font-semibold text-slate-400">AI 的默认假设（不同意可直接改口径）</div><div className="mt-1.5 flex flex-wrap gap-1.5">{understanding.assumptions.slice(0, 6).map((item) => <Badge key={item} className="border-amber-200 bg-amber-50 text-amber-700">{item}</Badge>)}</div></div>}
          </div>
        )}
        {understanding.acceptanceFocus.length > 0 && <div><div className="text-[10px] font-semibold text-slate-400">「变好」的观察点</div><div className="mt-1.5 flex flex-wrap gap-1.5">{understanding.acceptanceFocus.slice(0, 6).map((item) => <Badge key={item} className="border-emerald-200 bg-emerald-50 text-emerald-700">{item}</Badge>)}</div></div>}
        {understanding.clarifications.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold text-slate-400">待确认的歧义（回答后全部下游环节按你的口径执行）</div>
            {understanding.clarifications.map((item) => {
              const done = answered(item.question);
              return <div key={item.question} className="rounded-xl border bg-slate-50/70 p-3">
                <div className="text-xs font-semibold text-slate-800">{item.question}</div>
                <div className="mt-1 text-[10px] leading-4 text-slate-500">为什么重要：{item.whyItMatters}</div>
                {done ? (
                  <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] leading-4 text-emerald-800"><b>{done.answeredBy === "user" ? "你的回答" : "AI 默认假设"}</b>：{done.answer}</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <textarea className="min-h-10 w-full rounded-lg border bg-white px-2 py-1.5 text-[11px] leading-4 outline-none focus:border-indigo-300" placeholder="你的回答（留空则可采用默认假设）" value={drafts[item.question] ?? ""} onChange={(e) => setDrafts((current) => ({ ...current, [item.question]: e.target.value }))} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={!((drafts[item.question] ?? "").trim())} onClick={() => { runtime.answerClarification(item.question, drafts[item.question] ?? ""); setDrafts((current) => ({ ...current, [item.question]: "" })); window.setTimeout(() => void runtime.runAutoPilot(), 0); }}>按此回答并继续</Button>
                      <Button size="sm" variant="ghost" onClick={() => { runtime.answerClarification(item.question, item.defaultAnswer, "ai-assumption"); window.setTimeout(() => void runtime.runAutoPilot(), 0); }}>采用默认假设并继续：{item.defaultAnswer.slice(0, 24)}{item.defaultAnswer.length > 24 ? "…" : ""}</Button>
                    </div>
                  </div>
                )}
              </div>;
            })}
          </div>
        )}
        {p.inputClarifications.length > 0 && <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-[10px] leading-4 text-slate-500">已确认口径 {p.inputClarifications.length} 条，会随自主进化持续生效；处理完需要人工确认的问题后系统会自动继续。</div>}
      </div>
    )}
  </CardContent></Card>;
}

function TargetPanel({ runtime,serverStartBlocked=false }: { runtime: ProjectRuntime;serverStartBlocked?:boolean }) {
  const p = runtime.project;
  const approved = runtime.gate("target-ready")?.status === "approved";
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceId, setReplaceId] = useState<string>();
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceNote, setReplaceNote] = useState<string>();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const commandItems = splitEvolutionCommand(p.evolutionCommand);
  // 拖拽排序：追加项的先后顺序写回进化命令文本，即 AI 读到要求的强调顺序；原始命令固定第一。
  const reorderCommandItem = (from: number, to: number) => {
    if (from === to || to === 0 || commandItems[from]?.kind === "base") return;
    const items = [...commandItems];
    const [moved] = items.splice(from, 1);
    items.splice(Math.max(1, to), 0, moved);
    runtime.commit((current) => {
      const next = { ...current, evolutionCommand: joinEvolutionCommand(items) };
      return moved.kind === "gap" ? next : resetDownstream(next);
    });
  };
  const removeCommandItem = (index: number) => {
    const removed = commandItems[index];
    if (!removed || removed.kind === "base") return;
    runtime.commit((current) => {
      const next = {
        ...current,
        evolutionCommand: joinEvolutionCommand(commandItems.filter((_, position) => position !== index)),
        commandHistory: [
          ...current.commandHistory,
          { id: `cmd-remove-${Date.now()}`, role: "system" as const, content: `已撤回一条追加的进化要求（${removed.kind === "gap" ? "来自差距聚类" : "补充要求"}）：${removed.text.slice(0, 120)}。${removed.kind === "gap" ? "它只影响下一次生成方案，历史评测保留。" : "目标契约已变化，旧评测与候选已失效。"}`, artifactIds: [], createdAt: new Date().toISOString() },
        ],
      };
      return removed.kind === "gap" ? next : resetDownstream(next);
    });
  };

  const replaceArtifact = async (artifactId: string, file: File) => {
    const old = p.sourceArtifacts.find((item) => item.id === artifactId);
    if (!old) return;
    setReplaceBusy(true); setReplaceNote(undefined);
    try {
      const [fresh] = await ingestSources({ files: [file], role: old.role });
      if (!fresh) throw new Error("未能读取新文件");
      // 保持原 id / 角色，让历史命令记录里对该附件的引用继续有效。
      const replacement: SourceArtifact = { ...fresh, id: old.id, role: old.role, textExcerpt: fresh.textExcerpt || `[附件] ${file.name}` };
      await putArtifactBlob(old.id, file);
      const replacementState=sourceParseState(replacement);
      const failed=replacementState==="failed";
      runtime.commit((current) => resetDownstream({
        ...current,
        inputUnderstanding: undefined, inputClarifications: [], sourceUnderstanding: undefined,
        sourceArtifacts: current.sourceArtifacts.map((item) => (item.id === artifactId ? replacement : item)),
        commandHistory: [
          ...current.commandHistory,
          { id: `cmd-replace-${Date.now()}`, role: "system", content: `已将解析异常的附件替换为「${file.name}」（${failed ? "新文件仍未解析成功" : replacementState==="partial" ? "仅完成部分读取" : "内容读取成功"}）。进化输入已变化，旧的评测与实验结论作废，需要重跑流程。`, artifactIds: [old.id], createdAt: new Date().toISOString() },
        ],
      }));
      setReplaceNote(failed ? "新文件仍未解析成功，建议另存为标准格式或直接粘贴文字内容。" : replacementState==="partial" ? "附件已替换，但仅完成部分读取。请查看解析限制，并重新确认 Target Ready 后重跑后续步骤。" : "附件已替换，内容读取成功。进化输入变化后旧结论已作废，请重新确认 Target Ready 并重跑后续步骤。");
    } catch (e) {
      setReplaceNote(e instanceof Error ? e.message : "替换附件失败");
    } finally {
      setReplaceId(undefined);
      setReplaceBusy(false);
    }
  };

  return <div className="space-y-4">
    {replaceNote && <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{replaceNote}</div>}
    <input ref={replaceRef} type="file" className="hidden" onChange={(e) => { const picked = e.target.files?.[0]; if (picked && replaceId) void replaceArtifact(replaceId, picked); e.currentTarget.value = ""; }} />
    <GoalConfirmationCard runtime={runtime} serverStartBlocked={serverStartBlocked}/>
    {approved ? <details className="rounded-2xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">查看 AI 理解与已确认口径</summary><div className="mt-3"><InputUnderstandingCard runtime={runtime} /></div></details> : <InputUnderstandingCard runtime={runtime} />}
    <details className="rounded-2xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">调整原始要求、修改边界和验收标准</summary><div className="mt-4 space-y-4">
    <Card><CardContent className="pt-5"><div className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]"><div className="rounded-2xl border bg-slate-50 p-4"><div className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">你的原始要求</div>
      {commandItems.length ? <div className="mt-2 space-y-1.5">
        {commandItems.map((item, index) => <div key={`${item.kind}-${index}`} draggable={item.kind !== "base"} onDragStart={() => setDragIndex(index)} onDragOver={(event) => { if (item.kind !== "base" || index === 0) event.preventDefault(); }} onDrop={() => { if (dragIndex !== null) reorderCommandItem(dragIndex, index); setDragIndex(null); }} onDragEnd={() => setDragIndex(null)} className={cn("rounded-xl border bg-white p-2.5 transition", item.kind !== "base" && "cursor-grab active:cursor-grabbing", dragIndex === index && "opacity-60 ring-2 ring-indigo-300")}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">{item.kind !== "base" && <GripVertical className="size-3.5 shrink-0 text-slate-300" />}<Badge className={item.kind === "base" ? "border-slate-200 bg-slate-100 text-slate-600" : item.kind === "gap" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-sky-200 bg-sky-50 text-sky-700"}>{item.kind === "base" ? "原始命令" : item.kind === "gap" ? "差距聚类转化" : "补充要求"}</Badge></div>
            {item.kind !== "base" && <button type="button" onClick={() => removeCommandItem(index)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">撤回</button>}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-xs font-medium leading-5 text-slate-800">{item.text}</p>
        </div>)}
      </div>
      : <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-800">{p.desiredOutcome || "未记录原始进化命令"}</p>}
      {commandItems.length > 1 && <div className="mt-2 text-[10px] leading-4 text-slate-400">共 {commandItems.length} 条进化要求。拖动可调整强调顺序；差距建议只影响下一次方案。补充要求属于目标契约，调整或撤回后旧候选与评测会失效，避免用旧证据验证新目标。</div>}
      {commandItems.length > 0 && <CommandScopeNote />}
      {p.sourceUnderstanding?.currentStateSummary && <div className="mt-3 border-t pt-3 text-xs leading-5 text-slate-500">AI 理解：{p.sourceUnderstanding.currentStateSummary}</div>}</div><div className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between"><div className="text-xs font-semibold text-slate-600">本轮进化输入</div><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{p.sourceArtifacts.length} 个对象</Badge></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{p.sourceArtifacts.length ? p.sourceArtifacts.map((artifact) => { const state=sourceParseState(artifact); const flagged=state==="failed"; const partial=state==="partial"; return <div key={artifact.id} className={cn("flex items-start gap-2 rounded-xl border p-3", flagged ? "border-rose-200 bg-rose-50/60" : partial ? "border-amber-200 bg-amber-50/60" : "bg-slate-50")}><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-indigo-600"><FileText className="size-4" /></div><div className="min-w-0"><div className={cn("truncate text-xs font-semibold", flagged ? "text-rose-800" : "text-slate-700")}>{artifact.name}</div><div className={cn("mt-0.5 text-[10px]", flagged ? "font-semibold text-rose-600" : partial ? "font-semibold text-amber-700" : "text-slate-400")}>{artifact.role === "target" ? "进化对象" : artifact.role === "eval" ? "测试样本" : "参考材料"} · {flagged ? "解析异常，AI 读不到正文" : partial ? "仅完成部分解析" : sourceParseLabel(artifact)}</div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{artifact.summary || artifact.textExcerpt || "已接收"}</p>{(flagged || partial) && artifact.warnings[0] && <p className={cn("mt-1 line-clamp-2 text-[10px] leading-4",flagged?"text-rose-600":"text-amber-700")}>{artifact.warnings[0]}</p>}{flagged && <button disabled={replaceBusy} onClick={() => { setReplaceId(artifact.id); replaceRef.current?.click(); }} className="mt-1.5 rounded-lg border border-rose-300 bg-white px-2 py-1 text-[10px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50">重新上传替换</button>}</div></div>; }) : <div className="col-span-full rounded-xl border border-dashed p-5 text-center text-xs text-slate-400">该项目没有附件输入；建议从工作台重新创建带 Source Artifact 的进化项目。</div>}</div></div></div></CardContent></Card>
    <Card><CardContent className="pt-5"><div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><div><div className="text-xs font-semibold text-slate-500">主要目标</div><p className="mt-2 text-[15px] font-medium leading-7 text-slate-900">{p.goal}</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{p.metrics.map((m) => <div key={m.key} className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-400">{m.label}</div><div className="mt-1 text-sm font-semibold">目标 {m.direction === "lower" ? "≤" : "≥"} {m.unit === "%" ? `${m.target}%` : `${m.target} ${m.unit}`}</div></div>)}</div></div><div className="rounded-2xl border bg-slate-50 p-4"><div className="text-xs font-semibold text-slate-500">本轮修改边界</div><div className="mt-3 text-xs font-semibold text-slate-700">允许 AI 修改</div><div className="mt-2 flex flex-wrap gap-1.5">{p.editableItems.map((x) => <Badge key={x} className="border-indigo-200 bg-indigo-50 text-indigo-700">{x}</Badge>)}</div><div className="mt-4 text-xs font-semibold text-slate-700">保持不变</div><div className="mt-2 flex flex-wrap gap-1.5">{p.protectedItems.map((x) => <Badge key={x}>{x}</Badge>)}</div></div></div></CardContent></Card>
    <AcceptanceRubricEditor runtime={runtime} />
    <GateCard title="确认目标与验收标准" approved={approved} disabled={p.acceptanceRubricState.status !== "ready" || !goalReadiness(p).ready} onApprove={() => runtime.approveGate("target-ready", "用户确认目标、验收标准与修改边界")}>核对系统理解、待确认问题和必须保留的内容后开始。关键要求变化后需要重新确认。</GateCard>
    {approved && <div className="flex justify-end"><Button onClick={() => runtime.setStage("baseline")}>进入当前基线 <ArrowRight className="size-4" /></Button></div>}
    </div></details>
  </div>;
}

function ScoreCard({ label, value, unit = "%", target }: { label: string; value?: number; unit?: string; target?: number }) {
  const available = value !== undefined && Number.isFinite(value);
  return <div className="rounded-2xl border bg-white p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold">{available ? unit === "%" ? `${Math.round(value)}%` : `${value} ${unit}` : "待评"}</div>{available && target !== undefined && <><div className="mt-3 flex justify-between text-[10px] text-slate-400"><span>当前</span><span>目标 {unit === "%" ? `${target}%` : `${target} ${unit}`}</span></div><Progress className="mt-1" value={Math.min(100, unit === "%" ? value / target * 100 : target / Math.max(value, 0.01) * 100)} /></>}</div>;
}

/** 验证报告（Markdown）：汇总结论、分数、检查项，并完整带出实验/盲测的失败与补考履历。 */
function validationReportMarkdown(project: EvolveProject, v: ValidationRun, winnerTitle: string): string {
  const lines: string[] = [];
  lines.push(`# Evolve 验证报告 · ${project.name}`);
  lines.push(`- 项目版本：${project.version} ｜ 导出时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push(`- 发布结论：${v.recommendation === "release" ? "✅ 可发布" : v.recommendation === "reject" ? "⛔ 拒绝" : "⏸ 暂缓"} ｜ Winner：${winnerTitle}`);
  lines.push(`- 结论摘要：${v.summary ?? "—"}`);
  if (v.evaluation) {
    lines.push("", "## Holdout 分数", `- 准确率 ${v.evaluation.accuracy}% ｜ 证据 ${v.evaluation.evidence}% ｜ 风险覆盖 ${v.evaluation.riskCoverage}% ｜ 完成度 ${v.evaluation.completeness}%`, `- 平均成本 ¥${v.evaluation.averageCost} ｜ 平均延迟 ${Math.round(v.evaluation.averageLatencyMs / 1000)}s ｜ Safety ${v.evaluation.safety}`);
    if (v.baselineEvaluation) lines.push(`- 当前版本同卷对照：准确率 ${v.baselineEvaluation.accuracy}% ｜ 完成度 ${v.baselineEvaluation.completeness}%`);
  }
  if (v.previousEvaluation && v.evaluation) {
    lines.push("", "## 验证补考对比（前 → 后）", `- 准确率 ${v.previousEvaluation.accuracy}% → ${v.evaluation.accuracy}% ｜ 证据 ${v.previousEvaluation.evidence}% → ${v.evaluation.evidence}% ｜ 风险 ${v.previousEvaluation.riskCoverage}% → ${v.evaluation.riskCoverage}% ｜ 成本 ¥${v.previousEvaluation.averageCost} → ¥${v.evaluation.averageCost}`);
  }
  if (v.checks.length) lines.push("", "## 发布检查项", ...v.checks.map((check) => `- [${check.status === "pass" ? "x" : check.status === "fail" ? "!" : "~"}] ${check.label}：${check.detail}`));
  const titleFor = (id: string) => project.hiddenEvalSuite.find((item) => item.id === id)?.title ?? id;
  if (v.evaluation && v.baselineEvaluation) {
    // 差距归因：让报告读者不只看两个总分，能直接看到差距来自哪道题、差多少、为什么。
    const analysis = computeGapAnalysis({ candidate: v.evaluation, baseline: v.baselineEvaluation, candidateRuns: v.runs, baselineRuns: v.baselineRuns, testCases: project.hiddenEvalSuite });
    lines.push("", `## 同卷差距归因（容差 ${analysis.tolerance} 分）`, `- ${analysis.summary}`);
    for (const dimension of analysis.dimensions) {
      const lag = dimension.diff > 0 ? `落后 ${Math.round(dimension.diff)} 分${dimension.exceeded ? "（超出容差）" : ""}` : dimension.diff < 0 ? `领先 ${Math.round(-dimension.diff)} 分` : "持平";
      lines.push(`- ${dimension.label}：候选 ${Math.round(dimension.candidate)}% vs 当前版本 ${Math.round(dimension.baseline)}% —— ${lag}`);
    }
    if (analysis.hasPerCase) {
      lines.push("- 逐题对比（按落后程度排序，主因题在前）：");
      const driverIds = new Set(analysis.drivers.map((driver) => driver.testCaseId));
      for (const item of [...analysis.cases].sort((a, b) => (a.delta ?? -101) - (b.delta ?? -101))) {
        const flags = [driverIds.has(item.testCaseId) ? "主因" : "", item.candidateFailed ? "候选执行失败" : "", item.baselineFailed ? "当前版本该题失败（对比失真）" : ""].filter(Boolean).join(" · ");
        lines.push(`  - 「${item.title}」：候选 准确 ${item.candidateAccuracy ?? "—"} / 完成 ${item.candidateCompleteness ?? "—"}${item.candidateOverall !== undefined ? `（综合 ${item.candidateOverall}）` : ""} vs 当前版本 准确 ${item.baselineAccuracy ?? "—"} / 完成 ${item.baselineCompleteness ?? "—"}${item.baselineOverall !== undefined ? `（综合 ${item.baselineOverall}）` : ""}${item.delta !== undefined ? ` ｜ Δ ${item.delta > 0 ? "+" : ""}${item.delta}` : ""}${flags ? ` ｜ ${flags}` : ""}`);
        if (item.reason) lines.push(`    候选失分原因：${item.reason}`);
      }
    } else {
      lines.push("- 本轮评审未返回逐题分数，归因仅到执行失败题层面；重跑盲测可获得完整逐题归因。");
    }
    if (v.aiAdvice) {
      lines.push("", "## AI 优化建议", `- 整体诊断：${v.aiAdvice.overall}`, ...v.aiAdvice.actions.map((action, index) => `- ${index + 1}. [${action.target}] ${action.title}：${action.detail}`));
    }
  }
  if (project.adviceLedger.length) {
    lines.push("", "## 建议效果追踪");
    for (const entry of project.adviceLedger.slice().reverse()) {
      lines.push(`- ${new Date(entry.settledAt).toLocaleString("zh-CN")} ｜ 整体 准确 ${entry.before.accuracy}%→${entry.after.accuracy}% · 完成 ${entry.before.completeness}%→${entry.after.completeness}%`);
      for (const action of entry.actions) lines.push(`  - [${action.improved ? "见效" : action.executed ? "已执行未见效" : "未执行"}] ${action.title}（${action.target}）：${action.note}`);
    }
  }
  lines.push("", "## 失败与补考履历");
  const experimentFailed = project.experimentRun.candidateResults.flatMap((item) => item.runs).filter((run) => run.error).length;
  lines.push(`- 实验阶段执行失败题：${experimentFailed} 道${project.experimentRun.previousScores ? "（已进行补考）" : ""}${project.experimentRun.summary ? ` ｜ 实验结论：${project.experimentRun.summary}` : ""}`);
  if (project.experimentRun.previousScores?.length) {
    lines.push("- 实验补考前后分数（前 → 后）：");
    for (const previous of project.experimentRun.previousScores) {
      const current = project.experimentRun.candidateResults.find((item) => item.candidateId === previous.candidateId);
      if (!current) continue;
      const title = project.candidates.find((candidate) => candidate.id === previous.candidateId)?.title ?? previous.candidateId;
      lines.push(`  - ${title}：准确 ${previous.accuracy}% → ${current.evaluation.accuracy}% ｜ 证据 ${previous.evidence}% → ${current.evaluation.evidence}% ｜ 风险 ${previous.riskCoverage}% → ${current.evaluation.riskCoverage}%`);
    }
  }
  const failedCases = [...v.baselineRuns, ...v.runs].filter((run) => run.error);
  if (failedCases.length) {
    lines.push(`- 本轮盲测执行失败题：${failedCases.length} 道（按未完成任务计分）`);
    for (const run of failedCases) lines.push(`  - ${titleFor(run.testCaseId)}：${run.error}`);
  } else {
    lines.push("- 本轮盲测全部题目执行成功");
  }
  const audit = (v.evaluation?.notes ?? []).filter((note) => note.startsWith("评审留痕："));
  if (audit.length) lines.push("- 评审过程记录：", ...audit.map((note) => `  - ${note.slice("评审留痕：".length)}`));
  lines.push("", "## 候选逐题结果");
  for (const run of v.runs) lines.push(`- ${titleFor(run.testCaseId)} ｜ ${run.error ? `❌ 失败：${run.error}` : `✅ ${(run.latencyMs / 1000).toFixed(1)}s ｜ ¥${run.cost}`}`);
  return lines.join("\n");
}

/** 从评审备注里提取「评审留痕：」前缀的过程记录（模型重试、演示兜底、小数换算等降级）。 */
function auditOf(notes?: string[]): string[] {
  return (notes ?? []).filter((note) => note.startsWith("评审留痕：")).map((note) => note.slice("评审留痕：".length));
}

/** 评审过程留痕横幅：单独提示降级过程而非静默，并提供一键复制供粘贴到评测报告。 */
function EvalAuditNote({ notes }: { notes?: string[] }) {
  const audit = auditOf(notes);
  const [copied, setCopied] = useState(false);
  if (!audit.length) return null;
  const copy = async () => {
    const text = audit.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 非安全上下文剪贴板 API 不可用时的兜底。
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return <div className="flex items-start justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"><div><b>评审过程提示：</b>{audit.join("；")}</div><button type="button" onClick={copy} className="flex shrink-0 items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-100">{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "已复制" : "复制留痕"}</button></div>;
}

function BaselinePanel({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const result = p.baselineRun.result;
  const readiness = baselineReadiness(p);
  const [inspect, setInspect] = useState<{ title: string; runs: TargetRunResult[] } | null>(null);
  const weakest = result ? [
    { label: "内容准确性", value: result.accuracy },
    { label: "证据完整度", value: result.evidence },
    { label: "风险覆盖", value: result.riskCoverage },
  ].sort((a, b) => a.value - b.value)[0] : undefined;
  const overall = result ? Math.round(result.rubricScore ?? (result.accuracy + result.evidence + result.riskCoverage) / 3) : 0;
  return <div className="space-y-4">
    <SectionTitle eyebrow="第 1 步 · 当前版本体检" title="先看看现在做得怎么样" desc="先记录当前版本的真实表现。之后每个新版都和它比较，避免只凭感觉判断有没有进步。" action={<div className="flex flex-wrap gap-2"><Button variant="soft" onClick={() => runtime.generateEvalSuite()} disabled={runtime.status.busy}><Bot className="size-4" />{p.evalSuite.length ? "重新准备检查项" : "准备检查项"}</Button><Button onClick={() => runtime.executeBaseline()} disabled={runtime.status.busy || p.evalSuite.length === 0}><Play className="size-4" />开始体检</Button></div>} />
    {result ? <>
      <Card className={readiness.ready?"border-emerald-200":"border-amber-200"}><CardContent className="pt-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 font-semibold text-slate-900">{readiness.ready?<CheckCircle2 className="size-5 text-emerald-600"/>:<CircleAlert className="size-5 text-amber-600"/>}{readiness.ready?"当前版本体检完成":"体检已运行，但证据还不够完整"}</div><p className="mt-1 text-sm leading-6 text-slate-500">{readiness.ready?"已经有足够依据作为后续新版的比较起点。":"先补齐缺失检查，再开始判断哪些问题最值得改。"}</p></div>{readiness.ready&&<Button onClick={() => { runtime.setStage("problem"); if (p.problems.length === 0) void runtime.analyzeProblems().catch(() => {}); }} disabled={runtime.status.busy}>找出需要改的问题 <ArrowRight className="size-4" /></Button>}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-400">当前综合表现</div><div className="mt-1 text-2xl font-bold text-slate-900">{overall}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-400">最明显的短板</div><div className="mt-1 font-semibold text-slate-900">{weakest?.label ?? "待分析"}</div><div className="mt-1 text-xs text-slate-500">{weakest ? `${Math.round(weakest.value)} 分` : "—"}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-400">检查完成情况</div><div className="mt-1 font-semibold text-slate-900">{readiness.verified}/{readiness.planned}</div><div className="mt-1 text-xs text-slate-500">已获得可确认结果</div></div></div>
        {!readiness.ready&&<div className="mt-4"><BaselineRecovery runtime={runtime} /></div>}
      </CardContent></Card>
      <TechnicalDetails label="技术人员查看：测试题、Runner、评分与逐题结果" meta={`${p.evalSuite.length} 个检查项 · evidence ${readiness.evidenceCoverage}%`}>
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-sky-50 p-4"><div className="text-sm font-semibold">执行环境 · {p.targetConnection.label}</div><div className="mt-1 text-xs text-slate-500">adapter={p.targetConnection.adapter} · suite={p.baselineRun.suiteName}</div></div>
        <EvalSuiteEditor runtime={runtime} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><ScoreCard label="Rubric Score" value={result.rubricScore ?? 0} target={85} /><ScoreCard label="证据覆盖" value={result.verifiedRubricCoverage ?? 0} target={100} /><ScoreCard label="准确率" value={result.accuracy} target={90} /><ScoreCard label="证据" value={result.evidence} target={90} /><ScoreCard label="风险覆盖" value={result.riskCoverage} target={85} /><ScoreCard label="平均成本" value={result.averageCost} unit="¥" target={0.5} /></div>
        <EvalAuditNote notes={result.notes} />
        <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-4"><div className="rounded-xl bg-white p-3">返回 {readiness.returned}/{readiness.planned}</div><div className="rounded-xl bg-white p-3">证据覆盖 {readiness.evidenceCoverage}%</div><div className="rounded-xl bg-white p-3">失败 {readiness.failed}</div><div className="rounded-xl bg-white p-3">verified {readiness.verified} · partial {readiness.partial} · deferred {readiness.deferred}</div></div>
        <Button variant="secondary" onClick={() => setInspect({ title: `当前版本逐题结果 · ${p.baselineRun.suiteName}`, runs: p.baselineRun.runs })} disabled={p.baselineRun.runs.length === 0}>查看逐题结果</Button>
      </TechnicalDetails>
    </> : <div className="rounded-2xl border border-dashed p-10 text-center"><Database className="mx-auto size-8 text-slate-300" /><div className="mt-3 font-semibold">还没有体检结果</div><p className="mt-1 text-sm text-slate-500">先准备检查项，再运行当前版本。系统会用这份结果作为之后所有新版的比较起点。</p></div>}
    {inspect && <RunInspector title={inspect.title} runs={inspect.runs} testCases={p.evalSuite} onClose={() => setInspect(null)} />}
  </div>;
}

function ProblemPanel({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const selected = p.problems.find((item) => item.id === p.selectedProblemId);
  return <div className="space-y-4">
    <SectionTitle eyebrow="第 2 步 · 找出改进重点" title="这次先改哪个问题" desc="系统把体检结果整理成几个可理解的问题。先选最值得处理的一项，再分析为什么会发生。" action={<Button variant="soft" onClick={() => runtime.analyzeProblems()} disabled={runtime.status.busy}><Bot className="size-4" />重新分析</Button>} />
    {p.problems.length ? <div className="grid gap-3">{p.problems.map((problem, index) => { const isSelected=p.selectedProblemId===problem.id; const provenance=evidenceRefSummary(problem.evidenceRefs); const impactLabel=problem.severity==="high"||problem.impact>=15?"影响较大":problem.severity==="medium"||problem.impact>=8?"影响中等":"影响较小"; return <div key={problem.id} className={cn("rounded-2xl border p-4 transition",isSelected?"border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-50":"bg-white")}><div className="flex items-start gap-3"><div className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-xs font-bold",problem.severity==="high"?"bg-rose-50 text-rose-600":problem.severity==="medium"?"bg-amber-50 text-amber-600":"bg-slate-100 text-slate-500")}>{index+1}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-slate-900">{problem.title}</div>{problem.status==="recommended"&&<Badge className="border-indigo-200 bg-white text-indigo-700">建议优先</Badge>}{isSelected&&<Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">本轮处理</Badge>}<Badge>{impactLabel}</Badge></div><p className="mt-1 text-sm leading-6 text-slate-500">{problem.summary}</p><div className="mt-3 flex items-center justify-between gap-3"><span className={cn("text-xs",provenance.verified>0?"text-emerald-700":"text-amber-700")}>{provenance.verified>0?"已有依据支持":"还需要补充依据"}</span><Button size="sm" variant={isSelected?"secondary":"soft"} disabled={runtime.status.busy} onClick={()=>runtime.selectProblem(problem.id)}>{isSelected?"已选择":"选择这个问题"}</Button></div><details className="mt-3 border-t pt-2 text-xs"><summary className="cursor-pointer text-slate-500">技术人员查看：证据定位与识别置信度</summary><div className="mt-2 text-slate-500">影响 {problem.impact}% · severity {problem.severity} · evidence {problem.evidence.length} 条{problem.confidence!==undefined?` · confidence ${Math.round(problem.confidence*100)}%`:""}</div>{problem.evidence.map((item,evidenceIndex)=><div key={`${item}-${evidenceIndex}`} className="mt-2 rounded-lg bg-slate-50 p-2">{item}{problem.evidenceRefs[evidenceIndex]?.verified&&<div className="mt-1 text-emerald-700">定位：{problem.evidenceRefs[evidenceIndex].path||problem.evidenceRefs[evidenceIndex].testCaseId||problem.evidenceRefs[evidenceIndex].artifactId}</div>}</div>)}</details></div></div></div>})}</div> : <div className="rounded-2xl border border-dashed p-9 text-center text-sm text-slate-400">还没有问题清单。先完成当前版本体检。</div>}
    {selected&&<div className="flex flex-col gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-semibold text-indigo-900">本轮先处理</div><div className="mt-1 text-sm text-indigo-800">{selected.title}</div></div><Button onClick={()=>runtime.diagnose()} disabled={runtime.status.busy}><Search className="size-4" />分析为什么会发生</Button></div>}
  </div>;
}

function DiagnosisPanel({ runtime }: { runtime: ProjectRuntime }) {
  const p=runtime.project;
  const d=p.diagnosis;
  const symptom=p.problems.find((item)=>item.id===p.selectedProblemId);
  const provenance=evidenceRefSummary(d?.evidenceRefs??[]);
  if(!d) return <div className="space-y-4"><SectionTitle eyebrow="第 2 步 · 理解原因" title="为什么会出现这个问题" desc="系统会结合当前成果和体检结果，找出最可能需要调整的地方。"/><div className="rounded-2xl border border-dashed p-10 text-center"><Search className="mx-auto size-8 text-slate-300"/><div className="mt-3 font-semibold">等待原因分析</div><p className="mt-1 text-sm text-slate-500">{symptom?`当前问题：${symptom.title}`:"请先选择本轮问题"}</p><Button className="mt-4" onClick={()=>runtime.diagnose()} disabled={!symptom||runtime.status.busy}>分析主要原因</Button></div></div>;
  return <div className="space-y-4">
    <SectionTitle eyebrow="第 2 步 · 理解原因" title="系统判断：问题主要出在哪里" desc="先看结论和准备调整的范围。完整证据、反证条件和 Trace 留给技术人员按需查看。" action={<Button variant="secondary" onClick={()=>runtime.diagnose()} disabled={runtime.status.busy}><RefreshCcw className="size-4"/>重新分析</Button>}/>
    {symptom&&<div className="grid gap-3 lg:grid-cols-3"><div className="rounded-2xl border bg-rose-50/50 p-4"><div className="text-xs font-semibold text-rose-600">发现的问题</div><div className="mt-2 font-semibold text-slate-900">{symptom.title}</div><p className="mt-1 text-sm leading-6 text-slate-500">{symptom.summary}</p></div><div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4"><div className="text-xs font-semibold text-indigo-600">主要原因</div><div className="mt-2 font-semibold text-slate-900">{d.rootCause}</div><p className="mt-1 text-sm leading-6 text-slate-500">{d.summary}</p></div><div className="rounded-2xl border bg-emerald-50/50 p-4"><div className="text-xs font-semibold text-emerald-700">准备调整</div><div className="mt-2 font-semibold text-slate-900">{d.affectedComponent}</div><p className="mt-1 text-sm leading-6 text-slate-500">系统会只围绕这个原因生成改进方案，尽量不扩大修改范围。</p><div className="mt-2 flex flex-wrap gap-1.5">{d.suggestedScopes.map((scope)=><Badge key={scope}>{scope==="prompt"?"提示词":scope==="workflow"?"流程":scope==="tool"?"工具调用":scope==="memory"?"记忆":scope==="code"?"代码":"模型"}</Badge>)}</div></div></div>}
    <div className={cn("rounded-xl border p-3 text-xs",d.confidence>=.75&&provenance.verified>0?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-amber-200 bg-amber-50 text-amber-900")}>{d.confidence>=.75&&provenance.verified>0?"这个判断已有较强依据支持，可以进入方案生成。":"这个判断仍有不确定性；系统会保留反证条件，并在后续验证中检查是否判断错误。"}</div>
    <TechnicalDetails label="技术人员查看：根因证据链、反证条件与 Trace" meta={`${d.evidence.length} 条证据 · ${Math.round(d.confidence*100)}% confidence`}><div className="grid gap-3 lg:grid-cols-2"><div><div className="text-xs font-semibold text-slate-700">支持证据</div><div className="mt-2 space-y-2">{d.evidence.map((item,index)=><div key={`${item}-${index}`} className="rounded-xl border bg-white p-3 text-xs leading-5 text-slate-600">{item}{d.evidenceRefs[index]?.verified&&<div className="mt-1 text-emerald-700">定位：{d.evidenceRefs[index].path||d.evidenceRefs[index].testCaseId||d.evidenceRefs[index].artifactId}</div>}</div>)}</div></div><div><div className="text-xs font-semibold text-slate-700">如何证明这个判断错了</div><div className="mt-2 rounded-xl border bg-white p-3 text-xs leading-5 text-slate-600">{d.falsifier}</div>{d.counterEvidence.length>0&&<><div className="mt-3 text-xs font-semibold text-slate-700">冲突证据</div><ul className="mt-2 space-y-1 text-xs text-slate-500">{d.counterEvidence.map((item)=><li key={item}>• {item}</li>)}</ul></>}</div></div><div className="grid gap-2 md:grid-cols-2">{d.trace.map((item)=><div key={item.id} className={cn("rounded-xl border p-3",item.status==="fail"?"border-rose-200 bg-rose-50":item.status==="warning"?"border-amber-200 bg-amber-50":"bg-white")}><div className="text-xs font-semibold">{item.stage}</div><div className="mt-1 text-xs text-slate-600">{item.summary}</div><div className="mt-1 text-[10px] text-slate-400">{item.detail}</div></div>)}</div></TechnicalDetails>
    {provenance.total>0&&provenance.verified===0&&<div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"><b>根因证据尚不可定位。</b> 当前描述没有匹配到来源文件、测试题或 Trace；重新诊断或补充材料后才能生成方案，避免基于猜测修改成果。</div>}
    <div className="flex justify-end"><Button onClick={()=>runtime.generatePlan()} disabled={runtime.status.busy||d.confidence<.55||d.evidence.length===0||(provenance.total>0&&provenance.verified===0)}><WandSparkles className="size-4"/>生成改进方案</Button></div>
  </div>;
}

function PlanPanel({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const approved = runtime.gate("experiment-ready")?.status === "approved";
  const recommendedCandidate = p.candidates.find((candidate) => candidate.recommended);
  const sortedCandidates = [...p.candidates].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
  const selectedCount = p.selectedCandidateIds.length;
  return <div className="space-y-4">
    <FocusedTaskCard runtime={runtime} />
    <SectionTitle eyebrow="第 3 步 · 选择怎么改" title="选择要验证的改进方案" desc="先看推荐方案和改动结果。技术依据、补丁细节和实验参数默认收起，需要时再展开。" action={<Button variant="soft" disabled={runtime.status.busy} onClick={() => runtime.generatePlan()}><Bot className="size-4" />换一批方案</Button>} />
    {recommendedCandidate && <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-semibold text-indigo-900"><Sparkles className="size-4" />系统建议先验证</div><div className="mt-1 font-semibold text-slate-900">{recommendedCandidate.title || recommendedCandidate.change}</div><p className="mt-1 text-sm leading-6 text-slate-600">{recommendedCandidate.hypothesis}</p></div>
        <div className="flex shrink-0 items-center gap-2"><Badge className="border-indigo-200 bg-white text-indigo-700">推荐</Badge><Badge>{recommendedCandidate.riskLevel === "low" ? "低风险" : recommendedCandidate.riskLevel === "medium" ? "中等风险" : "高风险"}</Badge></div>
      </div>
      <div className="mt-3 text-xs text-slate-500">推荐方案已按生成结果自动加入待验证列表；你也可以在下方改选或多选其他方案。</div>
    </div>}
    <details className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <summary className="cursor-pointer list-none text-sm font-semibold text-slate-600">技术人员查看：高级验证设置 <span className="ml-2 text-xs font-normal text-slate-400">默认值即可，一般不需要调整</span></summary>
      <p className="mt-2 text-xs leading-5 text-slate-500">系统会先快速筛选，再只对入围方案构建实际成果并做完整验证，以减少无效计算。只有需要控制实验成本或覆盖范围时才修改这些设置。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-slate-500">验证模式<select className="mt-1 h-9 w-full rounded-xl border bg-white px-2 text-xs" value={p.experimentPolicy.mode} onChange={(e)=>runtime.updateExperimentPolicy({mode:e.target.value as typeof p.experimentPolicy.mode})}><option value="adaptive">智能筛选（推荐）</option><option value="full">全部方案完整验证</option></select></label>
        <label className="text-xs text-slate-500">进入最终验证的方案数<input type="number" min={2} max={6} className="mt-1 h-9 w-full rounded-xl border bg-white px-2 text-xs" value={p.experimentPolicy.finalistCount} onChange={(e)=>runtime.updateExperimentPolicy({finalistCount:Math.max(2,Math.min(6,Number(e.target.value)||3))})}/></label>
        <label className="text-xs text-slate-500">快速检查用例数<input type="number" min={1} max={5} className="mt-1 h-9 w-full rounded-xl border bg-white px-2 text-xs" value={p.experimentPolicy.screeningCaseCount} onChange={(e)=>runtime.updateExperimentPolicy({screeningCaseCount:Math.max(1,Math.min(5,Number(e.target.value)||3))})}/></label>
        <label className="text-xs text-slate-500">执行方式<select className="mt-1 h-9 w-full rounded-xl border bg-white px-2 text-xs" value={p.experimentPolicy.batchArtifactRuntime?"on":"off"} onChange={(e)=>runtime.updateExperimentPolicy({batchArtifactRuntime:e.target.value==="on"})}><option value="on">批量执行（推荐）</option><option value="off">逐个执行</option></select></label>
      </div>
    </details>
    {p.candidates.filter((candidate) => p.selectedCandidateIds.includes(candidate.id) && candidate.artifactBuildStatus === "failed").map((candidate) => <div key={candidate.id} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-800"><b>{candidate.title || candidate.name} · 文件构造失败</b><div className="mt-0.5 break-words">{candidate.artifactBuildSummary}</div></div>)}
    {p.validationRun.aiAdvice && p.validationRun.aiAdvice.actions.length > 0 && <details className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4"><summary className="cursor-pointer text-sm font-semibold text-indigo-900">上轮验证要求重点加强的 {p.validationRun.aiAdvice.actions.length} 项内容</summary><p className="mt-2 text-xs leading-5 text-indigo-800/80">{p.validationRun.aiAdvice.overall}</p><div className="mt-2 flex flex-wrap gap-1.5">{p.validationRun.aiAdvice.actions.map((action) => <Badge key={action.title} className="border-indigo-200 bg-white text-indigo-700">{action.title}</Badge>)}</div></details>}
    {p.candidates.length === 0 ? <div className="rounded-2xl border border-dashed p-10 text-center"><FlaskConical className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm text-slate-500">还没有改进方案。</p><Button className="mt-4" onClick={() => runtime.generatePlan()}>生成改进方案</Button></div> : <div className="grid gap-3 lg:grid-cols-2">{sortedCandidates.map((candidate, index) => {
      const selected = p.selectedCandidateIds.includes(candidate.id);
      const riskLabel = candidate.riskLevel === "low" ? "低风险" : candidate.riskLevel === "medium" ? "中等风险" : "高风险";
      const checks = [...(candidate.designRationale?.coveredCriteria ?? []), ...candidate.addressesAdvice].slice(0, 4);
      return <div key={candidate.id} className={cn("rounded-2xl border p-4 transition", selected ? "border-indigo-300 bg-indigo-50/40 ring-2 ring-indigo-50" : "bg-white hover:border-indigo-200")}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-400">方案 {index + 1}</span>{candidate.recommended && <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">推荐</Badge>}{selected && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">已选择</Badge>}</div><div className="mt-2 font-semibold text-slate-900">{candidate.title || candidate.change}</div></div><Badge className="shrink-0">{riskLabel}</Badge></div>
        <div className="mt-3 rounded-xl bg-slate-50 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">会改什么</div><p className="mt-1 text-sm leading-6 text-slate-700">{candidate.change}</p></div>
        <div className="mt-2 rounded-xl border border-slate-100 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">为什么值得试</div><p className="mt-1 text-xs leading-5 text-slate-600">{candidate.hypothesis}</p></div>
        {checks.length > 0 && <div className="mt-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">会重点验证</div><div className="mt-1.5 flex flex-wrap gap-1.5">{checks.map((label) => <span key={label} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">{label}</span>)}</div></div>}
        <details className="mt-3 border-t pt-3 text-xs"><summary className="cursor-pointer font-medium text-slate-500">技术人员查看：依据、证伪条件与具体 Patch</summary><div className="mt-2 text-[10px] text-slate-400">Candidate ID：{candidate.id}</div>{candidate.designRationale && <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">{candidate.designRationale.sourceEvidence.slice(0, 2).map((quote, quoteIndex) => <blockquote key={quoteIndex} className="border-l-2 border-indigo-200 pl-2 leading-5 text-slate-500">{quote}</blockquote>)}{candidate.designRationale.mechanism && <p className="leading-5 text-slate-600"><b>为什么可能有效：</b>{candidate.designRationale.mechanism}</p>}{candidate.designRationale.falsifier && <p className="leading-5 text-slate-600"><b>什么情况说明它无效：</b>{candidate.designRationale.falsifier}</p>}</div>}{candidate.patches.length > 0 && <div className="mt-2 space-y-2">{candidate.patches.map((patch) => <div key={patch.id} className="rounded-xl border bg-white p-3"><div className="flex flex-wrap gap-2"><Badge>{patch.component}</Badge><span className="font-semibold text-slate-600">{patch.operation} · {patch.target}</span></div><div className="mt-2 leading-5 text-slate-500">{patch.content}</div></div>)}</div>}</details>
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3"><span className="text-[10px] text-slate-400">选择方案不会直接覆盖当前版本</span><Button size="sm" variant={selected ? "secondary" : "soft"} onClick={() => runtime.toggleCandidate(candidate.id)} disabled={runtime.status.busy} aria-pressed={selected}>{selected ? <><Check className="size-3.5" />已选择 · 点击取消</> : "选择这个方案"}</Button></div>
      </div>;
    })}</div>}
    <div className={cn("flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between", approved ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white")}>
      <div><div className="font-semibold text-slate-900">{approved ? "方案已确认，可以开始验证" : `已选择 ${selectedCount} 个方案`}</div><p className="mt-1 text-xs leading-5 text-slate-500">{approved ? "系统会构建真实候选成果，与当前版本在同一套测试下比较，不会直接覆盖原成果。" : selectedCount > 0 ? "确认后才会真正构建和运行这些方案；你仍可以先查看详情或调整选择。" : "请先选择至少一个方案。"}</p></div>
      {approved ? <Button onClick={() => runtime.executeExperiment()} disabled={runtime.status.busy}><Play className="size-4" />开始验证所选方案</Button> : <Button onClick={() => runtime.approveGate("experiment-ready", `已确认 ${selectedCount} 个 Candidate 进入实验`)} disabled={runtime.status.busy || selectedCount === 0}><CheckCircle2 className="size-4" />确认这些方案</Button>}
    </div>
  </div>;
}

function evaluationFor(runtime: ProjectRuntime, candidateId: string) {
  return runtime.project.experimentRun.candidateResults.find((item) => item.candidateId === candidateId)?.evaluation;
}

function ExperimentPanel({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const completed = p.experimentRun.status === "completed";
  const [inspect, setInspect] = useState<{ title: string; runs: TargetRunResult[] } | null>(null);
  const [gapFor, setGapFor] = useState<string>();
  const runsFor = (candidateId: string) => p.experimentRun.candidateResults.find((item) => item.candidateId === candidateId)?.runs ?? [];
  const gapForCandidate = (candidateId: string) => {
    const evaluation = p.experimentRun.candidateResults.find((item) => item.candidateId === candidateId)?.evaluation;
    if (!evaluation || !p.baselineRun.result) return null;
    return computeGapAnalysis({ candidate: evaluation, baseline: p.baselineRun.result, candidateRuns: runsFor(candidateId), baselineRuns: p.baselineRun.runs, testCases: p.evalSuite });
  };
  // 逐题差距对照弹层：实验阶段的候选与基线同卷（可见评测卷）逐题比较，主因题带失分原因。
  const gapTarget = gapFor ? p.candidates.find((candidate) => candidate.id === gapFor) : undefined;
  const gapAnalysisForTarget = gapFor ? gapForCandidate(gapFor) : null;
  return <div className="space-y-4">
    <SectionTitle eyebrow="第 3 步 · 比较新版" title="看看哪个新版真的更好" desc={`系统会把你选的 ${p.selectedCandidateIds.length} 个方案变成实际新版，在相同条件下和当前版本比较。`} action={<Button onClick={() => runtime.executeExperiment()} disabled={runtime.status.busy || runtime.gate("experiment-ready")?.status !== "approved"}><Play className="size-4" />{completed ? "重新比较" : "开始比较"}</Button>} />
    <TechnicalDetails label="技术人员查看：实验策略" meta={p.experimentPolicy.mode === "adaptive" ? "智能筛选" : "完整验证"}><div className="rounded-xl border bg-white px-3 py-2 text-xs leading-5 text-slate-500">{p.experimentPolicy.mode === "adaptive" ? `轻量假设筛选 → 构造入围成果 → ${p.experimentPolicy.screeningCaseCount} 道 Smoke Test → ${p.experimentPolicy.finalistCount} 个 Finalist 全量评测` : "完整模式 · 所有 Candidate 直接构造并运行全量评测"}；执行环境 {p.experimentPolicy.batchArtifactRuntime ? `每批最多 ${p.experimentPolicy.batchSize} 题共用一次上下文` : "逐题执行"}。</div></TechnicalDetails>
    {!completed && p.candidates.filter((candidate) => p.selectedCandidateIds.includes(candidate.id) && candidate.artifactBuildStatus === "failed").map((candidate) => <div key={candidate.id} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-800"><b>{candidate.title || candidate.name} · 文件构造失败</b><div className="mt-0.5 break-words">{candidate.artifactBuildSummary}</div></div>)}
    {!completed ? <div className="rounded-2xl border border-dashed p-10 text-center"><FlaskConical className="mx-auto size-8 text-slate-300" /><div className="mt-3 font-semibold">等待开始比较</div><p className="mt-1 text-sm text-slate-500">确认方案后点击“开始比较”，系统不会直接覆盖当前版本。</p></div> : <><TechnicalDetails label="技术人员查看：完整实验数据与逐题对比" meta={`${p.experimentRun.candidateResults.length} 个结果`}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-400"><th className="pb-3">Candidate</th><th className="pb-3">阶段</th><th className="pb-3">准确率</th><th className="pb-3">证据</th><th className="pb-3">风险</th><th className="pb-3">成本</th><th className="pb-3">延迟</th><th className="pb-3">Safety</th><th className="pb-3">执行明细</th><th className="pb-3">逐题差距</th></tr></thead><tbody>{p.candidates.filter((c) => p.experimentRun.candidateResults.some((result) => result.candidateId === c.id) || p.experimentRun.buildFailures?.some((failure) => failure.candidateId === c.id)).map((c) => { const e = evaluationFor(runtime, c.id); const winner = p.experimentRun.winnerId === c.id; const resultRecord = p.experimentRun.candidateResults.find((item) => item.candidateId === c.id); const failedCount = resultRecord?.runs.filter((run) => run.error).length ?? 0; const candidateGap = gapForCandidate(c.id); return <tr key={c.id} className={cn("border-b last:border-0", winner && "bg-indigo-50/50", failedCount > 0 && "bg-rose-50/30")}><td className="py-4 pr-4"><div className="font-semibold">{c.title}</div><div className="text-[10px] text-slate-400">{c.id}{winner?" · winner":""}</div></td><td className="py-4"><Badge>{resultRecord?.experimentStage ?? "构造失败"}</Badge></td><td className="py-4">{e?.accuracy ?? "—"}%</td><td className="py-4">{e?.evidence ?? "—"}%</td><td className="py-4">{e?.riskCoverage ?? "—"}%</td><td className="py-4">¥{e?.averageCost ?? "—"}</td><td className="py-4">{e ? `${Math.round(e.averageLatencyMs / 1000)}s` : "—"}</td><td className="py-4">{e?.safety ?? "—"}</td><td className="py-4"><Button variant="secondary" size="sm" disabled={!e} onClick={() => setInspect({ title: `执行明细 · ${c.title}`, runs: runsFor(c.id) })}>查看</Button></td><td className="py-4">{candidateGap && <Button variant="secondary" size="sm" onClick={() => setGapFor(c.id)}>逐题对照</Button>}</td></tr>; })}</tbody></table></div>{p.experimentRun.previousScores && <div className="mb-4 space-y-1 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[11px] text-indigo-900"><b>补考对比：</b>{p.experimentRun.previousScores.map((previous) => {
                  const currentResult = p.experimentRun.candidateResults.find((item) => item.candidateId === previous.candidateId);
                  const candidateTitle = p.candidates.find((candidate) => candidate.id === previous.candidateId)?.title ?? previous.candidateId;
                  if (!currentResult) return null;
                  const items = [
                    { label: "准确率", from: previous.accuracy, to: currentResult.evaluation.accuracy, lowerBetter: false },
                    { label: "证据", from: previous.evidence, to: currentResult.evaluation.evidence, lowerBetter: false },
                    { label: "风险", from: previous.riskCoverage, to: currentResult.evaluation.riskCoverage, lowerBetter: false },
                    { label: "成本", from: previous.averageCost, to: currentResult.evaluation.averageCost, lowerBetter: true },
                  ];
                  return <div key={previous.candidateId} className="flex flex-wrap items-center gap-x-3"><span className="max-w-40 truncate font-semibold">{candidateTitle}</span>{items.map((item) => {
                    const improved = item.lowerBetter ? item.to < item.from : item.to > item.from;
                    const worsened = item.lowerBetter ? item.to > item.from : item.to < item.from;
                    return <span key={item.label} className={improved ? "text-emerald-700" : worsened ? "text-rose-700" : "text-slate-500"}>{item.label} {item.label === "成本" ? `¥${item.from} → ¥${item.to}` : `${Math.round(item.from)} → ${Math.round(item.to)}`}</span>;
                  })}</div>;
                })}</div>}{p.experimentRun.candidateResults.flatMap((item) => item.runs).some((run) => run.error) && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800"><div><b>{p.experimentRun.candidateResults.flatMap((item) => item.runs).filter((run) => run.error).length} 道题执行失败</b></div><Button size="sm" variant="secondary" onClick={() => void runtime.retryFailedExperiment()} disabled={runtime.status.busy}>补跑失败题</Button></div>}</TechnicalDetails>
      {runtime.winner ? <>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 text-emerald-600" /><div><div className="text-xs font-semibold text-emerald-700">本轮找到更好的版本</div><div className="mt-1 font-semibold text-emerald-950">{runtime.winner.title || runtime.winner.name}</div><p className="mt-1 text-sm leading-6 text-emerald-900/70">{p.experimentRun.summary}</p></div></div></div>
        <div className="flex justify-end"><Button onClick={() => runtime.executeValidation()} disabled={runtime.status.busy}>进入最终验收 <ArrowRight className="size-4" /></Button></div>
      </> : <div className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/70">
        <div className="flex flex-col gap-3 border-b border-amber-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3"><CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" /><div><div className="font-semibold text-amber-950">这轮没有找到更好的版本，当前版本保持不变</div><p className="mt-1 text-xs leading-5 text-amber-800/80">{p.experimentRun.summary || "这批方案没有同时满足效果、安全和完整性要求。"}</p></div></div>
          <Badge className="w-fit shrink-0 border-amber-300 bg-white text-amber-700">已自动分析下一步</Badge>
        </div>
        <div className="space-y-3 bg-white/70 p-4">
          {p.experimentRun.aiAdvice ? <>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs leading-5 text-indigo-900"><b>优化诊断：</b>{p.experimentRun.aiAdvice.overall}</div>
            <div className="grid gap-2 md:grid-cols-2">{p.experimentRun.aiAdvice.actions.map((action, index) => <div key={`${action.title}-${index}`} className="rounded-xl border bg-white p-3 shadow-sm shadow-slate-100">
              <div className="flex items-start gap-2"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">{index + 1}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-bold text-slate-800">{action.title}</span><Badge className="border-slate-200 bg-slate-50 text-slate-500">{action.target}</Badge></div><p className="mt-1 text-[11px] leading-5 text-slate-500">{action.detail}</p></div></div>
            </div>)}</div>
          </> : <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs text-slate-500"><Loader2 className={cn("size-4 text-indigo-500", runtime.status.busy && "animate-spin")} />{runtime.status.busy ? "正在根据失败题、Hard Gate 和基线差距生成优化建议…" : "尚未生成建议，可重新分析本轮结果。"}</div>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[10px] leading-4 text-slate-400">采纳后保留当前版本不变，并根据这些失败原因生成下一批方案。</p>
            <div className="flex shrink-0 gap-2"><Button size="sm" variant="secondary" disabled={runtime.status.busy} onClick={() => void runtime.generateExperimentAdvice()}><RefreshCcw className="size-3.5" />重新分析</Button><Button size="sm" disabled={runtime.status.busy || !p.experimentRun.aiAdvice?.actions.length} onClick={() => void (experimentNeedsEvidenceRepair(p.experimentRun) ? runtime.executeExperiment() : runtime.adoptExperimentAdvice())}><WandSparkles className="size-3.5" />{experimentNeedsEvidenceRepair(p.experimentRun) ? "补齐证据并重新比较" : "一键采纳并生成新方案"}</Button></div>
          </div>
        </div>
      </div>}
    </>}
    {gapTarget && gapAnalysisForTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setGapFor(undefined)}>
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between bg-white border-b px-5 py-4">
          <div>
            <div className="text-sm font-bold">逐题差距对照 · {gapTarget.title} vs 当前基线</div>
            <div className="text-xs text-slate-400">同一套可见评测卷：找出候选比基线差在哪道题、差多少、为什么 · 点击蒙层或右上角关闭</div>
          </div>
          <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => setGapFor(undefined)} aria-label="关闭"><X className="size-4" /></Button>
        </div>
        <div className="overflow-y-auto bg-slate-50/60 p-4"><GapAnalysisCard analysis={gapAnalysisForTarget} command={p.evolutionCommand} onAppendCommand={(text) => appendGapAdvice(runtime, text)} /></div>
      </div>
    </div>}
    {inspect && <RunInspector title={inspect.title} runs={inspect.runs} testCases={p.evalSuite} onClose={() => setInspect(null)} />}
  </div>;
}

/** 把聚类薄弱环节的对症建议追加为本轮进化要求：不动已跑出的评测结论，让 AI 下次出方案时重点加强该方向。 */
function appendGapAdvice(runtime: ProjectRuntime, text: string) {
  runtime.commit((current) => ({
    ...current,
    evolutionCommand: [current.evolutionCommand, text].filter(Boolean).join("\n\n重点加强（来自差距聚类）："),
    commandHistory: [
      ...current.commandHistory,
      { id: `cmd-gap-${Date.now()}`, role: "system" as const, content: `已将差距聚类的薄弱环节转为本轮进化要求：${text}。AI 重新生成方案时会重点加强该方向；当前已完成的评测结论仍然有效。`, artifactIds: [], createdAt: new Date().toISOString() },
    ],
  }));
}

/** 同卷差距归因：总分差只说"差了几分"，这里拆到维度与题目层，指出主因题及其失分原因；还能让 AI 按扣分原因聚类薄弱环节。 */
function GapAnalysisCard({ analysis, command, onAppendCommand }: { analysis: GapAnalysis; command?: string; onAppendCommand?: (text: string) => void }) {
  const [appended, setAppended] = useState<Record<string, boolean>>({});
  const exceeded = analysis.dimensions.some((dimension) => dimension.exceeded);
  const driverIds = new Set(analysis.drivers.map((driver) => driver.testCaseId));
  const sorted = [...analysis.cases].sort((a, b) => (a.delta ?? -101) - (b.delta ?? -101));
  const [clusterState, setClusterState] = useState<{ loading: boolean; error?: string; data?: GapClusterAiResult } | null>(null);
  // 聚类输入：落后题 + 候选执行失败题；两版都失败或候选更好的题没有归因价值。
  const worsened = analysis.cases.filter((item) => item.candidateFailed || (item.delta !== undefined && item.delta < 0));
  const runCluster = async () => {
    setClusterState({ loading: true });
    try {
      const data = GapClusterAiResultSchema.parse(await runAi("gap-cluster", {
        evolutionCommand: command,
        tolerance: analysis.tolerance,
        worsenedCases: worsened.map((item) => ({ testCaseId: item.testCaseId, title: item.title, delta: item.delta, candidateFailed: item.candidateFailed, baselineFailed: item.baselineFailed, reason: item.reason })),
      }));
      setClusterState({ loading: false, data });
    } catch (error) {
      setClusterState({ loading: false, error: error instanceof Error ? error.message : "薄弱环节聚类失败" });
    }
  };
  return <Card><CardContent className="pt-5">
    <div className="flex items-center gap-2 text-sm font-semibold"><GitCompareArrows className="size-4 text-indigo-600" />同卷差距归因</div>
    <p className="mt-1 text-xs text-slate-400">总分差只说明"差了几分"，这里把它拆回维度与每道题：落后超过容差 {analysis.tolerance} 分、或只有一侧执行失败的题会标为主因，并带出该题的评审理由，对症回方案页加强。</p>
    <div className={cn("mt-3 rounded-xl px-3 py-2 text-xs leading-5", exceeded ? "border border-rose-200 bg-rose-50 text-rose-800" : "border border-emerald-200 bg-emerald-50/60 text-emerald-900")}>{analysis.summary}</div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void runCluster()} disabled={clusterState?.loading || worsened.length === 0}><Loader2 className={cn("size-3.5", clusterState?.loading ? "animate-spin" : "hidden")} /><Sparkles className={cn("size-3.5", clusterState?.loading && "hidden")} />按失分原因聚类薄弱环节</Button>
      {worsened.length ? <span className="text-[10px] text-slate-400">对 {worsened.length} 道落后/执行失败题按共同病因归堆，找出该集中补强的薄弱模式</span> : <span className="text-[10px] text-slate-400">没有落后于基线或执行失败的题目，无需聚类</span>}
    </div>
    {onAppendCommand && <CommandScopeNote compact />}
    {clusterState?.error && <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{clusterState.error}</div>}
    {clusterState?.data && <div className="mt-2 space-y-2">
      {clusterState.data.overall && <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs leading-5 text-indigo-900"><b>整体薄弱主题：</b>{clusterState.data.overall}</div>}
      {clusterState.data.clusters.length === 0 && <div className="rounded-xl border border-dashed px-3 py-2 text-xs text-slate-400">AI 未识别出成类的薄弱环节，说明失分较零散，可逐题查看下方原因。</div>}
      {clusterState.data.clusters.map((cluster) => <div key={cluster.name} className="rounded-xl border border-indigo-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-800">{cluster.name}</span><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{cluster.caseIds.length} 题</Badge></div>
        <div className="mt-1.5 flex flex-wrap gap-1">{cluster.caseIds.map((id) => <span key={id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{analysis.cases.find((item) => item.testCaseId === id)?.title ?? id}</span>)}</div>
        <div className="mt-2 text-[11px] leading-5 text-slate-500"><b className="text-slate-600">共同病因：</b>{cluster.pattern}</div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1 text-[11px] leading-5 text-indigo-700"><b>对症建议：</b>{cluster.advice}</div>
          {onAppendCommand && <button type="button" disabled={appended[cluster.name]} onClick={() => { onAppendCommand(`${cluster.name}：${cluster.advice}`); setAppended((current) => ({ ...current, [cluster.name]: true })); }} className={cn("shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold transition", appended[cluster.name] ? "cursor-default border-emerald-200 bg-emerald-50 text-emerald-600" : "border-indigo-300 bg-white text-indigo-600 hover:bg-indigo-50")}>{appended[cluster.name] ? "已加入进化要求 ✓" : "转为进化要求"}</button>}
        </div>
      </div>)}
    </div>}
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{analysis.dimensions.map((dimension) => {
      const lag = dimension.diff > 0 ? `落后 ${Math.round(dimension.diff)} 分` : dimension.diff < 0 ? `领先 ${Math.round(-dimension.diff)} 分` : "持平";
      return <div key={dimension.key} className={cn("rounded-xl border p-3", dimension.exceeded ? "border-rose-200 bg-rose-50" : "bg-slate-50")}>
        <div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-600">{dimension.label}</span><span className={cn("font-semibold", dimension.exceeded ? "text-rose-600" : dimension.diff < 0 ? "text-emerald-600" : "text-slate-500")}>{lag}（容差 {analysis.tolerance} 分）</span></div>
        <div className="mt-2 flex items-center gap-2"><span className="w-10 shrink-0 text-[10px] text-slate-400">候选</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><div className={cn("h-full rounded-full", dimension.exceeded ? "bg-rose-500" : "bg-indigo-500")} style={{ width: `${Math.min(100, dimension.candidate)}%` }} /></div><span className="w-9 shrink-0 text-right text-xs font-semibold">{Math.round(dimension.candidate)}%</span></div>
        <div className="mt-1 flex items-center gap-2"><span className="w-10 shrink-0 text-[10px] text-slate-400">当前版</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-400" style={{ width: `${Math.min(100, dimension.baseline)}%` }} /></div><span className="w-9 shrink-0 text-right text-xs text-slate-400">{Math.round(dimension.baseline)}%</span></div>
      </div>;
    })}</div>
    {analysis.hasPerCase ? <div className="mt-3 max-h-96 space-y-1.5 overflow-auto pr-1">
      {sorted.map((item) => {
        const driver = driverIds.has(item.testCaseId);
        const distorted = item.baselineFailed && !item.candidateFailed;
        return <div key={item.testCaseId} className={cn("rounded-xl border p-2.5", driver && !distorted ? "border-rose-200 bg-rose-50/60" : driver ? "border-amber-200 bg-amber-50/50" : "bg-white")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-xs font-semibold", driver && !distorted ? "text-rose-800" : "text-slate-700")}>{item.title}</span>
            {driver && !distorted && <Badge className="border-rose-200 bg-rose-100 text-rose-700">主因</Badge>}
            {distorted && <Badge className="border-amber-200 bg-amber-50 text-amber-700">对比失真</Badge>}
            {item.candidateFailed && <Badge className="border-rose-200 bg-rose-50 text-rose-700">候选执行失败</Badge>}
            {item.delta !== undefined && <span className={cn("shrink-0 text-xs font-bold", item.delta <= -analysis.tolerance ? "text-rose-600" : item.delta >= analysis.tolerance ? "text-emerald-600" : "text-slate-400")}>{item.delta > 0 ? `+${item.delta}` : item.delta}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
            <span>候选：准确 <b className={cn(item.candidateFailed && "text-rose-600")}>{item.candidateAccuracy ?? (item.candidateFailed ? "—" : "?")}</b> / 完成 <b>{item.candidateCompleteness ?? (item.candidateFailed ? "—" : "?")}</b>{item.candidateOverall !== undefined && <span className="text-slate-400">（综合 {item.candidateOverall}）</span>}</span>
            <span>当前版本：准确 <b className={cn(item.baselineFailed && "text-amber-600")}>{item.baselineAccuracy ?? (item.baselineFailed ? "—" : "?")}</b> / 完成 <b>{item.baselineCompleteness ?? (item.baselineFailed ? "—" : "?")}</b>{item.baselineOverall !== undefined && <span className="text-slate-400">（综合 {item.baselineOverall}）</span>}</span>
          </div>
          {item.candidateFailed && item.candidateError && <div className="mt-1 line-clamp-1 text-[10px] text-rose-500">候选失败：{item.candidateError}</div>}
          {!item.candidateFailed && item.reason && <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">候选失分原因：{item.reason}</div>}
        </div>;
      })}
    </div> : <div className="mt-3 rounded-xl border border-dashed px-3 py-2.5 text-xs leading-5 text-slate-400">本轮评审模型未返回逐题分数，暂时只能按上方维度条和执行失败定位差距；重跑盲测时会自动尝试获取逐题归因。</div>}
  </CardContent></Card>;
}

/** 盲测执行完的 AI 优化建议：把分数与差距翻译成"该调什么、怎么调"，每条可一键转成进化要求。 */
function GapAdviceCard({ advice, busy, error, onRegenerate, onAppend }: {
  advice?: { overall: string; actions: Array<{ title: string; detail: string; target: string }> };
  busy: boolean;
  error?: string;
  onRegenerate: () => void;
  onAppend: (text: string) => void;
}) {
  const [appended, setAppended] = useState<Record<number, boolean>>({});
  return <Card><CardContent className="pt-5">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold"><WandSparkles className="size-4 text-indigo-600" />AI 优化建议</div>
      <Button size="sm" variant="secondary" onClick={onRegenerate} disabled={busy}><Loader2 className={cn("size-3.5", busy && "animate-spin")} />{advice ? "重新生成建议" : "生成优化建议"}</Button>
    </div>
    <p className="mt-1 text-xs text-slate-400">盲测跑完 AI 自动看分数、检查项与差距归因，给出整体诊断和可落地的调整动作；每条动作可一键转成本轮进化要求。</p>
    <CommandScopeNote compact />
    {error && <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">生成建议失败：{error}</div>}
    {advice ? <>
      <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs leading-5 text-indigo-900"><b>整体诊断：</b>{advice.overall}</div>
      {advice.actions.length ? <div className="mt-3 space-y-2">{advice.actions.map((action, index) => <div key={`${action.title}-${index}`} className="rounded-xl border bg-white p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-800">{index + 1}. {action.title}</span><Badge className="border-slate-200 bg-slate-100 text-slate-600">{action.target}</Badge></div>
        <div className="mt-1.5 text-[11px] leading-5 text-slate-500">{action.detail}</div>
        <div className="mt-2"><button type="button" disabled={appended[index]} onClick={() => { onAppend(`${action.title}（${action.target}）：${action.detail}`); setAppended((current) => ({ ...current, [index]: true })); }} className={cn("rounded-lg border px-2 py-1 text-[10px] font-semibold transition", appended[index] ? "cursor-default border-emerald-200 bg-emerald-50 text-emerald-600" : "border-indigo-300 bg-white text-indigo-600 hover:bg-indigo-50")}>{appended[index] ? "已加入进化要求 ✓" : "转为进化要求"}</button></div>
      </div>)}</div> : <div className="mt-3 rounded-xl border border-dashed px-3 py-2 text-xs text-slate-400">AI 未给出具体动作，可点右上角「重新生成建议」再试一次。</div>}
    </> : <div className="mt-3 rounded-xl border border-dashed px-3 py-2.5 text-xs leading-5 text-slate-400">这轮验证还没有优化建议。点右上角「生成优化建议」，AI 会结合分数与差距给出具体调整方向。</div>}
  </CardContent></Card>;
}

/** 建议效果账本：每轮盲测自动结算上一轮建议「执行了没 / 见效了没」，形成 建议→执行→效果 闭环。 */
function AdviceLedgerPanel({ ledger }: { ledger: AdviceSettlement[] }) {
  if (!ledger.length) return null;
  return <Card><CardContent className="pt-5">
    <div className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-indigo-600" />建议效果追踪</div>
    <p className="mt-1 text-xs text-slate-400">每次盲测完成会自动结算上一轮 AI 建议：是否执行（已转成进化要求、或被候选方案承接），是否见效（整体分数提升）。没见效的动作会提示换法或复核根因。</p>
    <div className="mt-3 space-y-3">{ledger.slice().reverse().map((entry) => {
      const executedCount = entry.actions.filter((action) => action.executed).length;
      const improvedCount = entry.actions.filter((action) => action.improved).length;
      return <div key={entry.settledAt} className="rounded-xl border bg-white p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-700">{new Date(entry.settledAt).toLocaleString("zh-CN")}</span>
          <Badge className="border-slate-200 bg-slate-100 text-slate-600">已执行 {executedCount}/{entry.actions.length}</Badge>
          <Badge className={improvedCount ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{improvedCount ? `见效 ${improvedCount} 条` : "整体未见效"}</Badge>
          <span className="text-slate-400">整体 准确 {entry.before.accuracy}%→{entry.after.accuracy}% · 完成 {entry.before.completeness}%→{entry.after.completeness}%</span>
        </div>
        <div className="mt-2 space-y-1">{entry.actions.map((action) => <div key={action.title} className="flex items-start gap-2 text-[11px] leading-5">
          {action.improved ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : action.executed ? <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" /> : <span className="mt-1 size-3 shrink-0 rounded-full border border-slate-300" />}
          <span className="min-w-0 text-slate-600"><b className="text-slate-700">{action.title}</b><span className="text-slate-400">（{action.target}）</span> —— {action.note}</span>
        </div>)}</div>
      </div>;
    })}</div>
  </CardContent></Card>;
}

function PendingEvidenceCard({ runtime, criterion }: { runtime: ProjectRuntime; criterion: AcceptanceCriterion }) {
  const p = runtime.project;
  const winner = runtime.winner;
  const route = evidenceRouteForCriterion(p, criterion);
  const score = p.validationRun.evaluation?.criterionScores?.find((item) => item.criterionId === criterion.id);
  const pendingDetails = score?.gaps.filter((gap) => gap.trim()).slice(0, 2) ?? [];
  const htmlTarget = p.sourceArtifacts.some((artifact) => artifact.role === "target" && /^(html|htm)$/i.test(artifact.extension));
  const htmlBrowserRequired=requiresSandboxHtmlSourceExecution(p);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setVisualEvidenceTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (route !== "visual") return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!detail?.projectId || detail.projectId === p.id) setVisualEvidenceTick((value) => value + 1);
    };
    window.addEventListener(VISUAL_EVIDENCE_EVENT, refresh);
    return () => window.removeEventListener(VISUAL_EVIDENCE_EVENT, refresh);
  }, [route, p.id]);
  const saved = winner ? latestSupplementalEvidenceForCriterion(p, winner, criterion.id) : undefined;
  const relevantSnapshot = winner?.artifactSnapshots.find((snapshot) => criterion.artifactIds.includes(snapshot.sourceArtifactId) && snapshot.contentHash)
    ?? winner?.artifactSnapshots.find((snapshot) => Boolean(snapshot.contentHash));
  const screenshotIds = winner && relevantSnapshot?.contentHash
    ? getVisualEvidence(p.id).items.filter((item) => item.candidateId === winner.id && item.artifactHash === relevantSnapshot.contentHash).map((item) => item.id)
    : [];
  const revalidateAndResume = () => {
    window.setTimeout(() => {
      void runtime.revalidateAndContinue();
    }, 0);
  };
  const saveDecision = (verdict: "pass" | "fail") => {
    setError("");
    try {
      runtime.recordSupplementalValidationEvidence({ criterionId: criterion.id, verdict, note, screenshotIds: route === "visual" ? screenshotIds : undefined });
      setNote("");
      revalidateAndResume();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const connectRunner = async () => {
    if(htmlBrowserRequired){
      setError("上传的 HTML Target 必须先获得 Vercel Sandbox + Chromium Browser Steps 真实授权；不能用通用 HTTP Runner 替换原始文件身份。");
      return;
    }
    setBusy(true); setError("");
    try {
      const config = getRunnerGatewayConfig();
      const result = await testRunnerGateway(config);
      if (!result.ok) throw new Error(result.message);
      runtime.setTargetConnection(connectedTargetConnection(config, p.id));
      revalidateAndResume();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  const routeLabel = route === "visual" ? "看截图确认" : route === "manual" ? "真人验收" : route === "runner" ? "真实运行 / E2E" : route === "capability" ? "暂缺可验证证据" : "系统重新检查";
  return <div className="rounded-2xl border bg-white p-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{criterion.title}</span><Badge className="border-amber-200 bg-amber-50 text-amber-700">{routeLabel}</Badge>{criterion.hardGate&&<Badge>关键要求</Badge>}</div><p className="mt-1 text-xs leading-5 text-slate-500">{criterion.requirement}</p></div>{saved&&<Badge className={saved.verdict==="pass"?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-rose-200 bg-rose-50 text-rose-700"}>已记录：{saved.verdict==="pass"?"通过":"未通过"}</Badge>}</div>
    {pendingDetails.length > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><b>本次未完成原因：</b>{pendingDetails.join("；")}</div>}
    {route === "visual" && <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3"><div className="flex items-start gap-2"><Camera className="mt-0.5 size-4 shrink-0 text-indigo-600"/><div className="text-xs leading-5 text-slate-600"><b>怎么验证：</b>上传当前新版的实际截图，看这一条视觉要求是否满足。截图只证明画面，不会替代点击、保存、上传等 E2E 行为验证。</div></div><input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event)=>{ const files=[...(event.target.files??[])]; event.currentTarget.value=""; if(!files.length)return; if(!winner||!relevantSnapshot?.contentHash){setError("当前新版还没有可绑定的成果指纹，请先重新验收一次。");return;} setBusy(true);setError("");void addVisualEvidence(p.id,files,{artifactHash:relevantSnapshot.contentHash,sourceArtifactId:relevantSnapshot.sourceArtifactId,candidateId:winner.id,origin:"upload"}).catch((cause)=>setError(cause instanceof Error?cause.message:String(cause))).finally(()=>setBusy(false)); }}/><div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" disabled={busy||!winner} onClick={()=>inputRef.current?.click()}><Camera className="size-3.5"/>上传当前版本截图</Button><span className="text-[11px] text-slate-500">当前已绑定 {screenshotIds.length} 张</span></div></div>}
    {(route === "visual" || route === "manual") && <div className="mt-3"><textarea className="min-h-20 w-full rounded-xl border bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-indigo-300" placeholder={route==="visual"?"写下你实际看到的结果，例如：主操作突出，信息层级清楚；或具体指出哪里仍不达标。":"填写实际验收结果和依据，不能只写“通过”。"} value={note} onChange={(event)=>setNote(event.target.value)}/><div className="mt-2 flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" disabled={busy||!note.trim()||(route==="visual"&&screenshotIds.length===0)} onClick={()=>saveDecision("fail")}>确认未通过</Button><Button size="sm" disabled={busy||!note.trim()||(route==="visual"&&screenshotIds.length===0)} onClick={()=>saveDecision("pass")}><Check className="size-3.5"/>确认这一项通过</Button></div><p className="mt-2 text-[11px] leading-4 text-slate-400">确认只对当前新版和当前成果指纹有效；新版内容变化后必须重新验证。</p></div>}
    {route === "runner" && htmlBrowserRequired && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
      <b>需要已授权的 HTML Sandbox 浏览器执行</b>
      <p className="mt-1">当前要求包含真实点击或浏览器行为。截图与 HTTP Target Proxy 都不能证明上传 HTML 文件的完整互动；必须在隔离 Chromium 中执行 Browser Steps 并绑定冻结版本。</p>
      <a href="#/readiness" className="mt-3 inline-flex h-8 items-center rounded-lg border border-amber-300 bg-white px-3 font-semibold text-amber-900 hover:bg-amber-100">检查 Sandbox 与 Browser 授权</a>
    </div>}
    {route === "runner" && !htmlBrowserRequired && <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/50 p-3"><div className="flex items-start gap-2"><PlugZap className="mt-0.5 size-4 shrink-0 text-sky-600"/><div className="text-xs leading-5 text-slate-600"><b>怎么验证：</b>这条要求涉及真实点击、运行、上传、保存或端到端行为，截图不能证明。需要由 Target Runner 实际执行。</div></div><div className="mt-3 flex flex-wrap gap-2">{p.targetConnection.adapter==="http"?<Button size="sm" disabled={runtime.validationRequestQueued} onClick={revalidateAndResume}><Play className="size-3.5"/>{runtime.validationRequestQueued?"已排队重新验收":"用真实 Runner 验收并继续"}</Button>:<Button size="sm" disabled={busy} onClick={()=>void connectRunner()}><PlugZap className="size-3.5"/>{busy?"正在检测…":"检测并连接 Runner"}</Button>}<a href="#/settings" className="inline-flex h-8 items-center rounded-lg border bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50">Runner 设置</a></div>{p.targetConnection.adapter==="http"&&<p className="mt-2 text-[11px] text-emerald-700">Runner 已连接；当前提示来自上一轮验收结果，点击后才会用真实执行证据重新结算。</p>}</div>}
    {route === "local" && <div className="mt-3 flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-slate-600">这条要求不需要人工截图。系统可以按它自己的验证方式重新检查结构、格式 Roundtrip 或当前成果内容。</p><Button size="sm" variant="secondary" disabled={runtime.validationRequestQueued} onClick={revalidateAndResume}><RefreshCcw className="size-3.5"/>{runtime.validationRequestQueued?"已排队重新验收":runtime.status.busy?"当前任务结束后自动验收":"重新检查并继续"}</Button></div>}
    {route === "capability" && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">当前验收项缺少可读取的完整目标内容或对应格式的执行能力。{htmlTarget&&"HTML 可直接检查，但需要保存完整 Candidate 文件。"}请检查第 1 步的文件解析状态和目标关联；真实操作类要求请连接 Runner；原文件内容丢失时请重新上传。</div>}
    {saved&&<div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs leading-5 text-emerald-800">已记录证据：{saved.note}。系统会自动重新验收；通过则继续到成果，不通过则自动进入下一轮改进。</div>}
    {error&&<div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{error}</div>}
  </div>;
}

export function PendingEvidencePanel({ runtime, criteria }: { runtime: ProjectRuntime; criteria: AcceptanceCriterion[] }) {
  if (!criteria.length) return null;
  const localOnly = criteria.every((criterion) => evidenceRouteForCriterion(runtime.project, criterion) === "local");
  const feedback = runtime.status.error ?? (!runtime.validationRequestQueued && /验收|验证|复验/.test(runtime.status.message ?? "") ? runtime.status.message : undefined);
  return <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="font-semibold text-amber-950">{localOnly ? `还有 ${criteria.length} 项系统检查未完成` : `还差 ${criteria.length} 项验证`}</div><p className="mt-1 text-sm leading-6 text-amber-900/75">{localOnly ? "系统会读取当前成果并取得新的独立评审，复用已经核验的文件证据。每项下方显示本次未完成原因；检查通过后继续，已证实的问题会进入修复。" : "每条要求下方说明了验证方式和本次缺口。补齐对应截图、验收结论或真实执行证据后，系统会复验并继续。"}</p></div><Button size="sm" variant="secondary" disabled={runtime.status.busy||runtime.validationRequestQueued} onClick={()=>{void runtime.revalidateAndContinue();}}><RefreshCcw className="size-3.5"/>{runtime.validationRequestQueued?"已排队":"复验并继续"}</Button></div>{feedback&&<p role="status" className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${runtime.status.error?"border-rose-200 bg-rose-50 text-rose-800":"border-sky-200 bg-sky-50 text-sky-800"}`}>{feedback}</p>}<div className="mt-4 grid gap-3 xl:grid-cols-2">{criteria.map((criterion)=><PendingEvidenceCard key={criterion.id} runtime={runtime} criterion={criterion}/>)}</div></div>;
}

function ValidationPanel({ runtime }: { runtime: ProjectRuntime }) {
  const p=runtime.project;
  const autonomousMode=p.campaign.executionMode==="auto-rounds";
  const liveRelease=projectHasOnlineReleaseTarget(p);
  const v=p.validationRun;
  const acceptance=p.artifactAcceptance;
  const artifactApproved=runtime.gate("artifact-ready")?.status==="approved";
  const releaseApproved=runtime.gate("release-ready")?.status==="approved";
  const behaviorPassed=v.status==="completed"&&v.recommendation==="release";
  const actualFailedChecks=v.checks.filter((check)=>check.status==="fail");
  const unverifiedCriteriaCount=v.evaluation?.unverifiedCriterionIds?.length??0;
  const pendingCriteria=(v.evaluation?.unverifiedCriterionIds??[]).flatMap((id)=>{const criterion=p.acceptanceRubric.find((item)=>item.id===id);return criterion?[criterion]:[];});
  const localPendingCriteria=pendingCriteria.filter((criterion)=>evidenceRouteForCriterion(p,criterion)==="local");
  const externalPendingCriteria=pendingCriteria.filter((criterion)=>evidenceRouteForCriterion(p,criterion)!=="local");
  const autonomousValidationRunning=autonomousMode&&runtime.status.busy;
  const localPendingKey=`${runtime.winner?.id??"none"}:${localPendingCriteria.map((criterion)=>criterion.id).sort().join(",")}`;
  const autoRevalidateAttemptRef=useRef<string|undefined>(undefined);
  const resumeAutonomousEvolution=runtime.resumeAutonomousEvolution;
  // Browser execution cannot survive a refresh. If a persisted autonomous run reopens on a purely
  // local evidence pause, resume it once automatically instead of showing a passive “已进入自动复验”
  // badge while no job is actually running. The stable key prevents an evaluator outage from
  // spinning indefinitely on the same Candidate + criterion set.
  useEffect(()=>{
    if(!autonomousMode||runtime.status.busy||v.status!=="completed"||!localPendingCriteria.length||externalPendingCriteria.length||!runtime.winner)return;
    if(!["paused","idle"].includes(p.campaign.status))return;
    if(autoRevalidateAttemptRef.current===localPendingKey)return;
    autoRevalidateAttemptRef.current=localPendingKey;
    const timer=window.setTimeout(()=>{void resumeAutonomousEvolution();},0);
    return()=>window.clearTimeout(timer);
  },[autonomousMode,runtime.status.busy,v.status,localPendingKey,localPendingCriteria.length,externalPendingCriteria.length,runtime.winner,p.campaign.status,resumeAutonomousEvolution]);
  const evidenceIncomplete=v.status==="completed"&&v.recommendation==="hold"&&actualFailedChecks.length===0&&unverifiedCriteriaCount>0;
  const artifactPassed=acceptance?.status==="passed"&&acceptance.hardGatePass;
  const behaviorRepairAttempts=acceptance?.attempts??0;
  const canRelease=behaviorPassed&&artifactPassed;
  const plannedCases=v.plannedCases??p.hiddenEvalSuite.length;
  const executedCases=v.executedCases??v.runs.length;
  const [inspect,setInspect]=useState<{title:string;runs:TargetRunResult[]}|null>(null);
  const metricTarget=(...keys:string[])=>p.metrics.find((metric)=>keys.includes(metric.key))?.target;
  const failedCriteria=acceptance?.results.filter((item)=>!item.pass)??[];
  const displayCheckDetail=(check:typeof v.checks[number])=>{
    const criterion=p.acceptanceRubric.find((item)=>check.label.includes(item.title));
    const relatedTests=criterion?p.hiddenEvalSuite.filter((test)=>test.criterionIds.includes(criterion.id)&&v.runs.some((run)=>run.testCaseId===test.id)):[];
    const semanticOnly=relatedTests.length>0&&relatedTests.every((test)=>test.executionMode==="artifact-runtime");
    return semanticOnly?check.detail.replace(/真实证据/g,"AI 语义证据"):check.detail;
  };
  const gapAnalysis=v.status==="completed"&&v.evaluation&&v.baselineEvaluation?computeGapAnalysis({candidate:v.evaluation,baseline:v.baselineEvaluation,candidateRuns:v.runs,baselineRuns:v.baselineRuns,testCases:p.hiddenEvalSuite}):null;
  const [adviceBusy,setAdviceBusy]=useState(false); const [adviceError,setAdviceError]=useState<string>();
  const regenerateAdvice=async()=>{setAdviceBusy(true);setAdviceError(undefined);try{const data=GapAdviceAiResultSchema.parse(await runAi("gap-advice",buildGapAdvicePayload({project:p,checks:v.checks,evaluation:v.evaluation,baselineEvaluation:v.baselineEvaluation,runs:v.runs,baselineRuns:v.baselineRuns})));runtime.commit((current)=>({...current,validationRun:{...current.validationRun,aiAdvice:data}}));}catch(error){setAdviceError(error instanceof Error?error.message:"未知错误");}finally{setAdviceBusy(false);}};
  return <div className="space-y-4">
    <SectionTitle eyebrow="第 4 步 · 最终验收" title="新版真的变好了吗？" desc="系统会用新的测试场景检查实际效果，同时确认格式、结构和必须保留的内容没有被破坏。" action={autonomousMode?undefined:<Button onClick={()=>void runtime.requestValidation()} disabled={!runtime.winner||runtime.validationRequestQueued}><ShieldCheck className="size-4"/>{runtime.validationRequestQueued?"已排队重新验收":runtime.status.busy?"等待当前任务后验收":v.status==="completed"?"重新验收":"开始验收"}</Button>}/>
    <TechnicalDetails label="技术人员查看：证据等级与验证能力"><div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-white px-4 py-3 text-xs text-slate-600"><span>文件确定性：结构/格式</span><span>AI 语义：内容是否明确出现</span><span>真实运行：浏览器/E2E</span><span>视觉：截图评审</span><span>人工：实操确认</span></div></TechnicalDetails>
    <div className="grid gap-3 lg:grid-cols-3">
      <ValidationStep index="1" title="实际效果" subtitle="用之前没见过的场景检查新版是否真的更好" status={v.status==="completed"?(behaviorPassed?"pass":evidenceIncomplete?"ready":"fail"):v.status==="failed"?"fail":"pending"} detail={v.status==="completed"?(behaviorPassed?`已完成 ${executedCases}/${plannedCases} 个新场景检查，结果通过`:evidenceIncomplete?"目前没有证据说明成果失败，但还有部分要求需要补充真实验证":"发现已经有证据支持的问题，需要修复后再验收"):v.status==="failed"?(v.error??"验收运行失败"):"等待开始验收"}/>
      <ValidationStep index="2" title="成果完整" subtitle="确认格式、结构和必须保留的内容没有被破坏" status={!behaviorPassed?"blocked":artifactPassed?"pass":acceptance?.status==="failed"?"fail":"pending"} detail={!behaviorPassed?"先完成实际效果检查":artifactPassed?"成果完整，可以冻结为正式版本":acceptance?.status==="failed"?"成果完整性仍有问题，需要修复":"等待成果完整性检查"}/>
      <ValidationStep index="3" title="成果交付" subtitle={liveRelease?"离线成果自动冻结；生产上线仍需授权":"验收通过后系统自动生成可领取成果"} status={releaseApproved?"pass":canRelease?"ready":"blocked"} detail={releaseApproved?"最终成果已准备好":canRelease?(liveRelease?"离线成果已达标；如需上线生产环境仍需人工授权":"系统会自动冻结并生成成果包，无需再次确认"):"等待前两项通过"}/>
    </div>

    {v.status==="completed"&&localPendingCriteria.length>0&&<div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-sky-950">剩余 {localPendingCriteria.length} 项由系统自动复验</div><p className="mt-1 text-sm leading-6 text-sky-900/75">这些都是内容、结构或文本格式检查，不需要你上传截图、人工确认或连接 Runner。系统会直接读取当前新版并自动结算。</p><div className="mt-2 flex flex-wrap gap-1.5">{localPendingCriteria.map((criterion)=><Badge key={criterion.id} className="border-sky-200 bg-white text-sky-700">{criterion.title}</Badge>)}</div></div>{autonomousValidationRunning?<Badge className="border-sky-200 bg-white text-sky-700"><Loader2 className="mr-1 size-3 animate-spin"/>正在自动复验</Badge>:autonomousMode?<Button size="sm" disabled={runtime.status.busy} onClick={()=>void runtime.resumeAutonomousEvolution()}><RefreshCcw className="size-3.5"/>立即自动复验</Button>:<Button size="sm" disabled={runtime.validationRequestQueued} onClick={()=>void runtime.requestValidation()}><RefreshCcw className="size-3.5"/>{runtime.validationRequestQueued?"已排队重新验收":runtime.status.busy?"暂停当前任务并自动验收":"系统自动重新验收"}</Button>}</div></div>}
    {v.status==="completed"&&externalPendingCriteria.length>0&&<PendingEvidencePanel runtime={runtime} criteria={externalPendingCriteria}/>} 
    {runtime.validationRequestQueued&&<div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-800">重新验收已经排队。{runtime.status.busy?"系统会先安全结束/暂停当前运行任务，然后自动执行当前 Winner 的验收；无需再次点击。":"正在启动重新验收。"}</div>}
    {!runtime.validationRequestQueued&&runtime.status.message&&/验收|验证/.test(runtime.status.message)&&<div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-800">{runtime.status.message}</div>}
    {runtime.status.error&&<div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">重新验收未启动：{runtime.status.error}</div>}

    {v.status==="completed"&&!behaviorPassed&&behaviorRepairAttempts>0&&<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold">自动修复闭环已执行 {behaviorRepairAttempts} 次</div><p className="mt-1">系统只修改有明确失败证据的验收项，并在每次修改后重新运行 Hidden Validation；已通过内容和待补外部证据项不会作为修复目标。当前仍未通过时，可基于本轮证据生成下一组方案。</p></div><Button size="sm" onClick={()=>void runtime.generatePlan()} disabled={runtime.status.busy}><WandSparkles className="size-3.5"/>基于失败证据生成下一轮</Button></div></div>}

    {v.status==="completed"&&v.evaluation&&<Card><CardContent className="pt-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-slate-900">实际效果检查</div><Badge className={behaviorPassed?"border-emerald-200 bg-emerald-50 text-emerald-700":evidenceIncomplete?"border-amber-200 bg-amber-50 text-amber-700":"border-rose-200 bg-rose-50 text-rose-700"}>{behaviorPassed?"通过":evidenceIncomplete?"还需补验证":"未通过"}</Badge></div><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{v.summary}</p></div>{(v.runs.some((run)=>run.error)||v.baselineRuns.some((run)=>run.error))&&<Button size="sm" variant="secondary" onClick={()=>void runtime.retryFailedValidation()} disabled={runtime.status.busy}>补跑失败检查</Button>}</div>{!behaviorPassed&&!evidenceIncomplete&&<div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">已经发现明确问题。系统会保留通过的部分，只针对失败项继续改进。</div>}{evidenceIncomplete&&<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">当前没有判定成果失败。{externalPendingCriteria.length?"需要你介入的项目已在上方给出对应验证入口。":"剩余项目都可由系统自行检查，无需人工补证；点击上方“系统自动重新验收”即可。"}</div>}</CardContent></Card>}

    {behaviorPassed&&<Card className={cn("border-2",artifactPassed?"border-emerald-200":"border-amber-200")}><CardContent className="pt-5"><div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-slate-900">成果完整性</div><Badge className={artifactPassed?"border-emerald-200 bg-emerald-50 text-emerald-700":acceptance?.status==="failed"?"border-rose-200 bg-rose-50 text-rose-700":"border-amber-200 bg-amber-50 text-amber-700"}>{artifactPassed?"通过":acceptance?.status==="failed"?"需要修复":"检查中"}</Badge></div><p className="mt-2 text-sm leading-6 text-slate-500">{artifactPassed?"格式、结构、用户要求和必须保留的内容都已通过检查。":acceptance?.summary??"正在检查最终成果是否完整。"}</p>{acceptance?.status==="failed"&&<div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">有 {failedCriteria.length} 项未通过，系统只会修复失败项。</div>}{autonomousMode?<div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-5 text-emerald-800">自动模式下无需人工确认 Gate。通过后系统会冻结刚刚验收过的同一成果快照并继续打包。</div>:<div className="mt-4"><GateCard title="确认成果完整" approved={artifactApproved} disabled={!artifactPassed} onApprove={()=>runtime.approveGate("artifact-ready","最终成果通过项目专属 Acceptance Rubric 与结构完整性检查")}>{artifactPassed?"确认后冻结这份刚刚验收通过的版本。":"检查通过后才能确认。"}</GateCard></div>}</CardContent></Card>}

    <Card><CardContent className="pt-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-slate-900">成果交付</div><p className="mt-1 text-sm leading-6 text-slate-500">实际效果和成果完整性通过后，离线成果会自动冻结和打包；只有真实生产上线继续保留人工授权。</p></div>{releaseApproved?null:autonomousMode&&!liveRelease?<Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">系统自动完成</Badge>:<Button disabled={!canRelease} onClick={()=>runtime.approveGate("release-ready","Hidden Behavior + 成果物完整性 全部通过")}>{liveRelease?"授权进入上线流程":"确认可以交付"}</Button>}</div>{releaseApproved&&artifactApproved&&liveRelease&&<div className="mt-4 flex justify-end"><Button onClick={()=>runtime.setStage("release")} disabled={runtime.status.busy}><Eye className="size-4"/>进入发布控制</Button></div>}{releaseApproved&&artifactApproved&&!liveRelease&&<div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-900">验收完成，可以到“成果与版本”领取文件。当前没有连接线上发布平台，因此不会显示虚假的上线结果。</div>}</CardContent></Card>

    {v.status==="failed"&&<div className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><div className="flex items-center gap-2 text-sm font-bold text-rose-800"><CircleAlert className="size-4"/>验证执行失败</div><p className="mt-2 break-words text-xs leading-5 text-rose-700">{v.error??"未知错误"}</p><div className="mt-3"><Button size="sm" onClick={()=>void runtime.executeValidation()} disabled={runtime.status.busy}>重试验证</Button></div></div>}
    {v.status!=="completed"&&v.status!=="failed"&&<div className="rounded-2xl border border-dashed p-9 text-center"><ShieldCheck className="mx-auto size-8 text-slate-300"/><div className="mt-3 text-sm font-semibold text-slate-700">最终验收还没开始</div><p className="mt-1 text-sm text-slate-500">点击“开始验收”，系统会先做关键检查；如果已经发现明确问题，就不会浪费时间继续跑后面的检查。</p></div>}

    {v.status==="completed"&&<TechnicalDetails label="技术人员查看：完整验证证据、评分与逐题结果" meta="逐题 / Rubric / 差距 / 建议"><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" disabled={!v.runs.length} onClick={()=>setInspect({title:`新版逐题结果 · ${runtime.winner?.title||runtime.winner?.name||""}`,runs:v.runs})}>新版逐题</Button><Button variant="secondary" size="sm" disabled={!v.baselineRuns.length} onClick={()=>setInspect({title:"当前版本同卷对照",runs:v.baselineRuns})}>当前版本逐题</Button><Button variant="secondary" size="sm" onClick={()=>{const blob=new Blob([validationReportMarkdown(p,v,runtime.winner?.title||runtime.winner?.name||"")],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`evolve-验证报告-${p.name}.md`;anchor.click();URL.revokeObjectURL(url);}}><FileText className="size-3.5"/>导出验证报告</Button></div>{v.evaluation&&<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6"><ScoreCard label="Rubric" value={v.evaluation.rubricScore} target={85}/><ScoreCard label="证据覆盖" value={v.evaluation.verifiedRubricCoverage??100} target={100}/><ScoreCard label="准确性" value={v.evaluation.accuracy} target={metricTarget("accuracy","quality")}/><ScoreCard label="证据质量" value={v.evaluation.evidence} target={metricTarget("evidence")}/><ScoreCard label="风险覆盖" value={v.evaluation.riskCoverage} target={metricTarget("risk","robustness")}/><ScoreCard label="成本" value={v.evaluation.averageCost} unit="¥" target={metricTarget("cost")}/></div>}{acceptance&&<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><ScoreCard label="要求覆盖" value={acceptance.coverageScore} target={90}/><ScoreCard label="成果完整性" value={acceptance.integrityScore} target={90}/><ScoreCard label="相对原版提升" value={acceptance.pairwiseScore} target={80}/><ScoreCard label="综合验收" value={acceptance.overallScore} target={85}/></div>}<div className="grid gap-2 md:grid-cols-2">{v.checks.map((check)=><div key={check.label} className={cn("rounded-xl border p-3",check.status==="pass"?"border-emerald-200 bg-emerald-50":check.status==="fail"?"border-rose-200 bg-rose-50":"border-amber-200 bg-amber-50")}><div className="text-xs font-semibold">{check.label}</div><div className="mt-1 text-xs leading-5 text-slate-500">{displayCheckDetail(check)}</div></div>)}</div>{acceptance&&<div className="grid gap-2 md:grid-cols-2">{acceptance.results.map((item)=>{const criterion=p.acceptanceRubric.find((entry)=>entry.id===item.criterionId);return <div key={item.criterionId} className={cn("rounded-xl border p-3",item.pass?"border-emerald-200 bg-emerald-50/60":criterion?.hardGate?"border-rose-200 bg-rose-50/60":"border-amber-200 bg-amber-50/60")}><div className="flex items-center gap-2"><span className="text-xs font-semibold">{criterion?.title??item.criterionId}</span>{criterion?.hardGate&&<Badge>Hard</Badge>}<span className="ml-auto text-xs font-bold">{item.score}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{item.evidence.join("；")}</p></div>})}</div>}{gapAnalysis&&<GapAnalysisCard analysis={gapAnalysis} command={p.evolutionCommand} onAppendCommand={(text)=>appendGapAdvice(runtime,text)}/>}<GapAdviceCard advice={v.aiAdvice} busy={adviceBusy} error={adviceError} onRegenerate={()=>void regenerateAdvice()} onAppend={(text)=>appendGapAdvice(runtime,text)}/>{p.adviceLedger.length>0&&<AdviceLedgerPanel ledger={p.adviceLedger}/>}</TechnicalDetails>}
    {!autonomousMode&&!behaviorPassed&&!evidenceIncomplete&&v.status==="completed"&&<div className="flex flex-wrap justify-end gap-2"><Button onClick={()=>void runtime.generatePlan()} disabled={runtime.status.busy}><WandSparkles className="size-4"/>保留已通过内容，仅修复失败项</Button><Button variant="secondary" onClick={()=>runtime.setStage("plan")}>回方案页</Button></div>}
    {inspect&&<RunInspector title={inspect.title} runs={inspect.runs} testCases={p.hiddenEvalSuite} onClose={()=>setInspect(null)}/>} 
  </div>;
}

function ValidationStep({index,title,subtitle,status,detail}:{index:string;title:string;subtitle:string;status:"pass"|"fail"|"pending"|"blocked"|"ready";detail:string}){
  const tone=status==="pass"?"border-emerald-200 bg-emerald-50/60":status==="fail"?"border-rose-200 bg-rose-50/60":status==="ready"?"border-indigo-200 bg-indigo-50/60":status==="blocked"?"border-slate-200 bg-slate-50 opacity-70":"border-amber-200 bg-amber-50/50";
  return <div className={cn("rounded-2xl border p-4",tone)}><div className="flex items-start gap-3"><div className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold",status==="pass"?"bg-emerald-600 text-white":status==="fail"?"bg-rose-600 text-white":status==="ready"?"bg-indigo-600 text-white":"bg-white text-slate-500")}>{status==="pass"?<Check className="size-4"/>:status==="fail"?<X className="size-4"/>:index}</div><div><div className="text-sm font-semibold text-slate-900">{title}</div><div className="mt-0.5 text-xs font-medium leading-5 text-slate-500">{subtitle}</div></div></div><p className="mt-3 text-xs leading-5 text-slate-500">{detail}</p></div>;
}

/** 发布动作对应的流量比例：历史条目直接展示"这一步放了多少流量"。 */
const TRAFFIC_BY_ACTION: Record<string, string> = {
  shadow: "0%",
  "canary-5": "5%",
  "canary-20": "20%",
  "canary-50": "50%",
  promote: "100%",
};

function ReleasePanel({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const vercelRelease = p.releaseTarget?.provider === "vercel" && p.releaseTarget.status === "connected";
  const genericHttpRelease = p.releaseTarget?.provider === "http" && p.releaseTarget.status === "connected";
  const liveRelease = projectHasOnlineReleaseTarget(p);
  const previewPromote = liveRelease && p.releaseTarget?.mode === "preview-promote";
  const steps: { action: "shadow" | "canary-5" | "canary-20" | "canary-50" | "promote"; label: string; traffic: string }[] = previewPromote ? [
    { action: "shadow", label: "Preview Gate", traffic: "0% Production 流量" },
    { action: "promote", label: "Production", traffic: "100% Production 流量" },
  ] : [
    { action: "shadow", label: "后台观察", traffic: "不影响真实用户" },
    { action: "canary-5", label: "小流量试运行", traffic: "5% 用户" },
    { action: "canary-20", label: "扩大试运行", traffic: "20% 用户" },
    { action: "canary-50", label: "半量运行", traffic: "50% 用户" },
    { action: "promote", label: "全量上线", traffic: "100% 用户" },
  ];
  const index = steps.findIndex((s) => s.action === (p.release.status === "promoted" ? "promote" : p.release.status));
  const next = steps[Math.min(index + 1, steps.length - 1)] ?? { action: "shadow" as const, label: "Shadow", traffic: "0% 用户" };
  // 生产基线条：文案随发布状态分支，避免"在产"与"已回滚"自相矛盾；
  // 新一轮验证时展示当前迭代版本（如 V8），而不是永远只挂旧发布版（如 V6）。
  const releasedVersion = p.versions.filter((version) => version.releasedAt).sort((a, b) => (a.releasedAt! < b.releasedAt! ? 1 : -1))[0];
  const currentVersion = p.versions.find((version) => version.id === p.currentVersionId) ?? p.versions[p.versions.length - 1];
  const lastRollbackAt = p.release.history.slice().reverse().find((entry) => entry.action === "rollback")?.at;
  const releasedLive = Boolean(releasedVersion && (!lastRollbackAt || (releasedVersion?.releasedAt ?? "") > lastRollbackAt));
  const challengeStage: Record<string, string> = previewPromote
    ? { shadow: "Preview Gate" }
    : { shadow: "后台观察", "canary-5": "小流量试运行", "canary-20": "扩大试运行", "canary-50": "半量运行" };
  const challenging = challengeStage[p.release.status];
  // 发布轮次：每次从 Shadow 重新起手算新一轮发布周期，给历史条目打徽标，多轮记录不再混作一锅。
  const historyWithRound = p.release.history.map((entry, idx) => ({
    ...entry,
    cycle: Math.max(p.release.history.slice(0, idx + 1).filter((item) => item.action === "shadow").length, 1),
  }));
  // 在产栏回滚快捷入口：新候选验证出问题时一步回到旧版，二次确认防误触。
  const [rollbackArm, setRollbackArm] = useState(false);
  const [releaseCaps, setReleaseCaps] = useState<VercelReleaseCapabilities>();
  const [releaseHealth, setReleaseHealth] = useState<VercelReleaseHealth>();
  const [httpReleaseCaps,setHttpReleaseCaps]=useState<TargetProxyCapabilities>();
  const [releaseDeployments, setReleaseDeployments] = useState<VercelDeploymentSummary[]>([]);
  const [releaseProviderBusy, setReleaseProviderBusy] = useState(false);
  const [releaseProviderError, setReleaseProviderError] = useState("");
  useEffect(() => {
    if (!vercelRelease) return;
    let active = true;
    void Promise.all([getServerVercelReleaseCapabilities(), checkServerVercelReleaseHealth()])
      .then(([caps, health]) => {
        if (!active) return;
        setReleaseCaps(caps);
        setReleaseHealth(health);
        if (caps.writeEnabled) {
          void listServerVercelDeployments().then((result) => {
            if (active && result.available) setReleaseDeployments(result.deployments);
          }).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (active) setReleaseProviderError(error instanceof Error ? error.message : String(error));
      });
    return () => { active = false; };
  }, [vercelRelease]);
  useEffect(()=>{
    let active=true;
    void getTargetProxyCapabilities()
      .then((caps)=>{if(active)setHttpReleaseCaps(caps);})
      .catch(()=>undefined);
    return()=>{active=false;};
  },[]);
  const connectVercelRelease = async () => {
    setReleaseProviderBusy(true);
    setReleaseProviderError("");
    try {
      const [caps, health] = await Promise.all([getServerVercelReleaseCapabilities(), checkServerVercelReleaseHealth()]);
      if (!caps.available || !caps.projectId) throw new Error("当前部署没有可识别的 Vercel Project");
      runtime.setReleaseTarget({
        provider: "vercel",
        mode: caps.mode,
        status: "connected",
        label: `Vercel · ${caps.projectName ?? caps.projectId}`,
        projectId: caps.projectId,
        projectName: caps.projectName,
        productionUrl: caps.productionUrl,
        healthPath: "/",
      });
      setReleaseCaps(caps);
      setReleaseHealth(health);
      if (caps.writeEnabled) {
        const deployments = await listServerVercelDeployments();
        if (deployments.available) setReleaseDeployments(deployments.deployments);
      }
    } catch (error) {
      setReleaseProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setReleaseProviderBusy(false);
    }
  };
  const connectHttpRelease=async()=>{
    setReleaseProviderBusy(true);
    setReleaseProviderError("");
    try{
      const caps=await getTargetProxyCapabilities();
      setHttpReleaseCaps(caps);
      if(!caps.releaseConfigured||!caps.observeConfigured){
        throw new Error("HTTP Release 需要同时配置 EVOLUTION_TARGET_RELEASE_URL 与 EVOLUTION_TARGET_OBSERVE_URL");
      }
      runtime.setReleaseTarget({
        provider:"http",
        mode:"preview-promote",
        status:"connected",
        label:"HTTP Release Proxy",
        connectionId:"http-release-proxy",
        healthPath:"/",
      });
    }catch(error){
      setReleaseProviderError(error instanceof Error?error.message:String(error));
    }finally{
      setReleaseProviderBusy(false);
    }
  };
  const reconcileReleaseReality = async () => {
    setReleaseProviderBusy(true);
    setReleaseProviderError("");
    try {
      await runtime.reconcileRelease();
      if(vercelRelease){
        const health = await checkServerVercelReleaseHealth();
        setReleaseHealth(health);
        if (releaseCaps?.writeEnabled) {
          const deployments = await listServerVercelDeployments();
          if (deployments.available) setReleaseDeployments(deployments.deployments);
        }
      }
    } catch (error) {
      setReleaseProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setReleaseProviderBusy(false);
    }
  };
  const releaseWriteReady = vercelRelease
    ?Boolean(releaseCaps?.writeEnabled)
    :genericHttpRelease
      ?Boolean(httpReleaseCaps?.releaseConfigured&&httpReleaseCaps.observeConfigured)
      :true;
  const readyPreviewDeployments = releaseDeployments.filter((deployment) => deployment.state === "READY" && deployment.target !== "production");
  const releaseDeploymentBound = !vercelRelease
    || p.release.status !== "idle"
    || Boolean(p.release.deploymentId && p.release.candidateId === runtime.winner?.id);
  const armRollback = () => {
    setRollbackArm(true);
    window.setTimeout(() => setRollbackArm((current) => (current ? false : current)), 4000);
  };
  const canRollback = releaseWriteReady && p.release.status !== "idle" && p.release.status !== "rolled-back";
  const releaseTargetSwitchLocked=["shadow","canary-5","canary-20","canary-50","promoted"].includes(p.release.status);
  const disconnectReleaseTarget=()=>{
    setReleaseProviderError("");
    try{
      runtime.setReleaseTarget({
        provider:"none",mode:"progressive",status:"not-configured",label:"未连接发布平台",healthPath:"/",
      });
    }catch(error){
      setReleaseProviderError(error instanceof Error?error.message:String(error));
    }
  };
  const outcomeFreshness = productionOutcomeFreshness(p);
  const outcomeTrend = productionOutcomeTrend(p);
  const releaseAudit = releaseAuditTimeline(p);
  const productionObservations = (p.release.observations ?? []).filter((item) => item.environment === "production" && item.deploymentId === p.release.deploymentId).slice(-8).reverse();
  const freshnessLabel = outcomeFreshness.status === "fresh" ? "FRESH" : outcomeFreshness.status === "stale" ? "STALE" : "UNKNOWN";
  const trendLabel = outcomeTrend.status === "stable-healthy" ? "STABLE" : outcomeTrend.status === "healthy-insufficient" ? "NEED MORE" : outcomeTrend.status === "flapping" ? "FLAPPING" : outcomeTrend.status === "degrading" ? "DEGRADING" : outcomeTrend.status.toUpperCase();
  const trendClass = outcomeTrend.status === "stable-healthy" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : outcomeTrend.status === "healthy-insufficient" ? "border-sky-200 bg-sky-50 text-sky-700" : outcomeTrend.status === "flapping" || outcomeTrend.status === "degrading" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600";
  const freshnessClass = outcomeFreshness.status === "fresh"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : outcomeFreshness.status === "stale"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
  return <div className="space-y-4">
    <SectionTitle eyebrow="第 5 步 · 安全交付" title="需要上线时，逐步放量" desc="文件成果可以直接领取；只有需要在线运行的成果，才需要从后台观察开始逐步放量，并随时保留回滚能力。" />
    {!liveRelease&&<div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900"><b>当前没有连接独立发布平台。</b> 已验收文件仍可直接领取；验证 Runner 与 Production Release 已分离，连接 E2E Runner 不会自动触发上线闭环。<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={releaseProviderBusy} onClick={()=>void connectVercelRelease()}><PlugZap className="size-3.5"/>{releaseProviderBusy?"正在检测…":"连接当前 Vercel Release"}</Button><Button size="sm" variant="secondary" disabled={releaseProviderBusy} onClick={()=>void connectHttpRelease()}><PlugZap className="size-3.5"/>连接 HTTP Release</Button></div><p className="mt-2 text-[11px] text-sky-700">HTTP Release 只在服务端 Release + Observe 都 READY 时可连接；默认使用保守的 Preview/Shadow → Promote，不宣称未验证的百分比 Canary。</p>{releaseProviderError&&<div className="mt-2 text-xs text-rose-700">{releaseProviderError}</div>}</div>}
    {vercelRelease&&<div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm leading-6 text-indigo-900"><div className="flex flex-wrap items-center gap-2"><b>{p.releaseTarget?.label}</b><Badge className={releaseHealth?.ready?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-amber-200 bg-amber-50 text-amber-700"}>{releaseHealth?.ready?"Production Health READY":"Health 未确认"}</Badge><Badge className={releaseWriteReady?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-amber-200 bg-amber-50 text-amber-700"}>{releaseWriteReady?"Release Write READY":"Read-only"}</Badge></div><p className="mt-2 text-xs text-indigo-700">{previewPromote?"当前 Vercel 方案使用 Preview → Production Promote；不会伪造 5% / 20% / 50% 流量。":"当前发布平台使用渐进式发布。"}{!releaseWriteReady?" Promote / Rollback 需要单独配置 VERCEL_RELEASE_TOKEN；当前仍可做真实 Production 健康观测。":""}</p>{releaseWriteReady&&p.release.status==="idle"&&<div className="mt-3 rounded-xl border border-indigo-200 bg-white/80 p-3"><div className="text-xs font-semibold">绑定当前 Winner 的 Preview Deployment</div><select className="mt-2 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs" value={p.release.deploymentId??""} onChange={(event)=>{try{if(event.target.value)runtime.bindReleaseDeployment(event.target.value);setReleaseProviderError("");}catch(error){setReleaseProviderError(error instanceof Error?error.message:String(error));}}}><option value="">请选择 READY Preview</option>{readyPreviewDeployments.map((deployment)=><option key={deployment.id} value={deployment.id}>{deployment.id} · {new URL(deployment.url).hostname}</option>)}</select><p className="mt-2 text-[11px] text-indigo-600">{p.release.deploymentId&&p.release.candidateId===runtime.winner?.id?"已绑定当前 Release Candidate；Preview Gate 只会验证这个 Deployment。":p.release.sourceGitCommitSha?"系统会优先按 exact Git SHA 自动发现唯一 Preview；这里保留手动选择作为故障恢复入口。":readyPreviewDeployments.length?"请选择与当前 Candidate 对应的 Preview，系统不会按时间或分支名猜测。":"当前没有 READY Preview Deployment。"}</p></div>}</div>}
    {genericHttpRelease&&<div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 text-sm leading-6 text-sky-900"><div className="flex flex-wrap items-center gap-2"><b>{p.releaseTarget?.label}</b><Badge className={httpReleaseCaps?.releaseConfigured?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-amber-200 bg-amber-50 text-amber-700"}>{httpReleaseCaps?.releaseConfigured?"Release READY":"Release BLOCKED"}</Badge><Badge className={httpReleaseCaps?.observeConfigured?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-amber-200 bg-amber-50 text-amber-700"}>{httpReleaseCaps?.observeConfigured?"Observe READY":"Observe BLOCKED"}</Badge></div><p className="mt-2 text-xs text-sky-700">HTTP Release 与 Target Runner 独立绑定。当前只使用 Shadow/Preview → Promote；服务端凭证与真实外部 URL 不下发浏览器。</p></div>}
    {liveRelease&&<div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 text-xs leading-5 text-slate-600 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-slate-800">发布平台绑定 · {p.releaseTarget?.label}</div><div className="mt-1">Provider {p.releaseTarget?.provider} · Mode {p.releaseTarget?.mode}{releaseTargetSwitchLocked?` · 当前 ${p.release.status} 仍有真实线上状态，禁止静默切换`:" · 可安全断开后切换其他发布平台"}</div>{releaseTargetSwitchLocked&&<div className="mt-1 text-amber-700">请先完成 Rollback / 收口；系统不会把旧 Deployment、健康观测或审批证据带到新平台。</div>}</div><Button size="sm" variant="secondary" disabled={releaseTargetSwitchLocked||runtime.status.busy} onClick={disconnectReleaseTarget}><Unplug className="size-3.5"/>断开 Release Target</Button></div>}
    {vercelRelease&&p.release.sourceGitCommitSha&&!p.release.deploymentId&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900"><div><b>Exact Git → Preview 自动绑定</b><div className="mt-1 break-all text-[11px] text-sky-700">Git commit {p.release.sourceGitCommitSha} · 只接受当前 Vercel Project 中唯一的同 SHA 非 Production Deployment。</div></div><Button size="sm" variant="secondary" disabled={releaseProviderBusy||!releaseWriteReady} onClick={()=>void reconcileReleaseReality()}><RefreshCcw className="size-3.5"/>按 Git SHA 自动绑定</Button></div>}
    {liveRelease&&p.release.deploymentId&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-900"><div><div className="flex flex-wrap items-center gap-2"><Badge className={freshnessClass}>Outcome {freshnessLabel}</Badge><Badge className={trendClass}>{trendLabel}</Badge><span>{p.release.observedAt?"最近 Mission 观测："+new Date(p.release.observedAt).toLocaleString("zh-CN"):"尚未写入 Mission 级线上观测"}</span></div><div className="mt-1 text-[11px] text-indigo-600">{outcomeFreshness.reason} · {outcomeTrend.reason}</div></div><Button size="sm" variant="secondary" disabled={releaseProviderBusy||!releaseWriteReady} onClick={()=>void reconcileReleaseReality()}><RefreshCcw className="size-3.5"/>核对线上状态</Button></div>}
    {liveRelease&&p.release.recovery&&<div className={cn("rounded-2xl border p-4 text-xs leading-5",p.release.recovery.status==="manual-check"?"border-rose-200 bg-rose-50 text-rose-900":"border-amber-200 bg-amber-50 text-amber-900")}><div className="flex flex-wrap items-center gap-2"><b>Release Recovery</b><Badge>{p.release.recovery.status}</Badge>{p.release.recovery.action&&<Badge>{p.release.recovery.action}</Badge>}</div><p className="mt-2">{p.release.recovery.reason}</p><div className="mt-2 text-[11px] opacity-70">开始：{new Date(p.release.recovery.at).toLocaleString("zh-CN")}{p.release.recovery.lastObservedAt?" · 最近核对 "+new Date(p.release.recovery.lastObservedAt).toLocaleString("zh-CN"):""}</div></div>}
    {liveRelease&&productionObservations.length>0&&<details className="rounded-2xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Production Outcome Timeline · 最近 {productionObservations.length} 次</summary><div className="mt-3 space-y-2">{productionObservations.map((item)=><div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600"><Badge className={item.healthy?"border-emerald-200 bg-emerald-50 text-emerald-700":"border-rose-200 bg-rose-50 text-rose-700"}>{item.observationStatus??"unknown"}</Badge><span>{new Date(item.at).toLocaleString("zh-CN")}</span><span>{item.source}</span>{item.latencyMs!==undefined&&<span>{item.latencyMs}ms</span>}{item.sampleSize!==undefined&&<span>sample {item.sampleSize}</span>}<span className="break-all">{item.deploymentId??"deployment unknown"}</span></div>)}</div></details>}
    {liveRelease&&releaseAudit.length>0&&<details className="rounded-2xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Release Audit Console · {releaseAudit.length} 条</summary><div className="mt-3 space-y-2">{releaseAudit.slice(0,24).map((item,i)=><div key={`${item.at}-${item.action}-${i}`} className="rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-600"><div className="flex flex-wrap items-center gap-2"><Badge>{item.action}</Badge><span>{new Date(item.at).toLocaleString("zh-CN")}</span>{item.evidenceMode&&<Badge>{item.evidenceMode}</Badge>}{item.observationStatus&&<Badge>{item.observationStatus}</Badge>}</div><div className="mt-1 break-all">{item.candidateId?`candidate ${item.candidateId}`:''}{item.deploymentId?` · deployment ${item.deploymentId}`:''}{item.stableDeploymentId?` · stable ${item.stableDeploymentId}`:''}</div>{item.artifactHashes?.length?<div className="break-all">artifact hashes：{item.artifactHashes.map((hash)=>`${hash.sourceArtifactId}=${hash.contentHash.slice(0,12)}…`).join(" · ")}</div>:null}<div>{item.note}</div></div>)}</div></details>}
    {(releasedVersion || challenging) && <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-xs text-emerald-900">
      <Rocket className="size-4 shrink-0 text-emerald-600" />
      {p.release.status === "promoted" && releasedVersion && <><span className="font-bold">在产 {releasedVersion.label} · {releasedVersion.candidateTitle ?? "历史候选"}</span><span className="text-emerald-700">发布于 {new Date(releasedVersion.releasedAt!).toLocaleString("zh-CN")}</span><span className="ml-auto text-emerald-700">当前在产</span></>}
      {p.release.status === "rolled-back" && <><span className="font-bold">{releasedVersion?.label ?? "上一版本"} 已回滚</span><span className="ml-auto text-emerald-700">不再在产{currentVersion ? ` · 待新候选 ${currentVersion.label} 接管` : ""}</span></>}
      {challenging && <><span className="font-bold">新版本 {currentVersion?.label ?? "—"} · {challenging}</span><span className="text-emerald-700">{releasedVersion && releasedLive ? `当前线上版本 ${releasedVersion.label} 继续服务，在确认全量上线前不会被替换` : "当前没有被替换的线上版本，全量上线后新版本才会正式接管"}</span></>}
      {canRollback && (rollbackArm
        ? <Button size="sm" className="border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={() => { setRollbackArm(false); void runtime.releaseAction("rollback"); }}>确认{p.release.status === "promoted" ? "回滚该版本" : "回滚新候选"}？</Button>
        : <Button size="sm" variant="ghost" onClick={armRollback}><RefreshCcw className="size-3.5" />{p.release.status === "promoted" ? "回滚该版本" : "回滚新候选"}</Button>)}
    </div>}
    {liveRelease&&<div className={cn("grid gap-2",previewPromote?"md:grid-cols-2":"md:grid-cols-5")}>{steps.map((step, i) => { const done = index >= i; const active = index === i; return <div key={step.action} className={cn("rounded-2xl border p-4", done ? "border-emerald-200 bg-emerald-50" : "bg-slate-50", active && "ring-2 ring-indigo-100")}><div className="text-xs font-semibold">{step.label}</div><div className="mt-2 text-[11px] text-slate-400">{step.traffic}</div><div className="mt-3 text-xs font-semibold">{done ? "已到达" : "等待"}</div></div>; })}</div>}
    {liveRelease&&p.release.evidenceMode==="live"&&<TechnicalDetails label="技术人员查看：线上指标、部署信息与观察窗口" meta={p.release.observationStatus==="observing"?"正在观察":p.release.healthy===false?"异常":"正常"}><div><div className="mb-2 text-xs font-semibold text-slate-500">{p.release.environment||"production"}{p.release.deploymentId?` · deployment ${p.release.deploymentId}`:""}{p.release.observedAt?` · ${new Date(p.release.observedAt).toLocaleString("zh-CN")}`:""}{p.release.sampleSize!==undefined?` · sample ${p.release.sampleSize}`:""}{p.release.windowMinutes!==undefined?` / ${p.release.windowMinutes}min`:""}</div>{p.release.kpis.length>0?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{p.release.kpis.map((metric) => <ScoreCard key={metric.key} label={metric.label} value={metric.value} unit={metric.unit} />)}</div>:<div className="rounded-xl border border-dashed p-4 text-xs text-slate-400">正在等待生产指标样本。</div>}</div></TechnicalDetails>}
    {liveRelease&&<Card><CardContent className="pt-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="text-sm font-semibold">当前：{index>=0?steps[index]?.label:"等待开始"}</div><div className="mt-1 text-xs text-slate-500">{previewPromote?p.release.status==="shadow"?"Preview 已通过，Production 尚未切换":p.release.status==="promoted"?"Production 已接管真实流量":"Production 仍由稳定版本承接":`新版本当前承接 ${p.release.trafficPercent}% 流量`}</div></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => runtime.releaseAction("rollback")} disabled={!releaseWriteReady || p.release.status === "idle" || p.release.status === "rolled-back" || runtime.status.busy}><RefreshCcw className="size-4" />回滚到上一版</Button>{!previewPromote&&p.release.observationStatus==="observing"&&["shadow","canary-5","canary-20","canary-50"].includes(p.release.status)&&<Button variant="secondary" onClick={()=>void reconcileReleaseReality()} disabled={runtime.status.busy||releaseProviderBusy}><RefreshCcw className="size-4"/>刷新观察结果</Button>}{p.release.status !== "promoted" && p.release.status !== "rolled-back" && <Button onClick={() => runtime.releaseAction(next.action)} disabled={!releaseWriteReady || !releaseDeploymentBound || runtime.status.busy || p.release.healthy === false || p.release.observationStatus === "observing"}><Rocket className="size-4" />{index < 0 ? previewPromote?"执行 Preview Gate":"开始后台观察" : `继续到${next.label}`}</Button>}</div></div>{historyWithRound.length > 0 && <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">技术人员查看：发布历史</summary><div className="mt-3 space-y-2">{historyWithRound.slice().reverse().map((h, i) => <div key={`${h.at}-${i}`} className="flex gap-3 text-xs"><span className="w-32 shrink-0 text-slate-400">{new Date(h.at).toLocaleString()}</span><Badge>Round {h.cycle}</Badge><span className="font-semibold">{h.action}</span><span className="text-indigo-600">{h.action === "rollback" ? "回旧版" : previewPromote&&h.action==="shadow"?"Preview":TRAFFIC_BY_ACTION[h.action] ?? "—"}</span><span className="text-slate-500">{h.note}</span></div>)}</div></details>}</CardContent></Card>}
    {p.release.healthy === false && p.release.observationStatus !== "observing" && <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 text-xs leading-5 text-rose-900/80">
      <b className="text-sm">线上表现出现异常，系统已经停止继续放量</b>
      <ul className="mt-2 space-y-1">
        <li>· 可以立即回滚到上一版本，保护线上用户</li>
        <li>· 技术人员可查看线上指标，确认具体恶化项</li>
        <li>· 回到方案页，根据失败原因生成新的改进版本</li>
      </ul>
    </div>}
    {p.release.status === "promoted" && <div className="flex justify-end"><Button onClick={() => runtime.setStage("learning")}>提炼经验与下一轮 <ArrowRight className="size-4" /></Button></div>}
  </div>;
}

function LearningPanel({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  return <div className="space-y-4">
    <SectionTitle eyebrow="第 5 步 · 继续变好" title="把这轮学到的留下来" desc="总结哪些改动有效、哪些方法不适用，再决定下一轮最值得优化什么。" action={<div className="flex flex-wrap gap-2"><Button variant="soft" onClick={() => runtime.distill()} disabled={runtime.status.busy}><Sparkles className="size-4" />总结本轮经验</Button><Button onClick={() => runtime.generateNextQueue()} disabled={runtime.status.busy || p.lessons.length === 0}><Target className="size-4" />生成下一轮建议</Button></div>} />
    <div className="grid gap-4 xl:grid-cols-2"><Card><CardHeader><CardTitle>本轮经验</CardTitle></CardHeader><CardContent className="space-y-3">{p.lessons.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">还没有总结。完成验收或上线决策后，可以让系统提炼这轮真正有效的方法。</div> : p.lessons.map((lesson) => <div key={lesson.id} className="rounded-2xl border p-4"><div className="flex flex-wrap items-center gap-2"><div className="font-semibold">{lesson.title}</div><Badge className={lesson.status === "verified-skill" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}>{lesson.status === "verified-skill" ? "已在线验证" : "本轮经验"}</Badge>{lesson.governance&&<Badge className={lesson.governance.status==="active"?"border-emerald-200 bg-emerald-50 text-emerald-700":lesson.governance.status==="revoked"?"border-rose-200 bg-rose-50 text-rose-700":"border-amber-200 bg-amber-50 text-amber-700"}>{lesson.governance.status}</Badge>}</div><p className="mt-2 text-sm text-slate-500">{lesson.summary}</p><div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>观察到的效果：</b>{lesson.effect}<br /><b>适用限制：</b>{lesson.limit}{lesson.governance&&<><br/><b>治理状态：</b>{lesson.governance.reason}<br/><span className="text-[10px] text-slate-400">Candidate {lesson.governance.candidateId??"unknown"} · Deployment {lesson.governance.deploymentId??"unknown"} · Trend {lesson.governance.outcomeTrend??"unknown"}</span></>}</div></div>)}</CardContent></Card><Card><CardHeader><CardTitle>下一轮建议</CardTitle></CardHeader><CardContent className="space-y-3">{p.nextQueue.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">系统会结合还没解决的问题和这轮经验，给出下一轮优先建议。</div> : p.nextQueue.map((item, i) => <div key={item.id} className={cn("rounded-2xl border p-4", i === 0 && "border-indigo-200 bg-indigo-50/50")}><div className="flex items-center gap-2">{i===0&&<Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">建议优先</Badge>}{item.source==="production-outcome"&&<Badge className="border-rose-200 bg-rose-50 text-rose-700">Production Outcome</Badge>}<div className="font-semibold">{item.title}</div></div><p className="mt-2 text-sm text-slate-500">{item.reason}</p><details className="mt-2"><summary className="cursor-pointer text-xs text-slate-400">技术人员查看：建议来源</summary><div className="mt-1 text-xs text-slate-500">{item.source}</div></details></div>)}</CardContent></Card></div>
    {p.nextQueue.length > 0 && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-emerald-900">这一轮已经完成</div><p className="mt-1 text-sm text-emerald-800/80">最佳版本和本轮经验已经保存。开始下一轮时，会以当前最佳版本作为新的起点。</p></div><Button variant="success" onClick={() => runtime.startNextRound(p.nextQueue[0]?.id)}>开始下一轮</Button></div></div>}
  </div>;
}

function BaselineRecovery({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const readiness = baselineReadiness(p);
  const incomplete = p.evalSuite.filter((testCase) => !(testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE")) && !p.baselineRun.runs.some((run) => run.testCaseId === testCase.id && !run.error && run.verificationStatus === "verified"));
  return <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
    <div className="font-semibold">先恢复当前版本体检</div>
    <p className="text-xs leading-5">{readiness.blockers.join("；")}。无需重新理解材料。补跑保留已验证作答，并对缺证题逐题核查完整文件；原版自身比较题延后到候选实验。材料或试题变化时重新体检。</p>
    <div aria-live="polite" className="text-xs leading-5">{runtime.status.busy ? runtime.status.label : runtime.status.error ? <span className="text-red-600">补跑未完成：{runtime.status.error}</span> : runtime.status.message}</div>
    <details><summary className="cursor-pointer text-xs font-semibold">技术人员查看：未完成检查与处理原因（{incomplete.length}）</summary><div className="mt-2 space-y-2">{incomplete.map((testCase) => { const run = p.baselineRun.runs.find((item) => item.testCaseId === testCase.id); return <div key={testCase.id} className="rounded-lg bg-white/70 p-3 text-xs"><b>{testCase.title}</b><div className="mt-1 break-words">{run?.error || run?.output.slice(0, 600) || "尚未返回结果"}</div><div className="mt-1 text-amber-800">{["external-runner", "visual-review", "manual"].includes(testCase.executionMode) ? "需要对应运行、视觉或人工证据；补跑不会用 AI 模拟替代。" : "检查当前模型连接与响应；已执行但缺少判定的内容会重新评审。"}</div></div>; })}</div></details>
    <div className="flex flex-wrap gap-2"><BaselineRetryAction busy={runtime.status.busy} label={runtime.status.label} retry={() => runtime.executeBaseline(true)} /></div>
  </div>;
}

export function StagePanel({ runtime,serverStartBlocked=false }: { runtime: ProjectRuntime;serverStartBlocked?:boolean }) {
  const step = stepForStage(runtime.project, runtime.stage);
  const state = workflowStepState(runtime.project, step.id);
  if (state.status === "locked") {
    if (!baselineReadiness(runtime.project).ready && runtime.project.gates.some((gate) => gate.id === "target-ready" && gate.status === "approved")) return <BaselineRecovery runtime={runtime} />;
    const next = compileUserEvolutionSteps(runtime.project).find(item => ["ready", "attention"].includes(workflowStepState(runtime.project, item.id).status));
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold">先完成前置步骤</h2><p className="mt-2 text-sm leading-6">{state.detail}</p><Button className="mt-3" disabled={runtime.status.busy} onClick={() => runtime.setStage(next ? preferredInternalStage(runtime.project, next.id) : "target")}>返回{next?.label ?? "材料与目标"}</Button></div>;
  }
  switch (runtime.stage) {
    case "target": return <TargetPanel runtime={runtime} serverStartBlocked={serverStartBlocked}/>;
    case "baseline": return <BaselinePanel runtime={runtime} />;
    case "problem": return <ProblemPanel runtime={runtime} />;
    case "diagnosis": return <DiagnosisPanel runtime={runtime} />;
    case "plan": return <PlanPanel runtime={runtime} />;
    case "experiment": return <ExperimentPanel runtime={runtime} />;
    case "validation": return <ValidationPanel runtime={runtime} />;
    case "release": return <div className="space-y-4"><Suspense fallback={<div className="rounded-2xl border border-dashed p-6 text-sm text-slate-400">正在加载交付成果…</div>}><ProjectOutputsPanel runtime={runtime}/></Suspense><details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">可选：线上发布（技术 / 运维人员）</summary><div className="mt-4"><ReleasePanel runtime={runtime}/></div></details><details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">可选：复盘与下一轮进化</summary><div className="mt-4"><LearningPanel runtime={runtime}/></div></details></div>;
    case "learning": return <LearningPanel runtime={runtime} />;
  }
}
