import {ProjectSaveStatus} from "./project-save-status";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, Bot, CircleDot, Clock3, Gauge, PackageCheck, Paperclip, Rocket, Share2, TriangleAlert, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EvolveProject, Stage } from "../schemas";
import type { AiOperation } from "../ai/schemas";
import { StageProgress } from "./stage-progress";
import { useProjectRuntime } from "../runtime/use-project-runtime";
import { OPERATION_META, resolveProjectOperationConnections } from "../ai/providers/registry";
import { ProjectAiProfileSelector } from "./project-ai-profile-selector";
import { AdaptiveStageGuide } from "./adaptive-stage-guide";
import { displayProgress } from "../runtime/progress-estimate";
import { deriveNextWorkflowAction } from "../runtime/workflow-engine";
import { AutonomousEvolutionPanel } from "./autonomous-evolution-panel";
import { autonomousAttention, autonomousEvolutionState } from "../runtime/autonomous-evolution";
import { deriveAutonomousDecision, LOCAL_REVIEW_CONTRACT_VERSION } from "../runtime/autonomous-orchestrator";
import { projectHasOnlineReleaseTarget } from "@evolution/core";

// 项目页有多个独立工作区。延后加载未打开的区域，避免材料解析、成果打包和实验控制台
// 影响用户打开项目并确认当前进化步骤的速度。
const ParsingQualityPanel = lazy(() => import("./parsing-quality-panel").then((module) => ({ default: module.ParsingQualityPanel })));
const StagePanel = lazy(() => import("./stage-panels").then((module) => ({ default: module.StagePanel })));
const StudioAssistant = lazy(() => import("./studio-assistant").then((module) => ({ default: module.StudioAssistant })));
const ProjectSourceInput = lazy(() => import("./project-source-input").then((module) => ({ default: module.ProjectSourceInput })));
const EvolutionRunConsole = lazy(() => import("./evolution-run-console").then((module) => ({ default: module.EvolutionRunConsole })));
const EvolutionCampaignCenter = lazy(() => import("./evolution-campaign-center").then((module) => ({ default: module.EvolutionCampaignCenter })));
const ProjectOutputsPanel = lazy(() => import("./project-outputs-panel").then((module) => ({ default: module.ProjectOutputsPanel })));
const AttentionRequestPanel = lazy(() => import("./attention-request-panel").then((module) => ({ default: module.AttentionRequestPanel })));

const ReviewedHoldoutPanel = lazy(() => import("./reviewed-holdout-panel").then(module => ({default:module.ReviewedHoldoutPanel})));

function WorkspaceLoading({ label }: { label: string }) {
  return <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed bg-white p-6 text-sm text-slate-400" role="status">正在加载{label}…</div>;
}

const order: Stage[] = ["target", "baseline", "problem", "diagnosis", "plan", "experiment", "validation", "release", "learning"];
const operationsForStage: Record<Stage, AiOperation[]> = {
  target: ["target", "rubric", "eval-suite"],
  baseline: ["execute-artifact", "evaluate"],
  problem: ["problem-analysis", "gap-cluster"],
  diagnosis: ["diagnose"],
  plan: ["plan"],
  experiment: ["build-candidate", "execute-artifact", "execute-artifact-batch", "evaluate-population"],
  validation: ["evaluate", "artifact-acceptance", "release-review"],
  release: ["materialize", "repair-artifact", "release-review"],
  learning: ["distill", "next-queue"],
};
const stageModelLabels: Record<Stage, string> = {
  target: "目标与验收", baseline: "原版基线", problem: "问题发现", diagnosis: "根因诊断",
  plan: "生成进化方案", experiment: "Candidate 实验", validation: "独立验证",
  release: "交付成果", learning: "经验沉淀",
};

/** 工作台视图：一次只聚焦一个区域，避免五大板块纵向堆叠。 */
type StudioView = "flow" | "source" | "runtime" | "campaign" | "outputs";

/** 按项目记忆视图选择的本地存储键前缀：不同项目各自保持上次的视图习惯。 */
const VIEW_STORAGE_PREFIX = "evolve.studio.view:";
function loadStudioView(projectId: string): StudioView | null {
  try {
    const raw = window.localStorage.getItem(VIEW_STORAGE_PREFIX + projectId);
    return raw === "flow" || raw === "source" || raw === "runtime" || raw === "campaign" || raw === "outputs" ? raw : null;
  } catch {
    return null;
  }
}

export function ProjectStudio({ project: initialProject }: { project: EvolveProject }) {
  const [search] = useSearchParams();
  const runtime = useProjectRuntime(initialProject);
  const visibleProgress = runtime.status.busy ? displayProgress(runtime.status) : undefined;
  // 已完成根因诊断但尚未生成 Candidate 时，用户接下来要配置的是 plan 模型，而不是
  // 已结束的 diagnose 模型。运行中则永远以运行时上报的真实 operation 为唯一依据。
  const nextAction = deriveNextWorkflowAction(runtime.project);
  const modelOperation = runtime.status.busy ? runtime.status.operation : nextAction.operation;
  const modelOperations = modelOperation ? [modelOperation] : operationsForStage[runtime.stage];
  const modelScopeLabel = modelOperation
    ? `${runtime.status.busy ? "正在执行" : "下一步"}：${OPERATION_META[modelOperation].label}`
    : `当前阶段：${stageModelLabels[runtime.stage]}`;
  const [copilotOpen, setCopilotOpen] = useState(false);
  const requested = search.get("stage") as Stage | null;
  const autostart = search.get("autostart") === "1";
  const autostartTriggeredRef = useRef(false);
  const staleJudgeRecoveryTriggeredRef = useRef(false);
  const offlineClosureRecoveryTriggeredRef = useRef(false);

  /** 默认视图：带链接参数的跳转优先；否则恢复该项目记忆的视图；无记忆时目标阶段先补材料，其余阶段进流程工作台。 */
  const [view, setView] = useState<StudioView>(() => {
    if (requested && order.includes(requested)) return "flow";
    return loadStudioView(initialProject.id) ?? (initialProject.sourceArtifacts.length ? "flow" : "source");
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_PREFIX + initialProject.id, view);
    } catch {
      // 本地存储不可用时静默降级：视图选择仅本次会话有效
    }
  }, [view, initialProject.id]);

  /** 链接参数变化时在渲染期同步视图（避免 effect 内 setState 的级联渲染）。 */
  const [syncedRequested, setSyncedRequested] = useState(requested);
  if (syncedRequested !== requested) {
    setSyncedRequested(requested);
    if (requested && order.includes(requested)) setView("flow");
  }

  useEffect(() => {
    if (requested && order.includes(requested)) runtime.setStage(requested);
  // requested is the only route-driven input; runtime.setStage is stable enough for this UI use.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // 深度理解自动后台跑：材料接入后先完整读一遍输入，不占用用户任何操作；
  // 已有理解结论（含失败）时不自动重跑，交给界面上的「重新理解」按钮。
  const hasMaterials = runtime.project.sourceArtifacts.length > 0;
  const hasUnderstanding = Boolean(runtime.project.inputUnderstanding);
  useEffect(() => {
    if (autostart || !hasMaterials || hasUnderstanding || runtime.status.busy) return;
    runtime.deepenUnderstanding({ background: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, hasMaterials, hasUnderstanding]);

  const project = runtime.project;
  const autonomyState = autonomousEvolutionState(project, runtime.status.busy);
  const autonomyAttention = autonomousAttention(project);
  // Runtime contract upgrades should heal old local-Judge fuse states without asking the user to
  // press another resume button. Current-version fuse states remain manual to prevent infinite loops.
  const staleJudgeFuse = project.campaign.status === "paused"
    && /本地评审自动重试已耗尽/.test(project.campaign.stopReason ?? "")
    && !(project.campaign.stopReason ?? "").includes(`[${LOCAL_REVIEW_CONTRACT_VERSION}]`);
  useEffect(() => {
    if (!staleJudgeFuse || runtime.status.busy || staleJudgeRecoveryTriggeredRef.current || autonomyAttention) return;
    staleJudgeRecoveryTriggeredRef.current = true;
    setView("flow");
    void runtime.runAutoPilot();
    // One migration resume per mounted project is enough; a new-version failure gets a versioned fuse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleJudgeFuse, runtime.status.busy, autonomyAttention?.request?.id]);
  // Projects created before the offline-closure split may already have an accepted artifact but no
  // Lesson / Next Queue. Resume those machine-owned tail steps once on page load; no user click needed.
  const tailDecision = deriveAutonomousDecision(project);
  const offlineClosurePending = !projectHasOnlineReleaseTarget(project) && (tailDecision.action === "distill" || tailDecision.action === "next-queue");
  useEffect(() => {
    if (!offlineClosurePending || runtime.status.busy || autonomyAttention || offlineClosureRecoveryTriggeredRef.current) return;
    offlineClosureRecoveryTriggeredRef.current = true;
    setView("flow");
    void runtime.runAutoPilot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineClosurePending, runtime.status.busy, autonomyAttention?.request?.id]);
  const openAttentionPanel = () => {
    setView("flow");
    window.setTimeout(() => {
      const panel = document.getElementById("evolve-attention-request");
      if (!panel) return;
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
      panel.focus({ preventScroll: true });
    }, 0);
  };
  useEffect(() => {
    if (!autostart || autostartTriggeredRef.current) return;
    const current = runtime.project;
    const alreadyStarted = current.campaign.status !== "idle" || current.campaign.currentRound > 0 || current.outputArtifacts.some((artifact) => artifact.accepted);
    if (alreadyStarted || runtime.status.busy) return;
    const timer = window.setTimeout(() => {
      if (autostartTriggeredRef.current) return;
      autostartTriggeredRef.current = true;
      setView("flow");
      void runtime.runAutoPilot();
    }, 0);
    return () => window.clearTimeout(timer);
    // autostart is a one-shot handoff from project creation; later resume is governed by Campaign state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, runtime.project.id, runtime.status.busy]);
  const generator = resolveProjectOperationConnections("plan", project.aiProfile)[0];
  const evaluator = resolveProjectOperationConnections("evaluate", project.aiProfile)[0];
  const copilot = resolveProjectOperationConnections("copilot", project.aiProfile)[0];

  const tabs: Array<{ id: StudioView; label: string; icon: React.ReactNode; count?: number; hint: string }> = [
    { id: "flow", label: "2 · 自动进化", icon: <Workflow className="size-3.5" />, hint: "系统自主理解、改进、验证和复验；只有遇到人工例外才会打断你" },
    { id: "source", label: "1 · 输入任务", icon: <Paperclip className="size-3.5" />, count: project.sourceArtifacts.length, hint: "输入要进化的内容、参考材料和进化要求" },
    { id: "runtime", label: "技术运行记录", icon: <Activity className="size-3.5" />, hint: "给技术人员查看内部节点、Gate、Trace 与执行轨迹" },
    { id: "campaign", label: "高级设置", icon: <Rocket className="size-3.5" />, hint: "通常无需调整：搜索策略、预算、定时和安全停止边界" },
    { id: "outputs", label: "3 · 验收成果", icon: <PackageCheck className="size-3.5" />, count: project.outputArtifacts.filter((artifact)=>artifact.accepted).length, hint: "自动进化完成后，在这里查看、下载或恢复最终成果" },
  ];
  tabs.sort((a,b)=>["source","flow","outputs","runtime","campaign"].indexOf(a.id)-["source","flow","outputs","runtime","campaign"].indexOf(b.id));

  return (
    <div className="space-y-6"><ProjectSaveStatus/>
      <section className="rounded-2xl border bg-white p-4 soft-shadow">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{project.objectType}</Badge>
              <Badge>{project.department}</Badge>
              <span className="flex items-center gap-1 text-xs text-slate-600"><CircleDot className="size-3" />{autonomyState === "completed" ? "进化完成" : autonomyState === "attention" ? "需要你处理" : autonomyState === "running" || autonomyState === "preparing" ? "正在自主进化" : project.campaign.status === "paused" ? "已暂停" : "等待启动"}</span>
              <span className="flex items-center gap-1 text-xs text-slate-400"><Activity className="size-3" />Target · {project.targetConnection.label}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{project.version}</span>
            </div>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500 line-clamp-2">{project.goal}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(window.location.href)}><Share2 className="size-3.5" />复制链接</Button>
          </div>
        </div>
        <details className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-slate-600 marker:content-none">
            <span className="font-semibold">AI 模型配置 <span className="ml-1 font-normal text-slate-400">· {modelScopeLabel}</span></span>
            <span className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-md bg-white px-2 py-0.5 text-slate-600">生成 {generator?.model ?? "auto"}</span>
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700">评审 {evaluator?.model ?? "auto"}</span>
              <span className="rounded-md bg-sky-50 px-2 py-0.5 text-sky-700">助手 {copilot?.model ?? "auto"}</span>
            </span>
          </summary>
          <div className="border-t border-slate-200 bg-white px-3 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Badge className="border-slate-200 bg-white text-slate-600">生成 · {generator?.connection.label ?? "Demo"}/{generator?.model ?? "auto"}</Badge>
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">独立评审 · {evaluator?.connection.label ?? "Demo"}/{evaluator?.model ?? "auto"}</Badge>
              <Badge className="border-sky-200 bg-sky-50 text-sky-700">Copilot · {copilot?.connection.label ?? "Demo"}/{copilot?.model ?? "auto"}</Badge>
            </div>
            <fieldset disabled={runtime.status.busy}><ProjectAiProfileSelector value={project.aiProfile} operations={modelOperations} scopeLabel={modelScopeLabel} onChange={runtime.updateAiProfile} compact /></fieldset>
          </div>
        </details>
        <details className="mt-2 border-t border-slate-100 pt-2"><summary className="cursor-pointer text-[11px] font-medium text-slate-400">技术人员查看：内部进化节点</summary><div className="mt-2"><StageProgress busy={runtime.status.busy} active={runtime.stage} onChange={(stage)=>{runtime.setStage(stage);setView("flow");}} project={project} /></div></details>
      </section>
      {project.id === "demo" && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">示例项目：预置分数与问题用于演示流程，不代表你的材料已经完成真实验证。</p>}

      {runtime.status.busy && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50 p-4 text-indigo-900 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white"><Bot className="size-4 animate-pulse" /></div><div><div className="text-sm font-bold">{runtime.status.phase ?? runtime.status.label ?? "正在运行"}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-indigo-600"><span>{visibleProgress?.caption ?? runtime.status.detail ?? "AI / Runner 正在执行"}</span>{visibleProgress?.estimated&&<span className="rounded-full border border-indigo-200 bg-white/80 px-2 py-0.5 text-[10px] font-medium">预计进度</span>}</div></div></div><div className="flex flex-wrap items-center gap-2 text-[10px]"><span className="rounded-lg border border-indigo-100 bg-white px-2 py-1"><Clock3 className="mr-1 inline size-3"/>已用 {runtime.status.elapsedSeconds ?? 0}s</span>{visibleProgress?.etaSeconds !== undefined&&<span className="rounded-lg border border-indigo-100 bg-white px-2 py-1">预计剩余约 {visibleProgress.etaSeconds}s</span>}{runtime.status.model&&<span className="rounded-lg border border-indigo-100 bg-white px-2 py-1">{runtime.status.provider} · {runtime.status.model}</span>}<span className="min-w-14 rounded-lg bg-indigo-600 px-2.5 py-1 text-center text-xs font-bold text-white">{visibleProgress?.percent ?? 0}%</span></div></div>
          {visibleProgress&&<div className="mt-3"><div className="h-2.5 overflow-hidden rounded-full bg-white" role="progressbar" aria-label={`${runtime.status.phase ?? runtime.status.label ?? "运行"}${visibleProgress.estimated?"预计":""}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={visibleProgress.percent}><div className={`h-full rounded-full bg-gradient-to-r from-indigo-600 to-sky-500 transition-[width] duration-700 ${visibleProgress.estimated?"opacity-80":""}`} style={{width:`${visibleProgress.percent}%`}}/></div><div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[10px] text-indigo-500"><span><Gauge className="mr-1 inline size-3"/>状态已保存；关闭浏览器会中断当前执行</span><span>{runtime.status.label}{visibleProgress.estimated?" · 完成后自动变为 100%":""}</span></div></div>}
        </div>
      )}
      {runtime.status.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div role="alert" className="min-w-0"><b>本次操作未完成</b><div className="mt-0.5 text-xs">{runtime.status.error}</div>{/\b429\b|额度或请求频率受限|余额不足|预扣费|rate.?limit/i.test(runtime.status.error) && <Link to="/settings" className="mt-2 inline-flex items-center rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100">管理 AI 模型与连接</Link>}</div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        {tabs.filter(tab => !["runtime", "campaign"].includes(tab.id)).map((tab) => (
          <button
            key={tab.id}
            type="button"
            title={tab.hint}
            aria-pressed={view===tab.id}
            onClick={() => setView(tab.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-4 py-2.5 text-xs font-semibold transition ${view === tab.id ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50"}`}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${view === tab.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>{tab.count}</span>}
          </button>
        ))}
        <div className="ml-auto flex gap-2">{tabs.filter(tab => ["runtime", "campaign"].includes(tab.id)).map(tab => <button key={tab.id} type="button" aria-pressed={view === tab.id} onClick={() => setView(tab.id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${view === tab.id ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-white"}`}>{tab.icon}{tab.label}</button>)}</div>
      </div>

      {view!=="flow"&&<div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 text-sm leading-6 text-slate-700"><b>{tabs.find(t=>t.id===view)?.label}</b><p>{view==="source"?"输入内容和进化指令后会直接启动自主进化；无需再逐步确认流程。":view==="outputs"?"这里只放已经通过验收的成果、版本与回滚记录。":view==="runtime"?"技术诊断入口：查看内部执行链路、Trace 和阻塞原因。":"高级控制入口；默认设置已经适合自主进化，一般无需调整。"}</p></div>}
      {view === "source" && <Suspense fallback={<WorkspaceLoading label="材料解析" />}><div className="space-y-4">{project.sourceArtifacts.length>0?<><ParsingQualityPanel project={project} onReparse={runtime.refreshParsing} busy={runtime.status.busy} onSetTargetConnection={runtime.setTargetConnection}/><details className="rounded-2xl border bg-white p-4"><summary className="cursor-pointer font-semibold">补充材料、修正类型或修改原始要求</summary><div className="mt-3"><ProjectSourceInput runtime={runtime} onAutoRunStart={()=>setView("flow")}/></div></details></>:<ProjectSourceInput runtime={runtime} onAutoRunStart={()=>setView("flow")}/>}</div></Suspense>}
      {view === "runtime" && <Suspense fallback={<WorkspaceLoading label="运行记录" />}><EvolutionRunConsole runtime={runtime} /></Suspense>}
      {view === "campaign" && <Suspense fallback={<WorkspaceLoading label="自动续跑设置" />}><EvolutionCampaignCenter runtime={runtime} onOpenAttention={openAttentionPanel} /></Suspense>}
      {view === "outputs" && <Suspense fallback={<WorkspaceLoading label="成果与版本" />}><ProjectOutputsPanel runtime={runtime} /></Suspense>}
      {view === "flow" && (
        <div className="space-y-4">
          <Suspense fallback={null}><ReviewedHoldoutPanel key={runtime.project.id} project={runtime.project} busy={runtime.status.busy}/></Suspense>
          <AutonomousEvolutionPanel runtime={runtime} onOpenSource={()=>setView("source")} onOpenOutputs={()=>setView("outputs")} onOpenAdvanced={()=>setView("campaign")} onOpenRuntime={()=>setView("runtime")} />
          <div className="flex justify-end"><Button variant="secondary" size="sm" onClick={()=>setCopilotOpen((open)=>!open)}><Bot className="size-4" />{copilotOpen?"收起 AI 助手":"打开 AI 助手"}</Button></div>
          <div className={`grid gap-6 ${copilotOpen?"xl:grid-cols-[minmax(0,1fr)_340px]":"grid-cols-1"}`}>
            <div className="min-w-0">
              {autonomyAttention ? <Suspense fallback={<WorkspaceLoading label="需要你处理的问题" />}><AttentionRequestPanel runtime={runtime} attention={autonomyAttention} onOpenSource={()=>setView("source")} onOpenAdvanced={()=>setView("campaign")} onOpenRuntime={()=>setView("runtime")}/></Suspense> : <details className="rounded-2xl border bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-600">技术人员查看：内部进化过程</summary><div className="border-t p-5"><AdaptiveStageGuide project={project} stage={runtime.stage}/><Suspense fallback={<WorkspaceLoading label="内部进化过程" />}><StagePanel runtime={runtime} /></Suspense></div></details>}
            </div>
            {copilotOpen&&<Suspense fallback={<WorkspaceLoading label="AI 助手" />}><StudioAssistant runtime={runtime} /></Suspense>}
          </div>
        </div>
      )}
    </div>
  );
}
