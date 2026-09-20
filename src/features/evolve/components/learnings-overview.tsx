import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderKanban,
  GitBranch,
  Lightbulb,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EvolveProject, Lesson, NextQueueItem } from "../schemas";
import { useLocalProjects } from "../runtime/use-local-projects";

const SKILL_SEED_KEY = "evolve-studio:skill-seed:v1";
type Filter = "all" | "verified-skill" | "lesson" | "anti-pattern" | "next-queue";

/** 分组开合记忆的本地存储键：刷新/回访后保持用户上次的展开习惯。 */
const GROUP_EXPANDED_STORAGE_KEY = "evolve.learnings.group-expanded";
function loadGroupExpanded(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(GROUP_EXPANDED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === "boolean") out[key] = value;
    return out;
  } catch {
    return {};
  }
}

const PRIORITY_RANK: Record<NextQueueItem["priority"], number> = { P0: 0, P1: 1, P2: 2 };

export function LearningsOverview(){
  const projects=useLocalProjects();
  const navigate=useNavigate();
  const [filter,setFilter]=useState<Filter>("all");
  const [query,setQuery]=useState("");
  const lessons=useMemo(()=>projects.flatMap((project)=>project.lessons.map((lesson)=>({project,lesson}))),[projects]);
  const queue=useMemo(()=>projects.flatMap((project)=>project.nextQueue.map((item)=>({project,item}))),[projects]);
  const filtered=useMemo(()=>lessons.filter(({project,lesson})=>(filter==='all'||filter===lesson.status)&&(!query||`${project.name} ${lesson.title} ${lesson.summary} ${lesson.method.join(' ')}`.toLowerCase().includes(query.toLowerCase()))),[lessons,filter,query]);
  const [selectedKey,setSelectedKey]=useState<string|undefined>();
  const selected=filtered.find(({project,lesson})=>`${project.id}:${lesson.id}`===selectedKey)??filtered[0];
  const verified=lessons.filter(({lesson})=>lesson.status==='verified-skill').length;
  const anti=lessons.filter(({lesson})=>lesson.status==='anti-pattern').length;

  /** 与问题中心同款：按进化项目分组、默认折叠、点击组头展开、搜索自动展开、开合本地记忆。 */
  const [expanded,setExpanded]=useState<Record<string,boolean>>(loadGroupExpanded);
  const forceOpen=query.trim()!=="";
  const isGroupCollapsed=(projectId:string)=>(projectId in expanded?expanded[projectId]!:!forceOpen);
  const toggleGroup=(projectId:string)=>setExpanded((current)=>({...current,[projectId]:!isGroupCollapsed(projectId)}));
  useEffect(()=>{
    try{
      window.localStorage.setItem(GROUP_EXPANDED_STORAGE_KEY,JSON.stringify(expanded));
    }catch{
      // 本地存储不可用时静默降级：分组开合仅本次会话有效
    }
  },[expanded]);
  const groupedLessons=useMemo(()=>{
    const byProject=new Map<string,{project:EvolveProject;items:typeof filtered}>();
    for(const row of filtered){
      const entry=byProject.get(row.project.id)??{project:row.project,items:[]};
      entry.items.push(row);
      byProject.set(row.project.id,entry);
    }
    return [...byProject.values()].sort((a,b)=>b.items.length-a.items.length);
  },[filtered]);
  const queueFiltered=useMemo(()=>queue.filter(({project,item})=>!query||`${project.name} ${item.title} ${item.reason} ${item.source}`.toLowerCase().includes(query.toLowerCase())),[queue,query]);
  const groupedQueue=useMemo(()=>{
    const byProject=new Map<string,{project:EvolveProject;items:Array<{project:EvolveProject;item:NextQueueItem}>}>();
    for(const row of queueFiltered){
      const entry=byProject.get(row.project.id)??{project:row.project,items:[]};
      entry.items.push(row);
      byProject.set(row.project.id,entry);
    }
    return [...byProject.values()]
      .map((entry)=>({...entry,items:entry.items.slice().sort((a,b)=>PRIORITY_RANK[a.item.priority]-PRIORITY_RANK[b.item.priority])}))
      .sort((a,b)=>b.items.length-a.items.length);
  },[queueFiltered]);
  const activeGroups=filter==='next-queue'?groupedQueue:groupedLessons;
  const allExpanded=activeGroups.length>0&&activeGroups.every((group)=>!isGroupCollapsed(group.project.id));
  const setAll=(value:boolean)=>setExpanded(Object.fromEntries(activeGroups.map((group)=>[group.project.id,value])));

  const applySkill=(lesson:Lesson)=>{
    window.localStorage.setItem(SKILL_SEED_KEY,JSON.stringify({title:lesson.title,summary:lesson.summary,method:lesson.method,trigger:lesson.trigger,limit:lesson.limit,effect:lesson.effect}));
    navigate('/');
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><div className="text-xs font-semibold text-indigo-600">Experience & Skill Registry</div><h1 className="mt-1 text-3xl font-bold">经验中心</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">这里不是版本日志。它把经过 Validation、Holdout 和线上验证的结果提炼为 Success Pattern、Failure Pattern、Skill、Anti-pattern 与 Lineage，并为其他部门/Agent 提供可复用能力。</p></div><div className="flex flex-wrap gap-2"><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Gate E · Experience Ready</Badge><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">Skill 必须有适用条件和限制</Badge></div></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Verified Skills" value={verified} icon={<BookOpenCheck className="size-4"/>} tone="emerald"/><Stat label="Lessons" value={lessons.length} icon={<Lightbulb className="size-4"/>} tone="indigo"/><Stat label="Anti-patterns" value={anti} icon={<XCircle className="size-4"/>} tone="rose"/><Stat label="Next Queue" value={queue.length} icon={<Sparkles className="size-4"/>} tone="sky"/></div>

    <Card><CardContent className="pt-5"><div className="flex flex-col gap-3 lg:flex-row"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 size-4 text-slate-400"/><Input className="pl-9" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="搜索方法、触发条件、项目或限制…"/></div><div className="flex flex-wrap gap-2">{([['all','全部'],['verified-skill','Verified Skill'],['lesson','Lesson'],['anti-pattern','Anti-pattern'],['next-queue','Next Queue']] as const).map(([id,label])=><Button key={id} variant={filter===id?'default':'secondary'} size="sm" onClick={()=>setFilter(id)}>{label}</Button>)}</div></div></CardContent></Card>

    {filter==='next-queue' ? <div className="space-y-3">
      <div className="flex items-center justify-between gap-2"><div className="text-xs text-slate-400">按进化项目分组、组内按 P0 → P2 排序；分组默认折叠，点击组头展开，搜索时自动展开。</div><Button size="sm" variant="ghost" onClick={()=>setAll(!allExpanded)}>{allExpanded?<><ChevronsDownUp className="size-3.5"/>折叠全部</>:<><ChevronsUpDown className="size-3.5"/>展开全部</>}</Button></div>
      {groupedQueue.length?groupedQueue.map((group)=>{const isCollapsed=isGroupCollapsed(group.project.id);const p0=group.items.filter(({item})=>item.priority==='P0').length;const topItem=group.items[0];return <section key={group.project.id} className="overflow-hidden rounded-2xl border bg-white"><div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5"><button type="button" aria-expanded={!isCollapsed} onClick={()=>toggleGroup(group.project.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">{isCollapsed?<ChevronRight className="size-3.5 shrink-0 text-slate-400"/>:<ChevronDown className="size-3.5 shrink-0 text-slate-400"/>}<FolderKanban className="size-3.5 shrink-0 text-indigo-500"/><span className="text-xs font-bold text-slate-700">{group.project.name}</span><Badge className="border-slate-200 bg-white text-slate-500">{group.items.length} 条排队</Badge>{p0>0&&<Badge className="border-rose-200 bg-rose-50 text-rose-700">{p0} 个 P0</Badge>}{isCollapsed&&topItem&&<span className="min-w-0 truncate text-[10px] text-slate-400">最急 {topItem.item.priority} · {topItem.item.title}</span>}</button><Link to={`/projects/${group.project.id}?stage=learning`} className="ml-auto shrink-0 text-[10px] font-semibold text-indigo-600 hover:underline">进入项目</Link></div>{!isCollapsed&&<div className="grid gap-3 p-3 xl:grid-cols-2">{group.items.map(({item})=><Card key={item.id} className="border-slate-200"><CardContent className="pt-5"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><div className="font-semibold">{item.title}</div><Badge className={item.priority==='P0'?'border-rose-200 bg-rose-50 text-rose-700':item.priority==='P1'?'border-amber-200 bg-amber-50 text-amber-700':''}>{item.priority}</Badge></div><p className="mt-2 text-sm leading-6 text-slate-500">{item.reason}</p><div className="mt-3 text-xs text-slate-400">来源：{item.source}</div>{item.suggestedMetrics.length>0&&<div className="mt-3 flex flex-wrap gap-1">{item.suggestedMetrics.map((metric)=><Badge key={metric}>{metric}</Badge>)}</div>}</div><Sparkles className="size-4 text-indigo-500"/></div><div className="mt-4"><Link to={`/projects/${group.project.id}?stage=learning`}><Button variant="secondary" size="sm">回到项目启动下一轮 <ArrowUpRight className="size-3.5"/></Button></Link></div></CardContent></Card>)}</div>}</section>;}) : <Card><CardContent className="py-12 text-center text-sm text-slate-400">完成 Lesson Distillation 后，由 Next-cycle Engine 生成下一轮问题队列。</CardContent></Card>}
    </div> : lessons.length===0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-400">完成 Promote / Rollback 后，系统会提炼可验证的 Lesson、Skill 或 Anti-pattern。</CardContent></Card> : <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
      <Card className="overflow-hidden"><CardContent className="p-0"><div className="flex items-start justify-between gap-3 border-b px-5 py-4"><div><div className="font-semibold">经验资产</div><p className="mt-1 text-xs text-slate-400">按进化项目分组；Lesson 是实验结论，Verified Skill 才是可复用组织能力。</p></div><Button size="sm" variant="ghost" onClick={()=>setAll(!allExpanded)}>{allExpanded?<><ChevronsDownUp className="size-3.5"/>折叠全部</>:<><ChevronsUpDown className="size-3.5"/>展开全部</>}</Button></div><div className="divide-y">{groupedLessons.length?groupedLessons.map((group)=>{const isCollapsed=isGroupCollapsed(group.project.id);const topItem=group.items[0];const skillCount=group.items.filter(({lesson})=>lesson.status==='verified-skill').length;return <section key={group.project.id}><div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5"><button type="button" aria-expanded={!isCollapsed} onClick={()=>toggleGroup(group.project.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">{isCollapsed?<ChevronRight className="size-3.5 shrink-0 text-slate-400"/>:<ChevronDown className="size-3.5 shrink-0 text-slate-400"/>}<FolderKanban className="size-3.5 shrink-0 text-indigo-500"/><span className="text-xs font-bold text-slate-700">{group.project.name}</span><Badge className="border-slate-200 bg-white text-slate-500">{group.items.length} 条经验</Badge>{skillCount>0&&<Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{skillCount} 个 Verified Skill</Badge>}{isCollapsed&&topItem&&<span className="min-w-0 truncate text-[10px] text-slate-400">{topItem.lesson.title}</span>}</button></div>{!isCollapsed&&<div className="divide-y">{group.items.map(({lesson})=>{const key=`${group.project.id}:${lesson.id}`;const active=selected&&key===`${selected.project.id}:${selected.lesson.id}`;return <button key={key} onClick={()=>setSelectedKey(key)} className={`w-full p-4 text-left transition ${active?'bg-indigo-50/60':'hover:bg-slate-50'}`}><div className="flex items-start gap-3"><div className={`grid size-9 shrink-0 place-items-center rounded-xl ${lesson.status==='anti-pattern'?'bg-rose-50 text-rose-500':lesson.status==='verified-skill'?'bg-emerald-50 text-emerald-600':'bg-indigo-50 text-indigo-600'}`}>{lesson.status==='anti-pattern'?<XCircle className="size-4"/>:lesson.status==='verified-skill'?<CheckCircle2 className="size-4"/>:<Lightbulb className="size-4"/>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><div className="font-semibold">{lesson.title}</div><Badge>{lesson.status}</Badge>{lesson.reusable&&<Badge className="border-sky-200 bg-sky-50 text-sky-700">可复用</Badge>}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{lesson.summary}</p><div className="mt-2 text-[10px] text-slate-400">{lesson.effect}</div></div></div></button>;})}</div>}</section>;}) : <div className="py-10 text-center text-xs text-slate-400">没有匹配的经验资产。</div>}</div></CardContent></Card>
      {selected&&<Card className="h-fit"><CardContent className="pt-5"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Experience Inspector</div><h2 className="mt-1 text-xl font-bold">{selected.lesson.title}</h2><p className="mt-1 text-xs text-slate-400">{selected.project.name} · {selected.lesson.status}</p></div><GitBranch className="size-4 text-indigo-500"/></div><p className="mt-4 text-sm leading-6 text-slate-600">{selected.lesson.summary}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2"><Mini label="Observed Effect" value={selected.lesson.effect}/><Mini label="Known Limit" value={selected.lesson.limit}/></div>
        <section className="mt-4 rounded-xl border p-3"><div className="text-xs font-semibold">触发条件 / Trigger</div><div className="mt-2 flex flex-wrap gap-1">{selected.lesson.trigger.length?selected.lesson.trigger.map((item)=><Badge key={item}>{item}</Badge>):<span className="text-xs text-slate-400">未定义</span>}</div></section>
        <section className="mt-3 rounded-xl border p-3"><div className="text-xs font-semibold">方法 / Method</div>{selected.lesson.method.length?<ol className="mt-2 space-y-1 text-xs leading-5 text-slate-500">{selected.lesson.method.map((item,index)=><li key={`${index}-${item}`}>{index+1}. {item}</li>)}</ol>:<p className="mt-1 text-xs text-slate-400">未提炼结构化方法。</p>}</section>
        <section className="mt-3 rounded-xl border p-3"><div className="text-xs font-semibold">验证证据</div><div className="mt-2 flex flex-wrap gap-1">{selected.lesson.validatedOn.length?selected.lesson.validatedOn.map((item)=><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700" key={item}>{item}</Badge>):<span className="text-xs text-slate-400">尚未记录验证范围</span>}</div></section>
        <div className="mt-4 grid gap-2 sm:grid-cols-2"><Link to={`/projects/${selected.project.id}?stage=learning`}><Button variant="secondary" className="w-full">查看原始证据</Button></Link>{selected.lesson.status==='verified-skill'&&selected.lesson.reusable?<Button className="w-full" onClick={()=>applySkill(selected.lesson)}>应用到新进化项目 <ArrowUpRight className="size-3.5"/></Button>:<Button disabled className="w-full" variant="secondary">未达到 Skill 复用门槛</Button>}</div>
      </CardContent></Card>}
    </div>}
  </div>;
}

function Stat({label,value,icon,tone}:{label:string;value:number;icon:React.ReactNode;tone:'indigo'|'emerald'|'rose'|'sky'}) {const style={indigo:'bg-indigo-600',emerald:'bg-emerald-600',rose:'bg-rose-600',sky:'bg-sky-600'};return <Card><CardContent className="flex items-center gap-3 pt-5"><div className={`grid size-10 place-items-center rounded-xl ${style[tone]}`}>{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div></CardContent></Card>;}
function Mini({label,value}:{label:string;value:string}) {return <div className="rounded-xl border bg-slate-50 p-3"><div className="text-[10px] text-slate-400">{label}</div><div className="mt-1 text-xs font-semibold leading-5 text-slate-800">{value}</div></div>;}
