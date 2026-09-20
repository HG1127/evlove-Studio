import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, BookOpenCheck, Boxes, CheckCircle2, Lightbulb, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { governProductionLessons } from "@evolution/core";
import { useLocalProjects } from "../runtime/use-local-projects";
import { listTemplates } from "../runtime/template-store";
import type { Lesson } from "../schemas";

const SKILL_SEED_KEY = "evolve-studio:skill-seed:v1";
type Tab = "skills" | "recipes" | "lessons" | "anti-patterns";

export function CapabilityLibrary() {
  const projects = useLocalProjects({ includeDemo: false });
  const navigate = useNavigate();
  const templates = useMemo(() => listTemplates(), []);
  const lessons = projects.flatMap((project) => governProductionLessons(project).lessons.map((lesson) => ({ project, lesson })));
  const [tab, setTab] = useState<Tab>("skills");
  const [query, setQuery] = useState("");
  const skills = lessons.filter(({ lesson }) => lesson.status === "verified-skill");
  const rawLessons = lessons.filter(({ lesson }) => lesson.status === "lesson");
  const anti = lessons.filter(({ lesson }) => lesson.status === "anti-pattern");
  const q = query.trim().toLowerCase();
  const applySkill = (lesson: Lesson) => {
    window.localStorage.setItem(SKILL_SEED_KEY, JSON.stringify({ title: lesson.title, summary: lesson.summary, method: lesson.method, trigger: lesson.trigger, limit: lesson.limit, effect: lesson.effect }));
    navigate("/");
  };
  const visibleLessons = (tab === "skills" ? skills : tab === "lessons" ? rawLessons : anti)
    .filter(({ project, lesson }) => !q || `${project.name} ${lesson.title} ${lesson.summary} ${lesson.method.join(" ")} ${lesson.trigger.join(" ")}`.toLowerCase().includes(q));
  const visibleTemplates = templates.filter((template) => !q || `${template.name} ${template.category} ${template.scenarios} ${template.goal}`.toLowerCase().includes(q));

  return <div className="space-y-5">
    <section className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between"><div><div className="text-xs font-semibold text-indigo-600">Capability Library</div><h1 className="mt-1 text-3xl font-bold">能力库</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">把“做什么”的 Recipe 与“怎么做好”的 Skill、Lesson、Anti-pattern 放在同一个复用中心。新任务会优先匹配已验证能力，而不是每次从零开始。</p></div><div className="flex flex-wrap gap-2"><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{skills.length} Verified Skills</Badge><Badge>{templates.length} Recipes</Badge></div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat icon={<CheckCircle2 className="size-4"/>} label="Verified Skills" value={skills.length}/><Stat icon={<Boxes className="size-4"/>} label="Recipes" value={templates.length}/><Stat icon={<Lightbulb className="size-4"/>} label="Lessons" value={rawLessons.length}/><Stat icon={<ShieldAlert className="size-4"/>} label="Anti-patterns" value={anti.length}/></div>
    <Card><CardContent className="space-y-3 pt-5"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400"/><Input className="pl-9" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="搜索能力、方法、任务场景或限制…"/></div><div className="flex flex-wrap gap-2">{([['skills','已验证方法'],['recipes','任务 Recipe'],['lessons','经验 Lessons'],['anti-patterns','反模式']] as const).map(([id,label])=><Button key={id} size="sm" variant={tab===id?'default':'secondary'} onClick={()=>setTab(id)}>{label}</Button>)}</div></CardContent></Card>
    {tab === "recipes" ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleTemplates.map((template)=><Card key={template.id}><CardContent className="flex h-full flex-col pt-5"><div className="flex items-center justify-between gap-2"><Badge>{template.category}</Badge><span className="text-[10px] text-slate-400">使用 {template.useCount} 次</span></div><div className="mt-3 font-semibold">{template.name}</div><p className="mt-2 text-xs leading-5 text-slate-500">{template.scenarios || template.goal}</p><div className="mt-2 flex flex-wrap gap-1">{template.metrics.slice(0,4).map((metric)=><Badge key={metric} className="border-slate-200 bg-slate-50 text-slate-500">{metric}</Badge>)}</div><div className="mt-auto flex gap-2 pt-4"><Link to={`/?template=${template.id}`} className="flex-1"><Button className="w-full" size="sm">用此 Recipe 开始</Button></Link><Link to="/templates"><Button size="sm" variant="secondary">管理</Button></Link></div></CardContent></Card>)}</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleLessons.length ? visibleLessons.map(({project,lesson})=><Card key={`${project.id}:${lesson.id}`}><CardContent className="flex h-full flex-col pt-5"><div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{lesson.title}</div><div className="mt-1 text-[10px] text-slate-400">{project.name}</div></div><Badge className={lesson.status==='verified-skill'?'border-emerald-200 bg-emerald-50 text-emerald-700':lesson.status==='anti-pattern'?'border-rose-200 bg-rose-50 text-rose-700':''}>{lesson.status}</Badge></div><p className="mt-3 text-xs leading-5 text-slate-500">{lesson.summary}</p><div className="mt-3 text-[10px] leading-4 text-slate-400">适用：{lesson.trigger.join('、') || '待进一步验证'}<br/>限制：{lesson.limit || '未记录'}</div><div className="mt-auto flex gap-2 pt-4">{lesson.status==='verified-skill'&&lesson.reusable?<Button size="sm" onClick={()=>applySkill(lesson)}>应用到新任务 <ArrowUpRight className="size-3.5"/></Button>:<Button size="sm" variant="secondary" disabled>尚未达到复用门槛</Button>}<Link to="/learnings"><Button size="sm" variant="ghost"><BookOpenCheck className="size-3.5"/>查看证据</Button></Link></div></CardContent></Card>) : <Card><CardContent className="py-14 text-center text-sm text-slate-400">当前分类还没有能力资产。</CardContent></Card>}</div>}
    <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs leading-5 text-sky-800"><b>当前边界：</b>能力匹配仍由项目输入和已有 Skill Seed 驱动；真正的语义自动匹配与组织级共享需要后端 Capability Service / 向量检索后再升级。</div>
  </div>;
}
function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:number}){return <Card><CardContent className="flex items-center gap-3 pt-5"><div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600">{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div></CardContent></Card>}
