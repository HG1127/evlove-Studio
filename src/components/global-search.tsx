

import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocalProjects } from "@/features/evolve/runtime/use-local-projects";
import { useMemo, useState } from "react";

export function GlobalSearch() {
  const projects = useLocalProjects();
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return projects.flatMap((project) => {
      const projectHit = `${project.name} ${project.department} ${project.goal}`.toLowerCase().includes(q)
        ? [{ key: `project-${project.id}`, label: project.name, meta: `${project.department} · 项目`, href: `/projects/${project.id}` }]
        : [];
      const problemHits = project.problems
        .filter((problem) => `${problem.title} ${problem.summary}`.toLowerCase().includes(q))
        .slice(0, 3)
        .map((problem) => ({ key: `problem-${project.id}-${problem.id}`, label: problem.title, meta: `${project.name} · 问题`, href: `/projects/${project.id}?stage=problem` }));
      const lessonHits = project.lessons
        .filter((lesson) => `${lesson.title} ${lesson.summary}`.toLowerCase().includes(q))
        .slice(0, 3)
        .map((lesson) => ({ key: `lesson-${project.id}-${lesson.id}`, label: lesson.title, meta: `${project.name} · 经验`, href: `/projects/${project.id}?stage=learning` }));
      return [...projectHit, ...problemHits, ...lessonHits];
    }).slice(0, 8);
  }, [projects, query]);

  return <div className="relative hidden w-80 md:block">
    <div className="flex items-center gap-2 rounded-xl border bg-slate-50 px-3">
      <Search className="size-4 text-slate-400" />
      <Input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="全局搜索" className="h-9 border-0 bg-transparent p-0 shadow-none focus-visible:outline-none" placeholder="搜索项目、问题、经验…" />
    </div>
    {query.trim() && <div className="absolute inset-x-0 top-12 z-50 overflow-hidden rounded-2xl border bg-white p-2 shadow-xl">
      {results.length === 0 ? <div className="px-3 py-5 text-center text-xs text-slate-400">没有匹配结果</div> : results.map((item) => <Link key={item.key} to={item.href} onClick={() => setQuery("")} className="block rounded-xl px-3 py-2.5 hover:bg-slate-50">
        <div className="text-sm font-semibold text-slate-800">{item.label}</div><div className="mt-0.5 text-[11px] text-slate-400">{item.meta}</div>
      </Link>)}
    </div>}
  </div>;
}
