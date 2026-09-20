import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Filter,
  FolderKanban,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EvolveProject, Problem } from "../schemas";
import { saveLocalProject } from "../runtime/local-store";
import { useLocalProjects } from "../runtime/use-local-projects";

function score(problem: Problem) {
  const severity = problem.severity === "high" ? 1.35 : problem.severity === "medium" ? 1 : 0.72;
  const confidence = problem.confidence ?? 0.55;
  const recommended = problem.status === "recommended" ? 1.2 : 1;
  return Number((problem.impact * severity * (0.55 + confidence * 0.45) * recommended).toFixed(1));
}

function severityLabel(value: Problem["severity"]) { return value === "high" ? "高" : value === "medium" ? "中" : "低"; }

/** 分组开合记忆的本地存储键：刷新/回访后保持用户上次的展开习惯。 */
const GROUP_EXPANDED_STORAGE_KEY = "evolve.problems.group-expanded";
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

/** 组间排序方式记忆：默认按问题数，可切回按最高优先级。 */
const GROUP_SORT_STORAGE_KEY = "evolve.problems.group-sort";
function loadGroupSort(): "count" | "priority" {
  try {
    const raw = window.localStorage.getItem(GROUP_SORT_STORAGE_KEY);
    return raw === "priority" || raw === "count" ? raw : "count";
  } catch {
    return "count";
  }
}
function statusLabel(value: Problem["status"]) {
  return { recommended: "AI 推荐", observing: "观察", planned: "已规划", selected: "本轮目标", resolved: "已解决" }[value];
}

export function ProblemsOverview() {
  const projects = useLocalProjects();
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"all" | Problem["severity"]>("all");
  const [status, setStatus] = useState<"all" | Problem["status"]>("all");
  const [groupSort, setGroupSort] = useState<"count" | "priority">(loadGroupSort);
  const rows = useMemo(() => projects.flatMap((project) => project.problems.map((problem) => ({ project, problem, priority: score(problem) }))), [projects]);
  const filtered = useMemo(() => rows.filter(({ project, problem }) => {
    const text = `${project.name} ${problem.title} ${problem.summary} ${problem.rootCause ?? ""}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (severity === "all" || problem.severity === severity) && (status === "all" || problem.status === status);
  }).sort((a,b)=>b.priority-a.priority), [rows, query, severity, status]);
  /** 按进化项目分组：组内按优先级排序，组间按组内最高优先级排序，避免多项目问题混排成一锅。 */
  const grouped = useMemo(() => {
    const byProject = new Map<string, { project: EvolveProject; items: typeof filtered }>();
    for (const row of filtered) {
      const entry = byProject.get(row.project.id) ?? { project: row.project, items: [] };
      entry.items.push(row);
      byProject.set(row.project.id, entry);
    }
    return [...byProject.values()]
      .map((entry) => ({ ...entry, top: Math.max(...entry.items.map((item) => item.priority)) }))
      .sort(groupSort === "count" ? (a, b) => b.items.length - a.items.length || b.top - a.top : (a, b) => b.top - a.top);
  }, [filtered, groupSort]);
  /** 分组默认折叠，点击组头展开；expanded 记录用户主动开合（优先于自动展开）。搜索或筛选生效时自动展开，避免命中结果被折叠藏住。 */
  const [expanded, setExpanded] = useState<Record<string, boolean>>(loadGroupExpanded);
  const forceOpen = query.trim() !== "" || severity !== "all" || status !== "all";
  const isGroupCollapsed = (projectId: string) => (projectId in expanded ? expanded[projectId]! : !forceOpen);
  const allExpanded = grouped.length > 0 && grouped.every((group) => !isGroupCollapsed(group.project.id));
  const toggleGroup = (projectId: string) => setExpanded((current) => ({ ...current, [projectId]: !isGroupCollapsed(projectId) }));
  const setAll = (value: boolean) => setExpanded(Object.fromEntries(grouped.map((group) => [group.project.id, value])));
  useEffect(() => {
    try {
      window.localStorage.setItem(GROUP_EXPANDED_STORAGE_KEY, JSON.stringify(expanded));
    } catch {
      // 本地存储不可用时静默降级：分组开合仅本次会话有效
    }
  }, [expanded]);
  useEffect(() => {
    try {
      window.localStorage.setItem(GROUP_SORT_STORAGE_KEY, groupSort);
    } catch {
      // 本地存储不可用时静默降级：排序偏好仅本次会话有效
    }
  }, [groupSort]);
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const selected = filtered.find(({ project, problem }) => `${project.id}:${problem.id}` === selectedKey) ?? filtered[0];
  /** 搜索时 Inspector 自动聚焦第一条命中，所见即所搜；清空搜索后交还手动选择。随 query 变化在渲染期调整选中（避免 effect 内 setState 的级联渲染）。 */
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    const first = filtered[0];
    if (query.trim() !== "" && first) setSelectedKey(`${first.project.id}:${first.problem.id}`);
  }

  const unresolved = rows.filter(({ problem }) => problem.status !== "resolved").length;
  const high = rows.filter(({ problem }) => problem.severity === "high" && problem.status !== "resolved").length;
  const recommended = rows.filter(({ problem }) => problem.status === "recommended").length;
  const evidenceCount = rows.reduce((sum, { problem }) => sum + problem.evidence.length, 0);

  const selectForRound = (project: EvolveProject, problem: Problem) => {
    saveLocalProject({
      ...project,
      selectedProblemId: problem.id,
      stage: "problem",
      problems: project.problems.map((item) => ({ ...item, status: item.id === problem.id ? "selected" : item.status === "selected" ? "observing" : item.status })),
      updatedAt: new Date().toISOString(),
    });
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><div className="text-xs font-semibold text-indigo-600">Problem Intelligence Center</div><h1 className="mt-1 text-3xl font-bold">问题中心</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">把 Baseline Eval 与 Trace 变成“可决定是否开启一轮 Evolve”的问题资产。这里负责问题聚类、价值排序、证据检查、目标问题选择与跨项目观察，不负责直接修改系统。</p></div>
      <div className="flex flex-wrap gap-2"><Badge className="border-slate-200 bg-white text-slate-600">Gate A · Problem Worthy</Badge><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">Priority = 影响 × 严重度 × 置信度</Badge></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="待处理问题" value={unresolved} icon={<CircleAlert className="size-4"/>} style="text-rose-600 bg-rose-50" />
      <Stat label="高严重度" value={high} icon={<Activity className="size-4"/>} style="text-amber-600 bg-amber-50" />
      <Stat label="AI 推荐目标" value={recommended} icon={<Sparkles className="size-4"/>} style="text-indigo-600 bg-indigo-50" />
      <Stat label="证据片段" value={evidenceCount} icon={<CheckCircle2 className="size-4"/>} style="text-emerald-600 bg-emerald-50" />
    </div>

    <Card><CardContent className="pt-5"><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400"/><Input className="pl-9" placeholder="搜索问题、项目、根因或组件…" value={query} onChange={(e)=>setQuery(e.target.value)} /></div><label className="flex items-center gap-2 rounded-xl border bg-white px-3"><Filter className="size-3.5 text-slate-400"/><select className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" value={severity} onChange={(e)=>setSeverity(e.target.value as typeof severity)}><option value="all">全部严重度</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label><select className="h-10 rounded-xl border bg-white px-3 text-sm outline-none" value={status} onChange={(e)=>setStatus(e.target.value as typeof status)}><option value="all">全部状态</option><option value="recommended">AI 推荐</option><option value="selected">本轮目标</option><option value="observing">观察</option><option value="planned">已规划</option><option value="resolved">已解决</option></select></div></CardContent></Card>

    {filtered.length===0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-400">运行 Baseline 并执行“AI 分析问题”后，这里会出现真实问题资产。</CardContent></Card> : <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]">
      <Card className="overflow-hidden"><CardContent className="p-0"><div className="flex items-start justify-between gap-3 border-b px-5 py-4"><div><div className="font-semibold">问题优先级队列</div><p className="mt-1 text-xs text-slate-400">按进化项目分组、组内按优先级排序；分组默认折叠，点击组头展开；搜索或筛选时自动展开命中分组。先决定“值不值得进化”，再进入根因诊断，避免对低价值噪音持续烧 Token。</p></div><div className="flex shrink-0 items-center gap-2"><div className="flex overflow-hidden rounded-lg border" role="group" aria-label="组间排序"><button type="button" onClick={()=>setGroupSort("count")} className={groupSort==="count"?"bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white":"bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"}>按数量</button><button type="button" onClick={()=>setGroupSort("priority")} className={groupSort==="priority"?"bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white":"bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"}>按优先级</button></div><Button size="sm" variant="ghost" onClick={()=>setAll(!allExpanded)}>{allExpanded?<><ChevronsDownUp className="size-3.5"/>折叠全部</>:<><ChevronsUpDown className="size-3.5"/>展开全部</>}</Button></div></div><div className="divide-y">{grouped.map((group)=>{const openCount=group.items.filter((item)=>item.problem.status!=="resolved").length;const recCount=group.items.filter((item)=>item.problem.status==="recommended").length;const isCollapsed=isGroupCollapsed(group.project.id);const topItem=group.items[0];return <section key={group.project.id}><div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5"><button type="button" aria-expanded={!isCollapsed} onClick={()=>toggleGroup(group.project.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">{isCollapsed?<ChevronRight className="size-3.5 shrink-0 text-slate-400"/>:<ChevronDown className="size-3.5 shrink-0 text-slate-400"/>}<FolderKanban className="size-3.5 shrink-0 text-indigo-500"/><span className="text-xs font-bold text-slate-700">{group.project.name}</span><Badge className="border-slate-200 bg-white text-slate-500">{group.items.length} 个问题{openCount>0?` · ${openCount} 待处理`:""}</Badge>{recCount>0&&<Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{recCount} 个 AI 推荐</Badge>}{isCollapsed&&topItem&&<span className="min-w-0 truncate text-[10px] text-slate-400">最高 P {topItem.priority} · {topItem.problem.title}</span>}</button><Link to={`/projects/${group.project.id}?stage=problem`} className="ml-auto shrink-0 text-[10px] font-semibold text-indigo-600 hover:underline">进入项目</Link></div>{!isCollapsed&&<div className="divide-y">{group.items.map(({problem,priority})=>{const key=`${group.project.id}:${problem.id}`;const active=selected && key===`${selected.project.id}:${selected.problem.id}`;return <button key={key} onClick={()=>setSelectedKey(key)} className={`w-full px-5 py-4 text-left transition ${active?'bg-indigo-50/60':'hover:bg-slate-50'}`}><div className="flex items-start gap-3"><div className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${problem.severity==='high'?'bg-rose-50 text-rose-600':problem.severity==='medium'?'bg-amber-50 text-amber-600':'bg-slate-100 text-slate-500'}`}><CircleAlert className="size-4"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{problem.title}</span><Badge className="border-slate-200 bg-white text-slate-600">P {priority}</Badge>{problem.status==='recommended'&&<Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">AI 推荐</Badge>}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{problem.summary}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400"><span>影响 {problem.impact}%</span><span>严重度 {severityLabel(problem.severity)}</span><span>置信度 {problem.confidence ? `${Math.round(problem.confidence*100)}%` : '—'}</span><span>{problem.evidence.length} 条证据</span></div></div></div></button>})}</div>}</section>;})}</div></CardContent></Card>

      {selected && <Card className="h-fit"><CardContent className="pt-5"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Problem Inspector</div><h2 className="mt-1 text-xl font-bold">{selected.problem.title}</h2><p className="mt-1 text-xs text-slate-400">{selected.project.name} · {statusLabel(selected.problem.status)}</p></div><div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><BrainCircuit className="size-4"/></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2">{[['影响',`${selected.problem.impact}%`],['Priority',String(selected.priority)],['置信度',selected.problem.confidence?`${Math.round(selected.problem.confidence*100)}%`:'—']].map(([l,v])=><div key={l} className="rounded-xl border bg-slate-50 p-3"><div className="text-[10px] text-slate-400">{l}</div><div className="mt-1 font-bold">{v}</div></div>)}</div>
        <div className="mt-4 space-y-3"><section className="rounded-xl border p-3"><div className="text-xs font-semibold">业务影响</div><p className="mt-1 text-xs leading-5 text-slate-500">{selected.problem.summary}</p></section><section className="rounded-xl border p-3"><div className="text-xs font-semibold">可能受影响组件</div><p className="mt-1 text-xs leading-5 text-slate-500">{selected.problem.affectedComponent || '需要进入 Root Cause Diagnosis 才能确认，不应只凭问题表象推断。'}</p></section><section className="rounded-xl border p-3"><div className="text-xs font-semibold">已掌握证据</div>{selected.problem.evidence.length?<ul className="mt-2 space-y-1 text-xs leading-5 text-slate-500">{selected.problem.evidence.slice(0,5).map((item)=><li key={item}>• {item}</li>)}</ul>:<p className="mt-1 text-xs text-slate-400">暂无证据；不建议直接进入 Mutation。</p>}</section></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2"><Link to={`/projects/${selected.project.id}?stage=problem`} onClick={()=>selectForRound(selected.project,selected.problem)}><Button className="w-full"><Target className="size-3.5"/>设为本轮目标</Button></Link><Link to={`/projects/${selected.project.id}?stage=diagnosis`}><Button variant="secondary" className="w-full">进入根因诊断 <ArrowRight className="size-3.5"/></Button></Link></div>
      </CardContent></Card>}
    </div>}
  </div>;
}

function Stat({label,value,icon,style}:{label:string;value:number;icon:React.ReactNode;style:string}) {
  return <Card><CardContent className="flex items-center gap-3 pt-5"><div className={`grid size-10 place-items-center rounded-xl ${style}`}>{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div></CardContent></Card>;
}
