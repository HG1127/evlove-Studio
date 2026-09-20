import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Gauge,
  History,
  RotateCcw,
  Rocket,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EvolveProject, ReleaseState } from "../schemas";
import { useLocalProjects } from "../runtime/use-local-projects";

const releaseSteps: Array<{ label: string; statuses: ReleaseState["status"][]; traffic: string }> = [
  { label: "Offline Gate", statuses: ["idle","shadow","canary-5","canary-20","canary-50","promoted","rolled-back"], traffic: "0%" },
  { label: "Shadow", statuses: ["shadow","canary-5","canary-20","canary-50","promoted"], traffic: "0%" },
  { label: "Canary 5%", statuses: ["canary-5","canary-20","canary-50","promoted"], traffic: "5%" },
  { label: "Canary 20%", statuses: ["canary-20","canary-50","promoted"], traffic: "20%" },
  { label: "Canary 50%", statuses: ["canary-50","promoted"], traffic: "50%" },
  { label: "Production", statuses: ["promoted"], traffic: "100%" },
];

function statusText(project: EvolveProject) {
  if (project.release.status === "promoted") return "Promoted";
  if (project.release.status === "rolled-back") return "Rolled Back";
  if (project.release.status === "idle" && (project.searchChampion?.validation?.recommendation === "release" || project.validationRun.recommendation === "release")) return "Release Ready";
  if (project.release.status === "idle") return "Awaiting Validation";
  return project.release.status;
}

export function ReleasesOverview() {
  const projects = useLocalProjects();
  const rows = useMemo(() => projects.filter((project) => project.targetConnection.adapter === "http" && (project.release.status !== "idle" || project.validationRun.status === "completed" || project.experimentRun.winnerId || Boolean(project.searchChampion))), [projects]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = rows.find((project) => project.id === selectedId) ?? rows[0];
  const activeCanary = rows.filter((project) => project.release.status.startsWith("canary")).length;
  const promoted = rows.filter((project) => project.release.status === "promoted").length;
  const unhealthy = rows.filter((project) => project.release.healthy === false || project.release.status === "rolled-back").length;
  const ready = rows.filter((project) => (project.searchChampion?.validation?.recommendation === "release" || project.validationRun.recommendation === "release") && project.release.status === "idle").length;
  const winner = selected?.searchChampion?.candidate ?? selected?.candidates.find((candidate) => candidate.id === selected.experimentRun.winnerId);

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><div className="text-xs font-semibold text-indigo-600">Deployment Governance</div><h1 className="mt-1 text-3xl font-bold">发布治理</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">仅服务需要真实线上运行的 Mission：把已通过离线验收的 Champion 安全推进到 Shadow、Canary、Production，并保留 KPI、回滚与审计证据。离线文档成果不应被这里阻塞。</p></div><div className="flex flex-wrap gap-2"><Badge className="border-rose-200 bg-rose-50 text-rose-700"><ShieldCheck className="mr-1 size-3"/>真实流量操作需显式确认</Badge><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">Gate D · Online Stable</Badge></div></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Release Ready" value={ready} icon={<ShieldCheck className="size-4"/>} tone="indigo"/><Stat label="Canary 运行中" value={activeCanary} icon={<Activity className="size-4"/>} tone="sky"/><Stat label="已 Promote" value={promoted} icon={<Rocket className="size-4"/>} tone="emerald"/><Stat label="异常 / Rollback" value={unhealthy} icon={<TriangleAlert className="size-4"/>} tone="rose"/></div>

    {rows.length===0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-400">暂无需要线上发布的 Mission。只有配置真实 HTTP / Production Target 且完成离线验收的任务才进入这里；文档类成果在成果中心完成闭环。</CardContent></Card> : <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden"><CardContent className="p-0"><div className="border-b px-4 py-4"><div className="font-semibold">发布队列</div><p className="mt-1 text-xs text-slate-400">按风险与当前流量观察每个 Release Candidate。</p></div><div className="divide-y">{rows.map((project)=>{const active=selected?.id===project.id;return <button key={project.id} onClick={()=>setSelectedId(project.id)} className={`w-full p-4 text-left transition ${active?'bg-indigo-50/60':'hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-2"><div className="font-semibold">{project.name}</div><Badge className={project.release.healthy===false||project.release.status==='rolled-back'?'border-rose-200 bg-rose-50 text-rose-700':project.release.status==='promoted'?'border-emerald-200 bg-emerald-50 text-emerald-700':'border-indigo-200 bg-indigo-50 text-indigo-700'}>{statusText(project)}</Badge></div><div className="mt-2 text-xs text-slate-400">{project.searchChampion ? `${project.searchChampion.versionLabel} / ${project.searchChampion.candidate?.id ?? 'Champion'}` : project.experimentRun.winnerId || 'Candidate'} · {project.release.trafficPercent}% traffic</div>{project.release.kpis.length>0&&<div className="mt-2 text-[10px] text-slate-400">{project.release.kpis.slice(0,2).map((m)=>`${m.label} ${m.value}${m.unit}`).join(' · ')}</div>}</button>})}</div></CardContent></Card>

      {selected && <div className="space-y-4">
        <Card><CardContent className="pt-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Release Candidate</div><h2 className="mt-1 text-xl font-bold">{selected.name} · {selected.searchChampion?.versionLabel ?? winner?.id ?? selected.release.candidateId ?? 'Winner'}</h2><p className="mt-1 text-xs leading-5 text-slate-500">Production {selected.version} · Search Champion {selected.searchChampion?.versionLabel ?? '—'} · Target {selected.targetConnection.label} · Validation {selected.searchChampion?.validation?.recommendation ?? selected.validationRun.recommendation ?? 'pending'}</p>{selected.searchChampion&&<div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/70 p-2.5 text-[10px] leading-4 text-amber-800">发布中心默认面向 <b>Best-Ever Search Champion</b>，而不是最后一轮 Winner。点击项目内“准备发布最佳版本”会把该 Champion 的 Hidden Validation 载入 Release Ready Gate。</div>}</div><Link to={`/projects/${selected.id}?stage=${selected.validationRun.recommendation==='release'?'release':'validation'}`}><Button>打开发布控制 <ArrowRight className="size-3.5"/></Button></Link></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Mini label="Traffic" value={`${selected.release.trafficPercent}%`}/><Mini label="Health" value={selected.release.healthy===false?'UNHEALTHY':selected.release.healthy===true?'HEALTHY':'OBSERVING'}/><Mini label="Rollback" value={selected.version}/><Mini label="History" value={`${selected.release.history.length} actions`}/></div>
        </CardContent></Card>

        <Card><CardContent className="pt-5"><div className="flex items-center gap-2 font-semibold"><Rocket className="size-4 text-indigo-600"/>发布流水线</div><div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">{releaseSteps.map((step)=>{const done=step.label==='Offline Gate'?selected.validationRun.recommendation==='release':step.statuses.includes(selected.release.status);const current=(step.label==='Shadow'&&selected.release.status==='shadow')||(step.label==='Canary 5%'&&selected.release.status==='canary-5')||(step.label==='Canary 20%'&&selected.release.status==='canary-20')||(step.label==='Canary 50%'&&selected.release.status==='canary-50')||(step.label==='Production'&&selected.release.status==='promoted');return <div key={step.label} className={`rounded-xl border p-3 ${current?'border-indigo-300 bg-indigo-50':done?'border-emerald-200 bg-emerald-50/60':'bg-slate-50'}`}><div className="flex items-center justify-between"><span className="text-xs font-semibold">{step.label}</span>{done?<CheckCircle2 className="size-3.5 text-emerald-600"/>:<span className="size-2 rounded-full bg-slate-200"/>}</div><div className="mt-2 text-[10px] text-slate-400">{step.traffic} exposure</div></div>})}</div></CardContent></Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardContent className="pt-5"><div className="flex items-center gap-2 font-semibold"><Gauge className="size-4 text-indigo-600"/>Online Guardrails</div>{selected.release.kpis.length?<div className="mt-4 grid gap-2 sm:grid-cols-2">{selected.release.kpis.map((metric)=><div key={metric.key} className="rounded-xl border bg-slate-50 p-3"><div className="text-[10px] text-slate-400">{metric.label}</div><div className="mt-1 text-lg font-bold">{metric.value}{metric.unit}</div>{metric.target!==undefined&&<div className="mt-1 text-[10px] text-slate-400">目标 {metric.direction==='lower'?'≤':'≥'} {metric.target}{metric.unit}</div>}</div>)}</div>:<p className="mt-4 rounded-xl border bg-slate-50 p-4 text-xs leading-5 text-slate-400">Shadow / Canary 执行后，Target Adapter 返回的真实 KPI 会显示在这里。任何关键 KPI 越界都应停止扩量并 Rollback。</p>}</CardContent></Card>
          <Card><CardContent className="pt-5"><div className="flex items-center gap-2 font-semibold"><History className="size-4 text-indigo-600"/>Release Audit Trail</div><div className="mt-4 space-y-2">{selected.release.history.length?selected.release.history.slice().reverse().map((item,index)=><div key={`${item.at}-${index}`} className="flex gap-3 rounded-xl border p-3"><div className={`mt-1 size-2 shrink-0 rounded-full ${item.action==='rollback'?'bg-rose-500':item.action==='promote'?'bg-emerald-500':'bg-indigo-400'}`}/><div><div className="text-xs font-semibold">{item.action}</div><div className="mt-0.5 text-[10px] text-slate-400">{new Date(item.at).toLocaleString()}</div><p className="mt-1 text-xs leading-5 text-slate-500">{item.note}</p></div></div>):<div className="rounded-xl border bg-slate-50 p-4 text-xs text-slate-400">尚未进入真实发布动作。</div>}</div></CardContent></Card>
        </div>

        {(selected.release.healthy===false || selected.release.status==='rolled-back') && <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><RotateCcw className="mt-0.5 size-4 shrink-0"/><div><b>回滚/异常不是终点。</b><p className="mt-1 text-xs leading-5 text-rose-700">失败的 Online Trace、触发指标和运行环境会进入 Experience Center 的 Failure Pattern / Anti-pattern，并作为下一轮 Evolve 的诊断证据。</p></div></div>}
      </div>}
    </div>}
  </div>;
}

function Stat({label,value,icon,tone}:{label:string;value:number;icon:React.ReactNode;tone:'indigo'|'sky'|'emerald'|'rose'}) { const style={indigo:'bg-indigo-50 text-indigo-600',sky:'bg-sky-50 text-sky-600',emerald:'bg-emerald-50 text-emerald-600',rose:'bg-rose-50 text-rose-600'};return <Card><CardContent className="flex items-center gap-3 pt-5"><div className={`grid size-10 place-items-center rounded-xl ${style[tone]}`}>{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div></CardContent></Card>; }
function Mini({label,value}:{label:string;value:string}) { return <div className="rounded-xl border bg-slate-50 p-3"><div className="text-[10px] text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>; }
