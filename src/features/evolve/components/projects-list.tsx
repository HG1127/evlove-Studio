
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Download, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { deleteLocalProject, markDemoRemoved, saveLocalProject } from "../runtime/local-store";
import { composeProjects } from "../runtime/use-local-projects";
import { getLiveRun, getRunTask, shouldResumeTask, subscribeLiveRuns } from "../runtime/run-manager";
import { EvolveProjectSchema, type EvolveProject, type Stage } from "../schemas";

const stageLabel: Record<Stage, string> = {
  target: "理解材料与目标", baseline: "理解材料与目标", problem: "找出改进重点", diagnosis: "找出改进重点", plan: "自动生成新版",
  experiment: "自动生成新版", validation: "检查改进效果", release: "交付与继续进化", learning: "交付与继续进化",
};

/** 阶段色系：同一推进阶段同族颜色，用于项目卡的状态点与状态文字。 */
const stageTone: Record<Stage, { dot: string; text: string }> = {
  target: { dot: "bg-slate-400", text: "text-slate-600" },
  baseline: { dot: "bg-slate-400", text: "text-slate-600" },
  problem: { dot: "bg-amber-400", text: "text-amber-700" },
  diagnosis: { dot: "bg-amber-400", text: "text-amber-700" },
  plan: { dot: "bg-indigo-400", text: "text-indigo-700" },
  experiment: { dot: "bg-sky-400", text: "text-sky-700" },
  validation: { dot: "bg-sky-400", text: "text-sky-700" },
  release: { dot: "bg-emerald-400", text: "text-emerald-700" },
  learning: { dot: "bg-violet-400", text: "text-violet-700" },
};

type SortKey = "updated" | "active" | "name";
/** 活跃度：问题 + 候选 + 经验 + 版本总量，衡量一个项目推进了多少事。 */
const activity = (p: EvolveProject) => p.problems.length + p.candidates.length + p.lessons.length + p.versions.length;

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
}

const FILTERS_STORAGE_KEY = "evolve.projects.filters:v1";
/** 恢复筛选与排序记忆：只接受合法的阶段 / 排序值，非法一律落回默认。 */
function loadSavedFilters(): { dept: string; stage: Stage | "all"; sort: SortKey } | null {
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { dept?: unknown; stage?: unknown; sort?: unknown };
    return {
      dept: typeof parsed.dept === "string" ? parsed.dept : "all",
      stage: parsed.stage === "all" || (typeof parsed.stage === "string" && parsed.stage in stageLabel) ? (parsed.stage as Stage | "all") : "all",
      sort: parsed.sort === "active" || parsed.sort === "name" || parsed.sort === "updated" ? parsed.sort : "updated",
    };
  } catch {
    return null;
  }
}


export function ProjectsList() {
  const [projects, setProjects] = useState<EvolveProject[]>(composeProjects);
  useEffect(() => {
    const refresh = () => setProjects(composeProjects());
    refresh();
    window.addEventListener("evolve-projects-changed", refresh);
    return () => window.removeEventListener("evolve-projects-changed", refresh);
  }, []);

  // 运行状态徽标：项目卡上直接看到「正在后台运行」或「刷新被打断 · 打开自动续跑」，
  // 不用点进项目才知道有没有任务在跑。
  const [runTick, setRunTick] = useState(0);
  useEffect(() => {
    const bump = () => setRunTick((value) => value + 1);
    const unsubscribe = subscribeLiveRuns(bump);
    window.addEventListener("evolve-run-tasks-changed", bump);
    window.addEventListener("evolve-projects-changed", bump);
    return () => {
      unsubscribe();
      window.removeEventListener("evolve-run-tasks-changed", bump);
      window.removeEventListener("evolve-projects-changed", bump);
    };
  }, []);
  const runStateOf = (projectId: string) => {
    void runTick;
    const live = getLiveRun(projectId);
    if (live) return { kind: "running" as const, label: live.label ?? "节点运行中" };
    const task = getRunTask(projectId);
    if (task && shouldResumeTask(task)) return { kind: "interrupted" as const, label: task.label };
    return undefined;
  };

  /** 重命名 / 删除：删除必须弹窗二次确认，避免误删整个进化历史。 */
  const [renameTarget, setRenameTarget] = useState<EvolveProject | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EvolveProject | null>(null);
  const confirmRename = () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (name && name !== renameTarget.name) saveLocalProject({ ...renameTarget, name, updatedAt: new Date().toISOString() });
    setRenameTarget(null);
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.id === "demo") markDemoRemoved();
    deleteLocalProject(deleteTarget.id);
    setDeleteTarget(null);
  };
  /** 导出备份：把整个项目（目标、实验、版本、经验）存成 JSON 文件下载到本地。 */
  const exportProject = (project: EvolveProject) => {
    const payload = { app: "evolve-studio", kind: "project-backup", version: 1, exportedAt: new Date().toISOString(), project };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `evolve-backup-${project.name.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || project.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  /** 导入恢复：读取导出的 JSON 备份，校验后入库；同名项目已存在时以新身份导入，避免覆盖现有进度。 */
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importNote, setImportNote] = useState<{ tone: "ok" | "err"; text: string }>();
  const handleImportFile = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const candidate = (parsed as { project?: unknown } | null)?.project ?? parsed;
      const result = EvolveProjectSchema.safeParse(candidate);
      if (!result.success) {
        setImportNote({ tone: "err", text: "该文件不是有效的进化项目备份，请确认它由本系统导出。" });
        return;
      }
      let imported = result.data;
      const exists = projects.some((p) => p.id === imported.id);
      if (exists) imported = { ...imported, id: `project-${Date.now()}` };
      saveLocalProject({ ...imported, updatedAt: new Date().toISOString() });
      setImportNote({ tone: "ok", text: exists ? `「${imported.name}」与现有项目重名，已作为新项目导入，可用重命名区分。` : `导入成功：「${imported.name}」已加入项目列表。` });
    } catch {
      setImportNote({ tone: "err", text: "文件解析失败，请选择本系统导出的 JSON 备份文件。" });
    }
  };

  /** 搜索 + 部门筛选 + 阶段筛选 + 排序：项目多时不再靠肉眼从头翻到尾。筛选与排序选择本地记忆，回访原样恢复。 */
  const [savedFilters] = useState(loadSavedFilters);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState<string>(() => {
    const savedDept = savedFilters?.dept ?? "all";
    return savedDept !== "all" && !projects.some((p) => p.department === savedDept) ? "all" : savedDept;
  });
  const [stage, setStage] = useState<Stage | "all">(savedFilters?.stage ?? "all");
  const [sort, setSort] = useState<SortKey>(savedFilters?.sort ?? "updated");
  useEffect(() => {
    try {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ dept, stage, sort }));
    } catch {
      // 本地存储不可用时静默降级：筛选习惯仅本次会话有效
    }
  }, [dept, stage, sort]);

  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) counts.set(p.department, (counts.get(p.department) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) =>
      (dept === "all" || p.department === dept) &&
      (stage === "all" || stageLabel[p.stage] === stageLabel[stage]) &&
      (!q || `${p.name} ${p.department} ${p.goal} ${stageLabel[p.stage]}`.toLowerCase().includes(q)));
  }, [projects, query, dept, stage]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    if (sort === "updated") rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sort === "active") rows.sort((a, b) => activity(b) - activity(a));
    if (sort === "name") rows.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    return rows;
  }, [filtered, sort]);

  const hasFilter = query.trim() !== "" || dept !== "all" || stage !== "all";
  const clearFilters = () => { setQuery(""); setDept("all"); setStage("all"); };

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-xs font-semibold text-indigo-600">Projects</div><h1 className="mt-1 text-3xl font-bold">我的进化项目</h1><p className="mt-1 text-sm text-slate-500">跟踪材料理解、自动改进和验收进度，随时对照原版、查看成果。</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => importInputRef.current?.click()}><Upload className="size-4" />导入项目</Button><Link to="/"><Button><Plus className="size-4" />新建项目</Button></Link></div><input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleImportFile(file); e.target.value = ""; }} /></div>

    {importNote && (
      <div className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${importNote.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
        <span>{importNote.text}</span>
        <button type="button" className="shrink-0 text-xs opacity-60 transition hover:opacity-100" onClick={() => setImportNote(undefined)}>关闭</button>
      </div>
    )}

    <Card><CardContent className="space-y-3 pt-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索项目名称、目标、部门或阶段…" /></div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="按阶段筛选" value={stage === "all" ? "all" : (["target","problem","plan","validation","release"] as Stage[]).find((key) => stageLabel[key] === stageLabel[stage])} onChange={(e) => setStage(e.target.value as Stage | "all")} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600">
            <option value="all">全部阶段</option>
            {(["target", "problem", "plan", "validation", "release"] as Stage[]).map((key) => <option key={key} value={key}>{stageLabel[key]}</option>)}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {([["updated", "最近更新"], ["active", "最活跃"], ["name", "按名称"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setSort(key)} className={`px-2.5 py-1.5 text-xs font-semibold transition ${sort === key ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>{label}</button>)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant={dept === "all" ? "default" : "secondary"} size="sm" onClick={() => setDept("all")}>全部部门 {projects.length}</Button>
        {departments.map(([name, count]) => <Button key={name} variant={dept === name ? "default" : "secondary"} size="sm" onClick={() => setDept(dept === name ? "all" : name)}>{name} {count}</Button>)}
      </div>
    </CardContent></Card>

    <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
      <span>{hasFilter ? `命中 ${sorted.length} / ${projects.length} 个项目` : `共 ${projects.length} 个项目`} · 卡片平铺，不再纵向长堆</span>
      {hasFilter && <Button size="sm" variant="ghost" onClick={clearFilters}>清除筛选</Button>}
    </div>

    {sorted.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-400">没有匹配的项目，试试调整搜索词或清除筛选。</CardContent></Card> : (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((project) => {
          const updated = timeAgo(project.updatedAt);
          const runState = runStateOf(project.id);
          return (
            <Link key={project.id} to={`/projects/${project.id}`} className="group h-full">
              <Card className="h-full transition group-hover:border-indigo-200 group-hover:shadow-sm">
                <CardContent className="flex h-full flex-col pt-5">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Sparkles className="size-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold" title={project.name}>{project.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge>{project.department}</Badge>
                        <span className="text-[10px] text-slate-400">{project.version}</span>
                        {updated && <span className="text-[10px] text-slate-400">· {updated}更新</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-70 transition group-hover:opacity-100">
                      <button type="button" title="导出备份" onClick={(e) => { e.preventDefault(); e.stopPropagation(); exportProject(project); }} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"><Download className="size-3.5" /></button>
                      <button type="button" title="重命名" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRenameTarget(project); setRenameValue(project.name); }} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600"><Pencil className="size-3.5" /></button>
                      <button type="button" title="删除项目" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteTarget(project); }} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-3.5" /></button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-xs">
                    <span className={`size-1.5 rounded-full ${stageTone[project.stage].dot}`} />
                    <span className={`font-semibold ${stageTone[project.stage].text}`}>{stageLabel[project.stage]}</span>
                  </div>
                  {runState && (runState.kind === "running" ? (
                    <div className="mt-2 flex items-center gap-1.5 truncate rounded-lg border border-indigo-100 bg-indigo-50/70 px-2 py-1 text-[10px] font-semibold text-indigo-700" title="该项目的节点正在后台运行，退出界面不会中断；打开项目可查看实时进度">
                      <Activity className="size-3 shrink-0 animate-pulse" /><span className="truncate">后台运行中 · {runState.label}</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5 truncate rounded-lg border border-amber-100 bg-amber-50/70 px-2 py-1 text-[10px] font-semibold text-amber-700" title="刷新或关闭页面打断了该节点；打开项目会自动从中断处续跑">
                      <RotateCcw className="size-3 shrink-0" /><span className="truncate">运行被打断 · 打开自动续跑：{runState.label}</span>
                    </div>
                  ))}
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                    <span>问题 {project.problems.length}</span><span>·</span><span>候选 {project.candidates.length}</span><span>·</span><span>经验 {project.lessons.length}</span>
                    <span className="ml-auto font-semibold text-slate-400 transition group-hover:text-indigo-600">打开 →</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    )}

    {renameTarget && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setRenameTarget(null)}>
        <div className="w-full max-w-md rounded-2xl border bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="font-semibold">重命名项目</div>
          <p className="mt-1 text-xs text-slate-400">新名称会同步到列表、项目工作台和各中心。</p>
          <Input autoFocus className="mt-3" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); }} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button size="sm" disabled={!renameValue.trim()} onClick={confirmRename}>保存</Button>
          </div>
        </div>
      </div>
    )}
    {deleteTarget && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setDeleteTarget(null)}>
        <div className="w-full max-w-md rounded-2xl border bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 font-semibold text-rose-700"><TriangleAlert className="size-4" />删除项目</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">确定删除「{deleteTarget.name}」？该项目的目标、实验记录、版本历史与经验都会移除，<b>不可恢复</b>。</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button size="sm" className="bg-rose-600 text-white hover:bg-rose-700" onClick={confirmDelete}>确认删除</Button>
          </div>
        </div>
      </div>
    )}
  </div>;
}
