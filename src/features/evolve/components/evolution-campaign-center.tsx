import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Archive, Award, CalendarClock, CirclePause, Download, FastForward, GitBranch, Play, RotateCcw, Sparkles, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHECKPOINT_PHASE_LABELS, getRunActivity, type ProjectRuntime } from "../runtime/use-project-runtime";
import { buildSearchMemory } from "../runtime/search-memory";
import { autonomousAttention } from "../runtime/autonomous-evolution";
import { campaignMetricTargetStatus, campaignScheduleIssue, estimateNextRoundCost } from "../runtime/evolution-search";
import { projectHasOnlineReleaseTarget } from "@evolution/core";

const selectClass = "h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100";
const inputClass = selectClass;

const CAMPAIGN_STEPS: Array<{ stage: string; label: string }> = [
  { stage: "baseline", label: "Baseline 体检" },
  { stage: "problem", label: "问题分析" },
  { stage: "diagnosis", label: "根因诊断" },
  { stage: "plan", label: "方案生成" },
  { stage: "experiment", label: "沙箱实验" },
  { stage: "validation", label: "盲测验证" },
];

function formatCountdown(ms: number) {
  if (ms <= 0) return "即将开始";
  const total = Math.floor(ms / 1000);
  const hour = Math.floor(total / 3600);
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${total % 60}s`;
}

function toLocalValue(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function fromLocalValue(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

const parentStrategies = [
  { id: "champion-only", label: "Champion Only", note: "纯 exploit：每轮只从当前最好版本继续。" },
  { id: "champion-elites", label: "Champion + Elites", note: "推荐：最佳版本为主，同时保留高质量 Elite 作为父代。" },
  { id: "quality-diversity", label: "Quality Diversity", note: "按 Prompt / Workflow / Tool 等 niche 保留不同类型的高分解。" },
  { id: "open-ended", label: "Open-ended Archive", note: "允许从 Stepping Stone 分支，避免过早陷入局部最优。" },
] as const;

export function EvolutionCampaignCenter({ runtime, onOpenAttention }: { runtime: ProjectRuntime; onOpenAttention?: () => void }) {
  const project = runtime.project;
  const campaign = project.campaign;
  const champion = project.searchChampion;
  const attention = autonomousAttention(project);
  const mustHandleAttentionFirst = Boolean(attention && attention.kind !== "limit");
  const settingsLocked = runtime.status.busy || campaign.status === "running";
  const nextRoundEstimate = estimateNextRoundCost(project);
  const metricTargetStatus = campaignMetricTargetStatus(project);
  const scheduleIssue = campaign.schedule.enabled ? undefined : campaignScheduleIssue({ ...campaign.schedule, enabled: true });
  const championDeliverableReady = Boolean(champion?.candidate?.artifactSnapshots.length && champion.validation?.status === "completed" && champion.validation.recommendation === "release" && champion.artifactAcceptance?.status === "passed" && champion.artifactAcceptance.hardGatePass);
  const onlineReleaseTarget = projectHasOnlineReleaseTarget(project);
  const productionReleaseReady = onlineReleaseTarget && championDeliverableReady;
  const archiveCounts = useMemo(() => ({
    champion: project.evolutionArchive.filter((item) => item.kind === "champion").length,
    elite: project.evolutionArchive.filter((item) => item.kind === "elite").length,
    stepping: project.evolutionArchive.filter((item) => item.kind === "stepping-stone").length,
    failure: project.evolutionArchive.filter((item) => item.kind === "failure").length,
  }), [project.evolutionArchive]);
  // 搜索记忆：把 Archive 压缩成「反复无效 / 真实有效 / 反复出现的差距」画像，下一轮生成候选时会注入。
  const searchMemory = useMemo(() => buildSearchMemory(project), [project]);

  // 定时倒计时 / 当前动作已耗时都要每秒走表；既无定时也不在运行时不挂 interval。
  const ticking = Boolean(campaign.schedule.enabled && campaign.schedule.nextRunAt) || campaign.status === "running" || runtime.status.busy;
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  // 当前动作已耗时：最新一条活动日志的时间即当前阶段起点。
  const latestActivity = getRunActivity(project.id)[0];
  const liveElapsedMs = runtime.status.busy && latestActivity ? Math.max(0, nowTs - new Date(latestActivity.at).getTime()) : undefined;

  const update = (patch: Partial<typeof campaign>) => runtime.updateCampaign({ ...campaign, ...patch });
  const updateStop = (patch: Partial<typeof campaign.stopCriteria>) => runtime.updateCampaign({ ...campaign, stopCriteria: { ...campaign.stopCriteria, ...patch } });
  const updateSchedule = (patch: Partial<typeof campaign.schedule>) => runtime.updateCampaign({ ...campaign, schedule: { ...campaign.schedule, ...patch } });

  return <Card className="overflow-hidden border-indigo-100 bg-gradient-to-br from-white via-white to-violet-50/30 soft-shadow">
    <CardHeader className="border-b bg-white/80 pb-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600"><Sparkles className="size-4" />Evolution Campaign</div>
          <CardTitle className="mt-1 text-xl">自主进化高级设置</CardTitle>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">默认不需要调整。系统会自动循环“诊断 → 改进 → 对比 → 独立验收”，完整验收通过后立即结束；只有缺外部证据或触及安全边界时才需要人工介入。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Round {campaign.currentRound}/{campaign.stopCriteria.maxRounds}</Badge>
          <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{campaign.status}</Badge>
          {champion && <Badge className="border-amber-200 bg-amber-50 text-amber-700"><Trophy className="mr-1 size-3" />{champion.versionLabel} · {champion.score.toFixed(1)}</Badge>}
        </div>
      </div>
    </CardHeader>
    <CardContent className="space-y-5 pt-5">
      <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-500 p-4 text-white soft-shadow">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold"><Sparkles className="size-4" />自动驾驶 · 当前运行环境自主执行</div>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-5 text-indigo-100">点一次，系统自动完成「深度理解输入 → 验收标准 → 专属考卷 → 多轮进化搜索 → 打包最佳成果」。当前版本仍由浏览器执行：刷新/重新打开后可从已保存断点恢复，但关闭浏览器期间不会继续计算。</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                { label: "材料已接入", done: project.sourceArtifacts.length > 0 },
                { label: "理解与验收标准", done: project.inputUnderstanding?.status === "ready" && project.acceptanceRubricState.status === "ready" && project.evalSuite.length > 0 },
                { label: "后台进化", done: campaign.status === "running" || campaign.currentRound > 0 },
                { label: "成果已打包", done: project.outputArtifacts.length > 0 },
              ].map((step) => <span key={step.label} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${step.done ? "bg-white/25 text-white" : "bg-white/10 text-indigo-100/70"}`}>{step.done ? "✓ " : "○ "}{step.label}</span>)}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2">
            <Button disabled={runtime.status.busy || campaign.status === "running"} onClick={() => {
              if (mustHandleAttentionFirst) { onOpenAttention?.(); return; }
              if (campaign.status === "paused") { void runtime.resumeAutonomousEvolution(); return; }
              void runtime.runAutoPilot();
            }} className="bg-white text-indigo-700 hover:bg-indigo-50"><Play className="size-4" />{mustHandleAttentionFirst ? "返回处理当前问题" : campaign.status === "paused" ? (campaign.checkpoint ? `从断点继续 Round ${campaign.checkpoint.round}` : "应用当前设置并继续") : campaign.currentRound > 0 || campaign.status === "running" ? "继续后台进化" : "一键启动自动驾驶"}</Button>
            <Button disabled={campaign.status !== "running" && campaign.status !== "scheduled"} variant="secondary" onClick={runtime.pauseCampaign} title="立即中止在途 AI 调用并暂停；本轮已完成的阶段会存成断点，继续时从下一步接着跑" className="border-white/40 bg-white/10 text-white hover:bg-white/20"><CirclePause className="size-4" />暂停</Button>
          </div>
        </div>
        {campaign.checkpoint && campaign.status === "paused" && (
          <div className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-[11px] leading-4 text-indigo-50">已暂停在 Round {campaign.checkpoint.round} ·「{CHECKPOINT_PHASE_LABELS[campaign.checkpoint.completedPhase]}」之后。点「从断点继续」会跳过已完成阶段，直接从下一步接着跑，不重复烧算力。</div>
        )}
        {(() => {
          const pending = (project.inputUnderstanding?.clarifications ?? []).filter((item) => !project.inputClarifications.some((answered) => answered.question === item.question));
          return pending.length > 0 ? <div className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-[11px] leading-4 text-indigo-50">还有 {pending.length} 条歧义待确认：自动驾驶会先按 AI 默认假设推进，你可以随时在「看懂成果」里改口径。</div> : null;
        })()}
      </section>
      {(campaign.status === "running" || campaign.status === "scheduled" || campaign.schedule.enabled || runtime.status.busy) && (
        <section className="rounded-2xl border border-indigo-100 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative flex size-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-indigo-500" /></span>
            <div className="text-sm font-semibold text-slate-900">运行状态</div>
            <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{campaign.status === "running" ? "运行中" : campaign.status === "paused" ? "已暂停" : campaign.status === "completed" ? "已完成" : campaign.status === "stopped" ? "已停止" : campaign.schedule.enabled ? "定时就绪" : "待命"}</Badge>
            {runtime.status.busy && <span className="text-xs text-indigo-600">{runtime.status.label}…{liveElapsedMs !== undefined && <b className="ml-1 font-mono tabular-nums text-indigo-500">已耗时 {formatCountdown(liveElapsedMs)}</b>}</span>}
            <span className="ml-auto text-xs text-slate-400">Round {campaign.status === "running" ? campaign.currentRound + 1 : campaign.currentRound}/{campaign.stopCriteria.maxRounds}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {CAMPAIGN_STEPS.map((step, index) => {
              const currentIndex = CAMPAIGN_STEPS.findIndex((item) => item.stage === project.stage);
              const state = campaign.status === "running" && currentIndex >= 0 ? (index < currentIndex ? "done" : index === currentIndex ? "current" : "todo") : "todo";
              return <span key={step.stage} className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : state === "current" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}>{state === "done" ? "✓ " : state === "current" ? "● " : ""}{step.label}</span>;
            })}
          </div>
          {campaign.schedule.enabled && campaign.schedule.nextRunAt && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
              <AlarmClock className="size-3.5" />
              <span>定时任务就绪 · 下次执行 {new Date(campaign.schedule.nextRunAt).toLocaleString()}</span>
              <b className="ml-auto font-mono text-sm tabular-nums">{formatCountdown(new Date(campaign.schedule.nextRunAt).getTime() - nowTs)}</b>
            </div>
          )}
          <div className="mt-3 max-h-40 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] leading-4 text-slate-600">
            {getRunActivity(project.id).length === 0
              ? <div className="text-slate-400">暂无活动记录：运行一轮或启用定时后，这里会实时写入每一步进度。</div>
              : getRunActivity(project.id).slice(0, 12).map((entry, index) => <div key={`${entry.at}-${index}`}>[{new Date(entry.at).toLocaleTimeString("zh-CN")}] {entry.label}{entry.ms !== undefined && <span className="text-slate-400"> · 耗时 {formatDuration(entry.ms)}</span>}</div>)}
          </div>
        </section>
      )}
      <details className="rounded-2xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">高级控制：搜索策略、预算、定时与手动运行</summary><div className="mt-4 space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        {settingsLocked && <div className="xl:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">当前轮次正在运行，高级参数已锁定，避免本轮中途改配置导致前后使用不同策略或被旧快照覆盖。暂停/本轮结束后可修改，下一轮生效。</div>}
        <fieldset disabled={settingsLocked} className="rounded-2xl border bg-slate-50/60 p-4 disabled:opacity-70">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><GitBranch className="size-4 text-indigo-600" />搜索策略</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="总进化轮数"><input type="number" min={1} max={100} className={inputClass} value={campaign.stopCriteria.maxRounds} onChange={(e) => updateStop({ maxRounds: Number(e.target.value) || 1 })} /></Field>
            <Field label="进化方式"><select className={selectClass} value={campaign.searchMode ?? "focused"} onChange={(e) => update({ searchMode: e.target.value as "focused" | "explore" })}><option value="focused">聚焦改进：同一问题比较 1–2 个修法（推荐）</option><option value="explore">探索模式：比较更多不同改法</option></select></Field>
            <Field label="探索模式每轮方案数"><input type="number" min={1} max={8} disabled={campaign.searchMode !== "explore"} className={inputClass} value={campaign.candidateCount} onChange={(e) => update({ candidateCount: Math.max(1, Math.min(8, Number(e.target.value) || 3)) })} /></Field>
            <Field label="父代选择策略"><select className={selectClass} value={campaign.parentStrategy} onChange={(e) => update({ parentStrategy: e.target.value as typeof campaign.parentStrategy })}>{parentStrategies.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></Field>
            <Field label="探索比例 Explore"><input type="number" min={0} max={1} step={0.05} className={inputClass} value={campaign.exploreRatio} onChange={(e) => update({ exploreRatio: Math.max(0, Math.min(1, Number(e.target.value))) })} /></Field>
            <Field label="Elite / Archive 父代数"><input type="number" min={1} max={8} className={inputClass} value={campaign.eliteCount} onChange={(e) => update({ eliteCount: Math.max(1, Math.min(8, Number(e.target.value) || 3)) })} /></Field>
          </div>
          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs leading-5 text-indigo-800">{parentStrategies.find((item) => item.id === campaign.parentStrategy)?.note} 推荐默认使用 <b>Champion + Elites</b>；对开放式 Agent/Workflow 设计，可切换 Quality Diversity 或 Open-ended Archive。</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="连续无提升停止"><input type="number" min={1} max={20} className={inputClass} value={campaign.stopCriteria.patienceRounds} onChange={(e) => updateStop({ patienceRounds: Number(e.target.value) || 1 })} /></Field>
            <Field label="最小有效提升"><input type="number" min={0} step={0.1} className={inputClass} value={campaign.stopCriteria.minImprovement} onChange={(e) => updateStop({ minImprovement: Number(e.target.value) || 0 })} /></Field>
            <Field label="目标综合分（可选）"><input type="number" min={0} max={100} step={0.5} className={inputClass} value={campaign.stopCriteria.targetScore ?? ""} placeholder="例如 92" onChange={(e) => updateStop({ targetScore: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="预算上限（估算，可选）"><input type="number" min={0} step={0.1} className={inputClass} value={campaign.stopCriteria.maxEstimatedCost ?? ""} placeholder="例如 10" onChange={(e) => updateStop({ maxEstimatedCost: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="最长连续运行/分钟（可选）"><input type="number" min={1} className={inputClass} value={campaign.stopCriteria.maxWallMinutes ?? ""} placeholder="例如 120" onChange={(e) => updateStop({ maxWallMinutes: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label="停止策略"><div className="space-y-1 rounded-xl border bg-white px-3 py-2 text-[10px] text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={campaign.stopCriteria.stopWhenAcceptanceMet} onChange={(e) => updateStop({ stopWhenAcceptanceMet: e.target.checked })} className="accent-indigo-600" />完整验收通过即完成（推荐）</label><label className="flex items-center gap-2"><input type="checkbox" checked={campaign.stopCriteria.stopWhenMetricTargetsMet} onChange={(e) => updateStop({ stopWhenMetricTargetsMet: e.target.checked })} className="accent-indigo-600" />指标目标满足即停止</label><label className="flex items-center gap-2"><input type="checkbox" checked={campaign.stopCriteria.stopOnSafetyFailure} onChange={(e) => updateStop({ stopOnSafetyFailure: e.target.checked })} className="accent-indigo-600" />Safety Hard Gate 失败即暂停</label></div></Field>
          </div>
          {campaign.stopCriteria.stopWhenMetricTargetsMet && metricTargetStatus.unsupported.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-4 text-amber-800">以下目标指标暂无法从 Judge 结果自动计算，因此不会用于“指标达标即停止”：{metricTargetStatus.unsupported.join("、")}。系统不会再把未知指标误判为已满足。</div>}
          {campaign.stopCriteria.maxWallMinutes !== undefined && <div className="mt-2 text-[10px] leading-4 text-slate-400">时间上限按单次连续执行窗口计算；用户暂停和定时等待不计入下一次窗口。边界在安全阶段/轮次间检查，不会强杀正在返回中的单个模型或 Runner 请求。</div>}
          <label className="mt-4 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={campaign.autoApproveOfflineExperiment} onChange={(e) => update({ autoApproveOfflineExperiment: e.target.checked })} className="accent-indigo-600" />允许 Campaign 自动批准纯离线 Experiment Gate（不会自动越过 Shadow / Canary / Production）</label>
        </fieldset>

        <fieldset disabled={settingsLocked} className="rounded-2xl border bg-white p-4 disabled:opacity-70">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarClock className="size-4 text-indigo-600" />定时与自动运行</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="执行模式"><select className={selectClass} value={campaign.executionMode} onChange={(e) => update({ executionMode: e.target.value as typeof campaign.executionMode })}><option value="manual">手动逐轮</option><option value="auto-rounds">自动运行到停止条件</option></select></Field>
            <Field label="计划类型"><select className={selectClass} value={campaign.schedule.mode} onChange={(e) => { const mode = e.target.value as typeof campaign.schedule.mode; updateSchedule({ mode, enabled: false, nextRunAt: undefined, ...(mode === "weekly" && campaign.schedule.daysOfWeek.length === 0 ? { daysOfWeek: [1] } : {}) }); }}><option value="manual">不定时</option><option value="once">指定时间执行</option><option value="interval">固定间隔</option><option value="daily">每天</option><option value="weekly">每周</option></select></Field>
            {campaign.schedule.mode === "once" && <Field label="执行时间"><input type="datetime-local" className={inputClass} value={toLocalValue(campaign.schedule.startAt)} onChange={(e) => updateSchedule({ startAt: fromLocalValue(e.target.value) })} /></Field>}
            {campaign.schedule.mode === "interval" && <Field label="间隔（分钟）"><input type="number" min={15} className={inputClass} value={campaign.schedule.intervalMinutes} onChange={(e) => updateSchedule({ intervalMinutes: Math.max(15, Number(e.target.value) || 60) })} /></Field>}
            {(campaign.schedule.mode === "daily" || campaign.schedule.mode === "weekly") && <Field label="每天/周执行时间"><input type="time" className={inputClass} value={`${String(campaign.schedule.hour).padStart(2,"0")}:${String(campaign.schedule.minute).padStart(2,"0")}`} onChange={(e) => { const [hour, minute] = e.target.value.split(":").map(Number); updateSchedule({ hour, minute }); }} /></Field>}
            {campaign.schedule.mode === "weekly" && <Field label="星期"><select className={selectClass} value={campaign.schedule.daysOfWeek[0] ?? 1} onChange={(e) => updateSchedule({ daysOfWeek: [Number(e.target.value)] })}>{["周日","周一","周二","周三","周四","周五","周六"].map((label,index)=><option value={index} key={label}>{label}</option>)}</select></Field>}
          </div>
          <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-xs text-slate-500">
            <div className="flex justify-between gap-3"><span>下次执行</span><b className="text-slate-700">{campaign.schedule.nextRunAt ? new Date(campaign.schedule.nextRunAt).toLocaleString() : "未安排"}</b></div>
            <div className="mt-1 flex justify-between gap-3"><span>累计估算成本</span><b className="text-slate-700">{campaign.estimatedCost.toFixed(3)}</b></div>
            <div className="mt-1 flex justify-between gap-3"><span>下一轮预计成本</span><b className="text-slate-700">≈ {nextRoundEstimate.toFixed(3)}</b></div>
            <div className="mt-1 flex justify-between gap-3"><span>无提升轮次</span><b className="text-slate-700">{campaign.noImprovementRounds}/{campaign.stopCriteria.patienceRounds}</b></div>
            <div className="mt-1 flex justify-between gap-3"><span>停止边界</span><b className="text-right text-slate-700">{campaign.stopCriteria.maxEstimatedCost !== undefined ? `预算 ${campaign.stopCriteria.maxEstimatedCost}` : "无预算限制"} · {campaign.stopCriteria.maxWallMinutes ? `${campaign.stopCriteria.maxWallMinutes} 分钟` : "无时间限制"}</b></div>
          </div>
          {scheduleIssue && campaign.schedule.mode !== "manual" && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-800">当前计划尚不可启用：{scheduleIssue}</p>}
          <p className="mt-3 text-[11px] leading-5 text-slate-400"><b>本地定时限制：</b>只有页面处于打开状态时，浏览器 Timer 才会触发计划；关闭浏览器期间不会继续执行。刷新或重新打开后可依据已保存任务/断点恢复。真正无人值守需要后端 Job Queue / Cron / Workflow Worker。</p>
        </fieldset>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={runtime.status.busy || campaign.status === "completed" || campaign.status === "stopped"} onClick={() => void runtime.runCampaignRound()}><Play className="size-4" />运行下一轮</Button>
        <Button disabled={runtime.status.busy || campaign.status === "completed" || campaign.status === "stopped"} variant="secondary" onClick={() => void runtime.runCampaign()}><FastForward className="size-4" />自动运行到停止条件</Button>
        <Button disabled={campaign.status !== "running" && campaign.status !== "scheduled"} variant="secondary" onClick={runtime.pauseCampaign}><CirclePause className="size-4" />暂停</Button>
        <Button variant="secondary" disabled={!campaign.schedule.enabled && (settingsLocked || campaign.status === "paused" || campaign.status === "completed" || campaign.status === "stopped" || Boolean(scheduleIssue))} title={!campaign.schedule.enabled && scheduleIssue ? scheduleIssue : undefined} onClick={() => runtime.scheduleCampaign(!campaign.schedule.enabled)}><AlarmClock className="size-4" />{campaign.schedule.enabled ? "取消定时" : "启用定时"}</Button>
        <Button variant="secondary" disabled={!championDeliverableReady} title={!championDeliverableReady ? "只有通过 Hidden Validation + Gate F 且存在已测试成果快照的 Search Champion 才能生成正式成果包" : undefined} onClick={() => runtime.materializeOutputs()}><Download className="size-4" />生成最佳版本成果包</Button>
        {onlineReleaseTarget ? <Button variant="secondary" disabled={!productionReleaseReady} title={!productionReleaseReady ? "需要 Search Champion 完整通过离线验收后才能进入生产发布" : undefined} onClick={runtime.prepareChampionRelease}><Award className="size-4" />准备发布最佳版本</Button> : <Badge className="border-slate-200 bg-slate-50 text-slate-500">离线成果无需生产发布</Badge>}
        <Button variant="ghost" disabled={runtime.status.busy || (campaign.currentRound === 0 && !champion)} onClick={() => { if (window.confirm("确认重置 Campaign 搜索历史？生产已发布版本不会被回滚，但 Search Champion / Archive / Round History 会清空。")) runtime.resetCampaign(); }}><RotateCcw className="size-4" />重置搜索</Button>
      </div>
      </div></details>

      {campaign.stopReason && <div className={`rounded-2xl border p-4 text-xs ${campaign.status==="completed"?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-amber-200 bg-amber-50 text-amber-900"}`}><b>{campaign.status==="completed"?"自主进化已达标完成：":"自主进化等待处理："}</b>{campaign.stopReason}</div>}

      <div className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]">
        <section className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between gap-3"><div className="font-semibold text-slate-900">Best-Ever Search Champion</div><Trophy className="size-4 text-amber-500" /></div>
          {!champion ? <p className="mt-5 text-xs leading-5 text-slate-400">至少完成一轮 Hidden Validation 后，系统才会注册 Search Champion。后续每轮只在综合分提升超过阈值时替换它。</p> : <>
            <div className="mt-4 text-3xl font-bold text-slate-950">{champion.versionLabel} <span className="text-lg text-indigo-600">{champion.score.toFixed(1)}</span></div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{champion.reason}</p><div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-2.5 text-[10px] leading-4 text-emerald-800">下一轮会自动把 <b>{champion.versionLabel}</b> 的 Patch Set 作为搜索基底；Elite / Stepping Stone 依据父代策略作为 crossover / novelty 的额外遗传材料。Production Champion 只有通过发布流程才会改变。</div>
            <div className="mt-3 flex flex-wrap gap-1.5"><Badge>Round {champion.round}</Badge><Badge>{champion.candidate?.title ?? champion.candidate?.name}</Badge><Badge>{champion.patches.length} patches</Badge></div>
          </>}
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
            <Mini label="Champion" value={archiveCounts.champion}/><Mini label="Elites" value={archiveCounts.elite}/><Mini label="Stepping Stones" value={archiveCounts.stepping}/><Mini label="Failures" value={archiveCounts.failure}/>
          </div>
          <div className="mt-4 rounded-xl border bg-slate-50/70 p-3">
            <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-400"><span>搜索记忆 · 下一轮自动注入</span><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">探索比例 {campaign.exploreRatio.toFixed(2)}</Badge></div>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-500">{searchMemory.summary}</p>
            {(searchMemory.deadEnds.length > 0 || searchMemory.recurringGaps.length > 0) && <div className="mt-2 flex flex-wrap gap-1">
              {searchMemory.deadEnds.slice(0, 3).map((item) => <Badge key={item.family} className="border-rose-200 bg-rose-50 text-rose-700" title={`尝试 ${item.attempts} 次，最好 ${item.bestScore.toFixed(1)} 分，从未夺冠`}>✕ {item.family}</Badge>)}
              {searchMemory.winning.slice(0, 2).map((item) => <Badge key={item.family} className="border-emerald-200 bg-emerald-50 text-emerald-700" title={`最好 ${item.bestScore.toFixed(1)} 分${item.wins ? `，夺冠 ${item.wins} 次` : ""}`}>✓ {item.family}</Badge>)}
              {searchMemory.recurringGaps.slice(0, 2).map((item) => <Badge key={item.theme} title={`出现 ${item.count} 次`}>{item.theme.slice(0, 18)}{item.theme.length > 18 ? "…" : ""} ×{item.count}</Badge>)}
            </div>}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-3"><div><div className="font-semibold">Round History</div><div className="text-[10px] text-slate-400">Best-of-Round 与 Best-Ever 分开记录</div></div><Archive className="size-4 text-indigo-500" /></div>
          {project.roundHistory.length === 0 ? <div className="px-4 py-10 text-center text-xs text-slate-400">尚未完成 Campaign Round。</div> : <div className="max-h-[290px] overflow-auto divide-y">{[...project.roundHistory].reverse().map((round) => <div key={round.id} className="grid grid-cols-[72px_1fr_auto] gap-3 px-4 py-3 text-xs">
            <div><div className="font-bold text-slate-900">Round {round.round}</div><div className="mt-1 text-[10px] text-slate-400">{round.parentVersionId}</div></div>
            <div><div className="font-semibold text-slate-700">Winner · {round.winnerCandidateId ?? "none"}</div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{round.summary}</p></div>
            <div className="text-right"><div className="font-bold text-indigo-600">{round.winnerScore?.toFixed(1) ?? "—"}</div><div className={`mt-1 text-[10px] ${round.championChanged ? "text-emerald-600" : "text-slate-400"}`}>{round.championChanged ? `↑ +${round.improvement.toFixed(1)} · 新 Champion` : "Archive only"}</div></div>
          </div>)}</div>}
        </section>
      </div>
    </CardContent>
  </Card>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-[10px] font-semibold text-slate-400">{label}</span>{children}</label>; }
function Mini({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border bg-slate-50 p-2.5"><div className="text-lg font-bold text-slate-800">{value}</div><div className="text-[10px] text-slate-400">{label}</div></div>; }
