
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Copy, Pencil, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { useLocalProjects } from "../runtime/use-local-projects";
import { TEMPLATES_CHANGED_EVENT, deleteTemplate, duplicateTemplate, listTemplates, saveTemplate, templateFromProject, type EvolveTemplate } from "../runtime/template-store";

const DEPARTMENTS = ["策略部", "客户部", "AI部", "技术部", "管理部", "其他"];
const OBJECT_TYPES = [["auto", "AI 自动识别"], ["agent", "Agent"], ["system", "AI 系统"], ["prompt", "Prompt"], ["workflow", "Workflow"], ["knowledge", "知识库 / Memory"], ["tool", "Tool"], ["template", "内容模板"]] as const;

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

function blankTemplate(): EvolveTemplate {
  const at = new Date().toISOString();
  return { id: `tpl-${Date.now()}`, name: "", category: "自定义", department: "策略部", objectType: "auto", scenarios: "", goal: "", metrics: [], builtIn: false, useCount: 0, createdAt: at, updatedAt: at };
}

/** 新建 / 编辑模板：可手填，也可从已有项目一键带入目标、部门、对象类型与指标。 */
function TemplateFormModal({ initial, onClose }: { initial: EvolveTemplate; onClose: () => void }) {
  const projects = useLocalProjects();
  const [draft, setDraft] = useState<EvolveTemplate>(initial);
  const [sourceId, setSourceId] = useState("");
  const set = (patch: Partial<EvolveTemplate>) => setDraft((current) => ({ ...current, ...patch }));
  const loadFromProject = () => {
    const project = projects.find((item) => item.id === sourceId);
    if (!project) return;
    const seeded = templateFromProject(project);
    setDraft((current) => ({ ...current, ...seeded, id: current.id, createdAt: current.createdAt, useCount: current.useCount }));
  };
  const submit = () => {
    const name = draft.name.trim();
    if (!name) return;
    saveTemplate({ ...draft, name, updatedAt: new Date().toISOString() });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold">{initial.name ? "编辑模板" : "新建模板"}</div>
        <p className="mt-1 text-xs text-slate-400">模板会在新建项目时预填部门、对象类型与进化目标；创建后仍由 AI 生成正式 Evolve Contract。</p>
        {projects.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <select aria-label="从已有项目导入" value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600">
              <option value="">从已有项目导入设置…</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <Button size="sm" variant="secondary" disabled={!sourceId} onClick={loadFromProject}>导入</Button>
          </div>
        )}
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold text-slate-600">模板名称
            <Input className="mt-1 font-normal" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如：客诉回复 / 服务周报" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-600">分类
              <Input className="mt-1 font-normal" value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="例如：客户服务" />
            </label>
            <label className="block text-xs font-semibold text-slate-600">推荐部门
              <select value={draft.department} onChange={(e) => set({ department: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal text-slate-600">
                {DEPARTMENTS.map((dept) => <option key={dept}>{dept}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs font-semibold text-slate-600">推荐对象类型
            <select value={draft.objectType} onChange={(e) => set({ objectType: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal text-slate-600">
              {OBJECT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-600">适用场景
            <Textarea className="mt-1 font-normal" rows={2} value={draft.scenarios} onChange={(e) => set({ scenarios: e.target.value })} placeholder="例如：客诉回复、客户周报、FAQ 问答" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">进化目标（新建项目时预填为初始命令）
            <Textarea className="mt-1 font-normal" rows={3} value={draft.goal} onChange={(e) => set({ goal: e.target.value })} placeholder="例如：进化客诉回复：完整覆盖问题、语气稳定、合规达标" />
          </label>
          <label className="block text-xs font-semibold text-slate-600">推荐指标（顿号或逗号分隔）
            <Input className="mt-1 font-normal" value={draft.metrics.join("、")} onChange={(e) => set({ metrics: e.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} placeholder="例如：完整性、语气、时效、合规" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={!draft.name.trim()} onClick={submit}>保存模板</Button>
        </div>
      </div>
    </div>
  );
}

export function TemplateGrid() {
  const [templates, setTemplates] = useState<EvolveTemplate[]>(listTemplates);
  useEffect(() => {
    const refresh = () => setTemplates(listTemplates());
    refresh();
    window.addEventListener(TEMPLATES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(TEMPLATES_CHANGED_EVENT, refresh);
  }, []);
  const projects = useLocalProjects();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<EvolveTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EvolveTemplate | null>(null);

  const categories = useMemo(() => [...new Set(templates.map((template) => template.category))], [templates]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((template) =>
      (category === "all" || template.category === category) &&
      (!q || `${template.name} ${template.category} ${template.scenarios} ${template.goal} ${template.metrics.join(" ")}`.toLowerCase().includes(q)));
  }, [templates, query, category]);
  const customCount = templates.filter((template) => !template.builtIn).length;
  const totalUse = templates.reduce((sum, template) => sum + template.useCount, 0);
  const relatedProjects = (templateId: string) => projects.filter((project) => project.templateId === templateId);

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-xs font-semibold text-indigo-600">Templates</div>
        <h1 className="mt-1 text-3xl font-bold">模板中心</h1>
        <p className="mt-1 text-sm text-slate-500">模板预置部门、对象类型、进化目标与推荐指标；使用模板新建项目会自动预填向导，项目也会记回模板，形成「模板 → 项目 → 沉淀新模板」的循环。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{customCount} 自定义</Badge>
        <Badge className="border-slate-200 bg-slate-50 text-slate-600">{templates.length - customCount} 内置</Badge>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{totalUse} 次使用</Badge>
        <Button size="sm" onClick={() => setEditing(blankTemplate())}><Plus className="size-4" />新建模板</Button>
      </div>
    </div>

    <Card><CardContent className="space-y-3 pt-5">
      <div className="relative"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索模板名称、场景、目标或指标…" /></div>
      <div className="flex flex-wrap gap-2">
        <Button variant={category === "all" ? "default" : "secondary"} size="sm" onClick={() => setCategory("all")}>全部分类 {templates.length}</Button>
        {categories.map((name) => <Button key={name} variant={category === name ? "default" : "secondary"} size="sm" onClick={() => setCategory(category === name ? "all" : name)}>{name}</Button>)}
      </div>
    </CardContent></Card>

    {filtered.length === 0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-400">没有匹配的模板，试试调整搜索词，或点「新建模板」沉淀一个自己的模板。</CardContent></Card> : (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {filtered.map((template) => {
          const related = relatedProjects(template.id);
          return (
            <Card key={template.id} className="h-full">
              <CardContent className="flex h-full flex-col pt-5">
                <div className="flex items-start justify-between gap-2">
                  <Badge>{template.category}</Badge>
                  <Badge className={template.builtIn ? "border-slate-200 bg-slate-50 text-slate-400" : "border-indigo-200 bg-indigo-50/50 text-indigo-600"}>{template.builtIn ? "内置" : "自定义"}</Badge>
                </div>
                <div className="mt-3 text-sm font-semibold leading-5">{template.name}</div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{template.scenarios || template.goal}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">推荐指标：{template.metrics.join("、") || "未设置"}</p>
                <div className="mt-2 text-[10px] text-slate-400">
                  使用 {template.useCount} 次{template.lastUsedAt ? ` · 最近 ${timeAgo(template.lastUsedAt)}` : ""} · 关联项目 {related.length}
                </div>
                {related.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {related.slice(0, 2).map((project) => <Link key={project.id} to={`/projects/${project.id}`}><Badge className="max-w-full truncate border-indigo-100 bg-indigo-50/50 text-indigo-600">{project.name}</Badge></Link>)}
                    {related.length > 2 && <span className="text-[10px] text-slate-400">+{related.length - 2}</span>}
                  </div>
                )}
                <div className="mt-auto flex gap-1.5 pt-4">
                  <Link to={`/?template=${template.id}`} className="min-w-0 flex-1"><Button variant="secondary" size="sm" className="w-full">使用模板</Button></Link>
                  <Button variant="ghost" size="sm" title="复制为自定义模板" onClick={() => setEditing(duplicateTemplate(template.id) ?? null)}><Copy className="size-3.5" /></Button>
                  {!template.builtIn && <>
                    <Button variant="ghost" size="sm" title="编辑模板" onClick={() => setEditing(template)}><Pencil className="size-3.5" /></Button>
                    <Button variant="ghost" size="sm" title="删除模板" className="hover:bg-rose-50 hover:text-rose-600" onClick={() => setDeleteTarget(template)}><Trash2 className="size-3.5" /></Button>
                  </>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    )}

    {editing && <TemplateFormModal initial={editing} onClose={() => setEditing(null)} />}
    {deleteTarget && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setDeleteTarget(null)}>
        <div className="w-full max-w-md rounded-2xl border bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 font-semibold text-rose-700"><TriangleAlert className="size-4" />删除模板</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">确定删除自定义模板「{deleteTarget.name}」？已使用它创建的项目不受影响。</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button size="sm" className="bg-rose-600 text-white hover:bg-rose-700" onClick={() => { deleteTemplate(deleteTarget.id); setDeleteTarget(null); }}>确认删除</Button>
          </div>
        </div>
      </div>
    )}
    <p className="flex items-center gap-1.5 text-xs text-slate-400"><Boxes className="size-3.5" />内置模板不可删除，但可复制成自定义模板后自由修改；使用统计与自定义模板只保存在本机浏览器。</p>
  </div>;
}
