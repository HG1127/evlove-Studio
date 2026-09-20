// 评测集管理：对 AI 生成的评测题做人工增删改（含隐藏盲测题），
// 用于控制题量（跑得快）与题目质量（更严格）。
import { useState } from "react";
import { Check, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import type { TestCase } from "../schemas";

const inputCls = "w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

type Draft = { title: string; input: string; expectedText: string; hidden: boolean; criterionIds: string[]; executionMode: TestCase["executionMode"]; evidenceScope: TestCase["evidenceScope"] };

const emptyDraft: Draft = { title: "", input: "", expectedText: "", hidden: false, criterionIds: [], executionMode: "artifact-runtime", evidenceScope: "product-behavior" };

function toDraft(test: TestCase): Draft {
  return { title: test.title, input: test.input, expectedText: test.expected.join("\n"), hidden: test.hidden, criterionIds: test.criterionIds, executionMode: test.executionMode, evidenceScope: test.evidenceScope };
}

function modeLabel(mode: TestCase["executionMode"]) { return ({ "artifact-runtime":"AI可执行", "static-evidence":"静态证据", "external-runner":"真实运行/E2E", roundtrip:"格式回写", "visual-review":"视觉审查", manual:"人工验收" } as Record<TestCase["executionMode"],string>)[mode]; }
function scopeLabel(scope: TestCase["evidenceScope"]) { return ({ "product-behavior":"用户行为", implementation:"实现证据", format:"格式", parser:"解析", "cross-artifact":"跨成果" } as Record<TestCase["evidenceScope"],string>)[scope]; }

function CaseRow({ test, runtime }: { test: TestCase; runtime: ProjectRuntime }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(test));

  const save = () => {
    if (!draft.title.trim() || !draft.input.trim()) return;
    runtime.updateTestCase(test.id, {
      title: draft.title.trim(),
      input: draft.input.trim(),
      expected: draft.expectedText.split("\n").map((line) => line.trim()).filter(Boolean),
      criterionIds: draft.criterionIds,
      executionMode: draft.executionMode,
      evidenceScope: draft.evidenceScope,
    });
    setEditing(false);
  };

  if (!editing) {
    return <div className="group rounded-xl border bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <span className="truncate">{test.title}</span>
            {test.hidden ? <EyeOff className="size-3 shrink-0 text-slate-400" /> : <Eye className="size-3 shrink-0 text-slate-400" />}
          </div>
          <div className="mt-1 line-clamp-2 text-[11px] text-slate-400">{test.input}</div>
          <div className="mt-1.5 text-[10px] text-slate-400">验收要点 {test.expected.length} 条 · Rubric 映射 {test.criterionIds.length} 条{test.tags.length ? ` · ${test.tags.join(" / ")}` : ""}</div>
          <div className="mt-1.5 flex flex-wrap gap-1"><Badge className={test.executionMode==="external-runner"||test.executionMode==="visual-review"?"border-amber-200 bg-amber-50 text-amber-700":"border-slate-200 bg-white text-slate-600"}>{modeLabel(test.executionMode)}</Badge><Badge className="border-sky-100 bg-sky-50 text-sky-700">{scopeLabel(test.evidenceScope)}</Badge></div>
          {test.criterionIds.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{test.criterionIds.map((id) => <Badge key={id} className="border-indigo-100 bg-indigo-50 text-indigo-600">{id}</Badge>)}</div>}
        </div>
        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
          <Button variant="ghost" size="sm" className="size-7 p-0" onClick={() => { setDraft(toDraft(test)); setEditing(true); }} aria-label="编辑题目"><Pencil className="size-3.5" /></Button>
          <Button variant="ghost" size="sm" className="size-7 p-0 text-rose-500 hover:text-rose-600" onClick={() => runtime.deleteTestCase(test.id)} aria-label="删除题目"><Trash2 className="size-3.5" /></Button>
        </div>
      </div>
    </div>;
  }

  return <div className="rounded-xl border border-indigo-200 bg-white p-3">
    <div className="space-y-2">
      <input className={inputCls} placeholder="题目名称" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <textarea className={`${inputCls} min-h-[70px]`} placeholder="给被测对象的输入 / 场景描述" value={draft.input} onChange={(event) => setDraft({ ...draft, input: event.target.value })} />
      <textarea className={`${inputCls} min-h-[64px]`} placeholder="验收要点（每行一条）" value={draft.expectedText} onChange={(event) => setDraft({ ...draft, expectedText: event.target.value })} />
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-[10px] text-slate-500">证据执行方式<select className={`${inputCls} mt-1`} value={draft.executionMode} onChange={(event)=>setDraft({...draft,executionMode:event.target.value as TestCase["executionMode"]})}><option value="artifact-runtime">AI 可真实执行的 Artifact Runtime</option><option value="static-evidence">静态源码/结构证据</option><option value="external-runner">真实运行 / E2E Runner</option><option value="visual-review">视觉 / UI 审查</option><option value="roundtrip">原格式 Roundtrip</option><option value="manual">人工验收</option></select></label><label className="text-[10px] text-slate-500">证据范围<select className={`${inputCls} mt-1`} value={draft.evidenceScope} onChange={(event)=>setDraft({...draft,evidenceScope:event.target.value as TestCase["evidenceScope"]})}><option value="product-behavior">用户/业务行为</option><option value="implementation">实现/工程</option><option value="format">格式</option><option value="parser">解析</option><option value="cross-artifact">跨成果一致性</option></select></label></div>
      <div className="rounded-xl border bg-slate-50 p-2"><div className="mb-1 text-[10px] font-semibold text-slate-500">绑定 Acceptance Criterion</div><div className="flex flex-wrap gap-1.5">{runtime.project.acceptanceRubric.map((criterion) => <label key={criterion.id} className="flex items-center gap-1 rounded-lg border bg-white px-2 py-1 text-[10px] text-slate-600"><input type="checkbox" checked={draft.criterionIds.includes(criterion.id)} onChange={(event) => setDraft({ ...draft, criterionIds: event.target.checked ? [...draft.criterionIds, criterion.id] : draft.criterionIds.filter((id) => id !== criterion.id) })} className="accent-indigo-600" />{criterion.id}{criterion.hardGate ? " · HARD" : ""}</label>)}</div></div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setDraft(toDraft(test)); setEditing(false); }}><X className="size-3.5" />取消</Button>
        <Button size="sm" onClick={save} disabled={!draft.title.trim() || !draft.input.trim()}><Check className="size-3.5" />保存</Button>
      </div>
    </div>
  </div>;
}

export function EvalSuiteEditor({ runtime }: { runtime: ProjectRuntime }) {
  const p = runtime.project;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const total = p.evalSuite.length + p.hiddenEvalSuite.length;

  const addCase = () => {
    if (!draft.title.trim() || !draft.input.trim()) return;
    runtime.addTestCase({
      title: draft.title.trim(),
      input: draft.input.trim(),
      expected: draft.expectedText.split("\n").map((line) => line.trim()).filter(Boolean),
      hidden: draft.hidden,
      criterionIds: draft.criterionIds,
      executionMode: draft.executionMode,
      evidenceScope: draft.evidenceScope,
    });
    setDraft(emptyDraft);
    setAdding(false);
  };

  return <Card><CardContent className="pt-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold">Project Eval Suite</div>
        <div className="mt-1 text-xs text-slate-500">Validation {p.evalSuite.length} 个 · Hidden Holdout {p.hiddenEvalSuite.length} 个 · Rubric {p.acceptanceRubric.length} 条；每道题显式绑定 criterionIds，Hard Gate 必须进入 Hidden。</div>
      </div>
      <div className="flex items-center gap-2">
        {total === 0 ? <Badge className="border-amber-200 bg-amber-50 text-amber-700">需要生成</Badge> : <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Ready</Badge>}
        <Button variant="secondary" size="sm" onClick={() => setAdding((current) => !current)}><Plus className="size-4" />新增题目</Button>
      </div>
    </div>

    {adding && <div className="mt-4 space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
      <input className={inputCls} placeholder="题目名称，例如：高风险医疗追问" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <textarea className={`${inputCls} min-h-[70px]`} placeholder="给被测对象的输入 / 场景描述" value={draft.input} onChange={(event) => setDraft({ ...draft, input: event.target.value })} />
      <textarea className={`${inputCls} min-h-[64px]`} placeholder="验收要点（每行一条）" value={draft.expectedText} onChange={(event) => setDraft({ ...draft, expectedText: event.target.value })} />
      <div className="grid gap-2 sm:grid-cols-2"><label className="text-[10px] text-slate-500">证据执行方式<select className={`${inputCls} mt-1`} value={draft.executionMode} onChange={(event)=>setDraft({...draft,executionMode:event.target.value as TestCase["executionMode"]})}><option value="artifact-runtime">AI 可真实执行的 Artifact Runtime</option><option value="static-evidence">静态源码/结构证据</option><option value="external-runner">真实运行 / E2E Runner</option><option value="visual-review">视觉 / UI 审查</option><option value="roundtrip">原格式 Roundtrip</option><option value="manual">人工验收</option></select></label><label className="text-[10px] text-slate-500">证据范围<select className={`${inputCls} mt-1`} value={draft.evidenceScope} onChange={(event)=>setDraft({...draft,evidenceScope:event.target.value as TestCase["evidenceScope"]})}><option value="product-behavior">用户/业务行为</option><option value="implementation">实现/工程</option><option value="format">格式</option><option value="parser">解析</option><option value="cross-artifact">跨成果一致性</option></select></label></div>
      <div className="rounded-xl border bg-white p-2"><div className="mb-1 text-[10px] font-semibold text-slate-500">绑定 Acceptance Criterion</div><div className="flex flex-wrap gap-1.5">{p.acceptanceRubric.map((criterion) => <label key={criterion.id} className="flex items-center gap-1 rounded-lg border bg-slate-50 px-2 py-1 text-[10px] text-slate-600"><input type="checkbox" checked={draft.criterionIds.includes(criterion.id)} onChange={(event) => setDraft({ ...draft, criterionIds: event.target.checked ? [...draft.criterionIds, criterion.id] : draft.criterionIds.filter((id) => id !== criterion.id) })} className="accent-indigo-600" />{criterion.id}{criterion.hardGate ? " · HARD" : ""}</label>)}</div></div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={draft.hidden} onChange={(event) => setDraft({ ...draft, hidden: event.target.checked })} className="size-3.5 accent-indigo-600" />放进 Hidden 盲测集（不参与日常实验）</label>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setDraft(emptyDraft); setAdding(false); }}>取消</Button>
          <Button size="sm" onClick={addCase} disabled={!draft.title.trim() || !draft.input.trim()}>添加</Button>
        </div>
      </div>
    </div>}

    {total === 0 ? <div className="mt-4 rounded-xl border border-dashed p-6 text-center text-xs text-slate-400">还没有评测题：点上方「AI 生成 Eval Suite」，或「新增题目」手动出题。</div> : <div className="mt-4 space-y-4">
      {p.evalSuite.length > 0 && <div className="grid gap-2 md:grid-cols-2">{p.evalSuite.map((test) => <CaseRow key={test.id} test={test} runtime={runtime} />)}</div>}
      {p.hiddenEvalSuite.length > 0 && <div>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-slate-400"><EyeOff className="size-3" />Hidden Holdout（仅在最终盲测中使用）</div>
        <div className="grid gap-2 md:grid-cols-2">{p.hiddenEvalSuite.map((test) => <CaseRow key={test.id} test={test} runtime={runtime} />)}</div>
      </div>}
    </div>}
  </CardContent></Card>;
}
