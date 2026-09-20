import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, CheckCircle2, CircleAlert, Clock3, PackageCheck, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalProjects } from "../runtime/use-local-projects";
import { getLiveRun, getRunTask, shouldResumeTask, subscribeLiveRuns } from "../runtime/run-manager";
import { deriveMissionState, missionStateMeta } from "../runtime/mission-state";
import { MISSION_REVIEW_CHANGED_EVENT } from "../runtime/mission-review-store";
import { EvolutionComposer } from "./evolution-composer";

export function MissionControlDashboard(){
  const projects=useLocalProjects({includeDemo:false});
  const [tick,setTick]=useState(0);
  useEffect(()=>{const bump=()=>setTick(v=>v+1);const unsubscribe=subscribeLiveRuns(bump);window.addEventListener("evolve-run-tasks-changed",bump);window.addEventListener(MISSION_REVIEW_CHANGED_EVENT,bump);return()=>{unsubscribe();window.removeEventListener("evolve-run-tasks-changed",bump);window.removeEventListener(MISSION_REVIEW_CHANGED_EVENT,bump)}},[]);
  const rows=useMemo(()=>{void tick;return projects.map(project=>{const live=getLiveRun(project.id);const task=getRunTask(project.id);const interrupted=!live&&Boolean(task&&shouldResumeTask(task));return {project,live,state:deriveMissionState(project,{running:Boolean(live),interrupted})}})},[projects,tick]);
  const attention=rows.filter(row=>row.state.state==="attention");
  const running=rows.filter(row=>row.state.state==="running");
  const review=rows.filter(row=>row.state.state==="review");
  const completed=rows.filter(row=>row.state.state==="completed");
  const stats=[
    {label:"需要你处理",value:attention.length,icon:CircleAlert,tone:"border-amber-200 bg-amber-50 text-amber-700"},
    {label:"正在自动进化",value:running.length,icon:Activity,tone:"border-indigo-200 bg-indigo-50 text-indigo-700"},
    {label:"成果待验收",value:review.length,icon:PackageCheck,tone:"border-sky-200 bg-sky-50 text-sky-700"},
    {label:"已完成",value:completed.length,icon:CheckCircle2,tone:"border-emerald-200 bg-emerald-50 text-emerald-700"},
  ];
  return <div className="space-y-5">
    <section className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-semibold text-indigo-600">Mission Control</div><h1 className="mt-1 text-3xl font-bold tracking-tight">工作台</h1><p className="mt-1 text-sm text-slate-500">只展示你需要关心的任务状态：系统自己能解决的事情，不再要求你逐节点推动。</p></div><div className="flex flex-wrap gap-2"><Link to="/readiness"><Button variant="ghost"><ShieldCheck className="size-3.5"/>闭环完整性</Button></Link><Link to="/projects"><Button variant="secondary">全部进化任务 <ArrowRight className="size-3.5"/></Button></Link></div></section>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{stats.map(({label,value,icon:Icon,tone})=><Card key={label} className={tone}><CardContent className="flex items-center justify-between p-4"><div><div className="text-xs font-semibold opacity-80">{label}</div><div className="mt-1 text-3xl font-bold tabular-nums">{value}</div></div><Icon className="size-5"/></CardContent></Card>)}</div>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0"><EvolutionComposer compact/></div><Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><CircleAlert className="size-4 text-amber-500"/>需要你处理</CardTitle></CardHeader><CardContent className="space-y-2">{attention.length?attention.slice(0,5).map(({project,state})=><Link key={project.id} to={`/projects/${project.id}?stage=${state.stage}`} className="block rounded-xl border border-amber-100 bg-amber-50/60 p-3 transition hover:border-amber-200"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800">{project.name}</div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-amber-800">{state.detail}</p></div><ArrowRight className="size-3.5 shrink-0 text-amber-400"/></div></Link>):<div className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-700">目前没有需要你处理的事项。Evolve 会继续自主运行。</div>}</CardContent></Card></div>
    <section className="grid gap-4 xl:grid-cols-2"><MissionSection title="正在自动进化" icon={<Activity className="size-4 text-indigo-600"/>} empty="当前没有运行中的任务。" rows={running.map(({project,live,state})=>({project,state,sub:live?.label||state.detail}))}/><MissionSection title="成果待验收" icon={<PackageCheck className="size-4 text-sky-600"/>} empty="当前没有等待验收的成果。" rows={review.map(({project,state})=>({project,state,sub:state.detail,href:"/outputs"}))}/></section>
    <section><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 font-semibold"><Clock3 className="size-4 text-slate-500"/>最近任务</div><Link to="/projects" className="text-xs font-semibold text-indigo-600">查看全部</Link></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.slice().sort((a,b)=>b.project.updatedAt.localeCompare(a.project.updatedAt)).slice(0,6).map(({project,state})=>{const meta=missionStateMeta[state.state];return <Link key={project.id} to={`/projects/${project.id}`} className="rounded-2xl border bg-white p-4 transition hover:border-indigo-200 hover:bg-indigo-50/30"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-semibold">{project.name}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{project.goal}</p></div><Badge className={meta.badge}>{state.label}</Badge></div><div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400"><span className={`size-1.5 rounded-full ${meta.dot}`}/><span className="truncate">{state.detail}</span></div></Link>})}</div></section>
  </div>;
}
function MissionSection({title,icon,empty,rows}:{title:string;icon:React.ReactNode;empty:string;rows:Array<{project:{id:string;name:string;goal:string};state:{label:string;detail:string;stage:string};sub:string;href?:string}>}){return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">{icon}{title}</CardTitle></CardHeader><CardContent className="space-y-2">{rows.length?rows.slice(0,5).map(({project,state,sub,href})=><Link key={project.id} to={href??`/projects/${project.id}`} className="flex items-center gap-3 rounded-xl border p-3 transition hover:border-indigo-200 hover:bg-slate-50"><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{project.name}</div><div className="mt-1 truncate text-[11px] text-slate-500">{sub}</div></div><Badge>{state.label}</Badge><ArrowRight className="size-3.5 text-slate-300"/></Link>):<div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">{empty}</div>}</CardContent></Card>}
