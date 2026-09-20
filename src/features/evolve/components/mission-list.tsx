import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Database, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocalProjects } from "../runtime/use-local-projects";
import { getLiveRun, getRunTask, shouldResumeTask, subscribeLiveRuns } from "../runtime/run-manager";
import { deriveMissionState, missionStateMeta, type MissionUserState } from "../runtime/mission-state";
import { MISSION_REVIEW_CHANGED_EVENT } from "../runtime/mission-review-store";

const filters:Array<["all"|MissionUserState,string]>=[["all","全部"],["running","正在运行"],["attention","需要处理"],["review","待验收"],["completed","已完成"],["scheduled","已计划"],["paused","已暂停"],["waiting","等待继续"]];
export function MissionList(){
  const projects=useLocalProjects();
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<"all"|MissionUserState>("all");
  const [tick,setTick]=useState(0);
  useEffect(()=>{const bump=()=>setTick(v=>v+1);const un=subscribeLiveRuns(bump);window.addEventListener("evolve-run-tasks-changed",bump);window.addEventListener(MISSION_REVIEW_CHANGED_EVENT,bump);return()=>{un();window.removeEventListener("evolve-run-tasks-changed",bump);window.removeEventListener(MISSION_REVIEW_CHANGED_EVENT,bump)}},[]);
  const rows=useMemo(()=>{void tick;return projects.map(project=>{const live=getLiveRun(project.id);const task=getRunTask(project.id);const state=deriveMissionState(project,{running:Boolean(live),interrupted:!live&&Boolean(task&&shouldResumeTask(task))});return {project,state,live}})},[projects,tick]);
  const visible=rows.filter(({project,state})=>(filter==="all"||state.state===filter)&&(!query.trim()||`${project.name} ${project.goal} ${project.department} ${state.label} ${state.detail}`.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.project.updatedAt.localeCompare(a.project.updatedAt));
  return <div className="space-y-5"><section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-xs font-semibold text-indigo-600">Evolution Missions</div><h1 className="mt-1 text-3xl font-bold">进化任务</h1><p className="mt-1 text-sm text-slate-500">按用户真正关心的状态管理任务，不再要求你理解 Target / Diagnosis / Validation 等内部技术阶段。</p></div><div className="flex gap-2"><Link to="/projects/manage"><Button variant="secondary"><Database className="size-4"/>项目数据管理</Button></Link><Link to="/"><Button><Plus className="size-4"/>新建任务</Button></Link></div></section>
  <Card><CardContent className="space-y-3 pt-5"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400"/><Input className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索任务名称、目标、状态或部门…"/></div><div className="flex flex-wrap gap-2">{filters.map(([id,label])=>{const count=id==="all"?rows.length:rows.filter(row=>row.state.state===id).length;return <Button key={id} size="sm" variant={filter===id?'default':'secondary'} onClick={()=>setFilter(id)}>{label} {count}</Button>})}</div></CardContent></Card>
  {visible.length?<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map(({project,state,live})=>{const meta=missionStateMeta[state.state];return <Link key={project.id} to={`/projects/${project.id}?stage=${state.stage}`} className="group"><Card className="h-full transition group-hover:border-indigo-200 group-hover:shadow-sm"><CardContent className="flex h-full flex-col pt-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-semibold">{project.name}</div><div className="mt-1 flex gap-1.5"><Badge>{project.department}</Badge><Badge className={meta.badge}>{state.label}</Badge></div></div>{state.state==="running"&&<Activity className="size-4 animate-pulse text-indigo-500"/>}</div><p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{project.goal}</p><div className="mt-3 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500"><b className="text-slate-700">当前：</b>{live?.label||state.detail}</div><div className="mt-auto flex items-center gap-2 border-t border-slate-100 pt-3 text-[10px] text-slate-400"><span>版本 {project.version}</span><span>·</span><span>{project.outputArtifacts.filter(a=>a.kind==='primary').length} 个正式成果</span><span className="ml-auto flex items-center gap-1 font-semibold text-indigo-600">{state.actionLabel}<ArrowRight className="size-3"/></span></div></CardContent></Card></Link>})}</div>:<Card><CardContent className="py-14 text-center text-sm text-slate-400">没有符合当前状态的任务。</CardContent></Card>}
  </div>;
}
