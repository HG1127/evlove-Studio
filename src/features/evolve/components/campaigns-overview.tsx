import { Link } from "react-router-dom";
import { AlarmClock, CalendarClock, CirclePause, Clock3, FastForward, GitBranch, Play, TimerReset, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalProjects } from "../runtime/use-local-projects";
import { nextScheduledAt } from "../runtime/evolution-search";
import { saveLocalProject } from "../runtime/local-store";

function formatDate(value?: string) {
  if (!value) return "未安排";
  return new Date(value).toLocaleString();
}

function scheduleLabel(mode: string) {
  return ({ manual: "手动", once: "单次", interval: "固定间隔", daily: "每天", weekly: "每周" } as Record<string, string>)[mode] ?? mode;
}

export function CampaignsOverview() {
  const projects = useLocalProjects({ includeDemo: false });
  const rows = projects.filter((project) => project.campaign.currentRound > 0 || project.campaign.schedule.enabled || project.campaign.status !== "idle" || project.searchChampion);
  const scheduled = rows.filter((project) => project.campaign.schedule.enabled).length;
  const running = rows.filter((project) => project.campaign.status === "running").length;
  const completed = rows.filter((project) => project.campaign.status === "completed").length;
  const totalRounds = rows.reduce((sum, project) => sum + project.campaign.currentRound, 0);

  const toggleSchedule = (projectId: string, enabled: boolean) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const schedule = { ...project.campaign.schedule, enabled };
    schedule.nextRunAt = enabled ? nextScheduledAt(schedule) : undefined;
    saveLocalProject({ ...project, campaign: { ...project.campaign, status: enabled ? "scheduled" : project.campaign.status === "scheduled" ? "idle" : project.campaign.status, schedule }, updatedAt: new Date().toISOString() });
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div><div className="text-xs font-semibold text-indigo-600">Runtime & Governance</div><h1 className="mt-1 text-3xl font-bold">运行与治理</h1><p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">高级运行控制面：集中查看自动执行、定时计划、停止边界、预算与 Best-Ever Champion。普通用户只需在工作台关注“运行中 / 需要处理 / 待验收”。</p></div>
      <div className="flex flex-wrap gap-2"><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700"><AlarmClock className="mr-1 size-3" />{scheduled} 已定时</Badge><Badge>{running} 运行中</Badge></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={<CalendarClock className="size-4" />} label="Campaign" value={rows.length} />
      <Stat icon={<FastForward className="size-4" />} label="累计轮次" value={totalRounds} />
      <Stat icon={<Trophy className="size-4" />} label="已完成" value={completed} />
      <Stat icon={<Clock3 className="size-4" />} label="已定时" value={scheduled} />
    </div>

    {rows.length === 0 ? <Card><CardContent className="py-16 text-center"><TimerReset className="mx-auto size-8 text-slate-300" /><div className="mt-3 text-sm font-semibold text-slate-600">还没有 Campaign</div><p className="mt-1 text-xs text-slate-400">打开一个进化项目，在 Evolution Campaign 中设置多轮搜索或定时任务。</p></CardContent></Card> : <div className="grid gap-4 xl:grid-cols-2">
      {rows.map((project) => {
        const c = project.campaign;
        const champion = project.searchChampion;
        return <Card key={project.id} className="overflow-hidden"><CardContent className="pt-5">
          <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><div className="font-semibold text-slate-900">{project.name}</div><Badge>{project.department}</Badge><Badge className={c.status === "running" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : ""}>{c.status}</Badge></div><p className="mt-2 text-xs leading-5 text-slate-500">{project.goal}</p></div><GitBranch className="size-5 text-indigo-500" /></div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Mini label="Round" value={`${c.currentRound}/${c.stopCriteria.maxRounds}`} /><Mini label="Candidates" value={c.candidateCount} /><Mini label="Best" value={champion ? `${champion.versionLabel} · ${champion.score.toFixed(1)}` : "—"} /><Mini label="Cost" value={c.estimatedCost.toFixed(2)} /></div>
          <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-xs text-slate-500">
            <div className="flex justify-between gap-3"><span>计划</span><b className="text-slate-700">{scheduleLabel(c.schedule.mode)} · {c.executionMode === "auto-rounds" ? "自动跑到停止条件" : "每次一轮"}</b></div>
            <div className="mt-1 flex justify-between gap-3"><span>下次执行</span><b className="text-right text-slate-700">{formatDate(c.schedule.nextRunAt)}</b></div>
            <div className="mt-1 flex justify-between gap-3"><span>停止条件</span><b className="text-right text-slate-700">{c.stopCriteria.patienceRounds} 轮无提升 / 最小 +{c.stopCriteria.minImprovement}{c.stopCriteria.targetScore !== undefined ? ` / 目标 ${c.stopCriteria.targetScore}` : ""}</b></div>
          </div>
          {c.stopReason && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><b>最近停止原因：</b>{c.stopReason}</div>}
          <div className="mt-4 flex flex-wrap gap-2"><Link to={`/projects/${project.id}`}><Button size="sm"><Play className="size-3.5" />打开 Campaign</Button></Link><Button size="sm" variant="secondary" onClick={() => toggleSchedule(project.id, !c.schedule.enabled)}>{c.schedule.enabled ? <><CirclePause className="size-3.5" />取消定时</> : <><AlarmClock className="size-3.5" />启用定时</>}</Button></div>
        </CardContent></Card>;
      })}
    </div>}
    <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs leading-5 text-sky-800"><b>生产部署说明：</b>当前前端原型仅在页面打开时触发本地定时器。正式系统应将 Campaign Schedule 持久化到数据库，由后端 Cron / Job Queue / Workflow Worker 负责唤醒，并使用分布式锁保证同一项目不会重复执行。</div>
  </div>;
}
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) { return <Card><CardContent className="flex items-center gap-3 pt-5"><div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600">{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div></CardContent></Card>; }
function Mini({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border bg-white p-2.5"><div className="text-[10px] text-slate-400">{label}</div><div className="mt-1 truncate text-xs font-semibold text-slate-800">{value}</div></div>; }
